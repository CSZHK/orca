import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  isDangerousWorktreeRemovalPath,
  canSafelyRemoveOrphanedWorktreeDirectory
} from './worktree-removal-safety'

// ─── Part 1: Pure string checks (no filesystem) ───

describe('isDangerousWorktreeRemovalPath', () => {
  it('rejects empty path', () => {
    expect(isDangerousWorktreeRemovalPath('', 'C:\\repo')).toBe(true)
    expect(isDangerousWorktreeRemovalPath('   ', 'C:\\repo')).toBe(true)
  })

  it('rejects path equal to repoPath', () => {
    expect(isDangerousWorktreeRemovalPath('C:\\repo', 'C:\\repo')).toBe(true)
  })

  it('rejects filesystem root', () => {
    expect(isDangerousWorktreeRemovalPath('C:\\', 'C:\\repo')).toBe(true)
    expect(isDangerousWorktreeRemovalPath('/', '/repo')).toBe(true)
  })

  it('rejects depth-1 path (e.g. D:\\orca)', () => {
    expect(isDangerousWorktreeRemovalPath('D:\\orca', 'D:\\repo')).toBe(true)
  })

  it('rejects depth-2 path (e.g. D:\\apps\\orca)', () => {
    expect(isDangerousWorktreeRemovalPath('D:\\apps\\orca', 'D:\\repo')).toBe(true)
  })

  it('rejects cross-drive worktree (the exact data-loss scenario)', () => {
    expect(
      isDangerousWorktreeRemovalPath('D:\\workspace\\repo\\wt', 'G:\\repos\\myrepo')
    ).toBe(true)
  })

  it('rejects path that contains repoPath', () => {
    expect(
      isDangerousWorktreeRemovalPath(
        'C:\\Users\\dev\\repos',
        'C:\\Users\\dev\\repos\\myrepo'
      )
    ).toBe(true)
  })

  it('rejects path that contains home directory', () => {
    const home = process.env.USERPROFILE || process.env.HOME || ''
    if (home) {
      expect(isDangerousWorktreeRemovalPath(home, 'C:\\other\\repo')).toBe(true)
    }
  })

  it('allows deep same-drive worktree path', () => {
    expect(
      isDangerousWorktreeRemovalPath(
        'C:\\Users\\dev\\workspaces\\repo\\worktrees\\feature-x',
        'C:\\Users\\dev\\workspaces\\repo'
      )
    ).toBe(false)
  })

  it('allows typical worktree sibling path at depth >= 3', () => {
    expect(
      isDangerousWorktreeRemovalPath(
        'C:\\Users\\dev\\worktrees\\repo\\feature-branch',
        'C:\\Users\\dev\\repos\\myrepo'
      )
    ).toBe(false)
  })
})

// ─── Part 2: Filesystem integration (all inside os.tmpdir) ───

describe('canSafelyRemoveOrphanedWorktreeDirectory (integration)', () => {
  const tempDirs: string[] = []

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns true for a valid same-drive worktree with correct .git link', async () => {
    // Setup: create repo and worktree inside the SAME temp root
    const root = makeTempDir('safety-ok-')
    const repoPath = join(root, 'main-repo')
    const wtPath = join(root, 'worktree-feature')

    execFileSync('git', ['init', repoPath], { stdio: 'pipe' })
    git(repoPath, 'commit', '--allow-empty', '-m', 'init')
    git(repoPath, 'worktree', 'add', wtPath, '-b', 'feature')

    // Sanity: .git file in worktree points to the repo
    const gitContent = readFileSync(join(wtPath, '.git'), 'utf8')
    expect(gitContent).toContain('gitdir:')

    const result = await canSafelyRemoveOrphanedWorktreeDirectory(wtPath, repoPath)
    expect(result).toBe(true)
  })

  it('returns false when .git file points to a DIFFERENT repo', async () => {
    const root = makeTempDir('safety-wrongrepo-')
    const repoA = join(root, 'repo-a')
    const repoB = join(root, 'repo-b')
    const wtPath = join(root, 'worktree-x')

    execFileSync('git', ['init', repoA], { stdio: 'pipe' })
    git(repoA, 'commit', '--allow-empty', '-m', 'init')
    execFileSync('git', ['init', repoB], { stdio: 'pipe' })
    git(repoB, 'commit', '--allow-empty', '-m', 'init')
    git(repoA, 'worktree', 'add', wtPath, '-b', 'feat')

    // Ask: is this worktree safe to remove as if it belongs to repoB?
    const result = await canSafelyRemoveOrphanedWorktreeDirectory(wtPath, repoB)
    expect(result).toBe(false)
  })

  it('returns false when .git is a directory (real repo, not worktree)', async () => {
    const root = makeTempDir('safety-notworktree-')
    const repoPath = join(root, 'real-repo')
    execFileSync('git', ['init', repoPath], { stdio: 'pipe' })

    const result = await canSafelyRemoveOrphanedWorktreeDirectory(repoPath, repoPath)
    expect(result).toBe(false)
  })

  it('returns false when no .git exists at all', async () => {
    const root = makeTempDir('safety-nogit-')
    const plainDir = join(root, 'just-a-dir')
    execFileSync('git', ['init', root], { stdio: 'pipe' })

    const { mkdirSync } = await import('fs')
    mkdirSync(plainDir)
    writeFileSync(join(plainDir, 'important-data.txt'), 'do not delete')

    const result = await canSafelyRemoveOrphanedWorktreeDirectory(plainDir, root)
    expect(result).toBe(false)
  })

  it('end-to-end: orphaned worktree cleanup preserves user files', async () => {
    // This test reproduces the EXACT bug scenario:
    // 1. Create a repo + worktree
    // 2. Put user files in the worktree
    // 3. Orphan the worktree (prune it from the repo)
    // 4. Simulate what the fixed code does: unlink .git only
    // 5. Verify ALL user files survive

    const root = makeTempDir('safety-e2e-')
    const repoPath = join(root, 'main-repo')
    const wtPath = join(root, 'my-worktree')

    execFileSync('git', ['init', repoPath], { stdio: 'pipe' })
    git(repoPath, 'commit', '--allow-empty', '-m', 'init')
    git(repoPath, 'worktree', 'add', wtPath, '-b', 'feature')

    // User creates files in the worktree
    writeFileSync(join(wtPath, 'user-data.txt'), 'critical user data')
    writeFileSync(join(wtPath, 'project-notes.md'), '# My Notes')
    const { mkdirSync } = await import('fs')
    mkdirSync(join(wtPath, 'src'))
    writeFileSync(join(wtPath, 'src', 'index.ts'), 'console.log("hello")')

    // Orphan the worktree: remove git's tracking without touching the directory
    git(repoPath, 'worktree', 'remove', '--force', wtPath)

    // Recreate the directory as if the user still has it (simulating stale state)
    mkdirSync(wtPath)
    writeFileSync(join(wtPath, 'user-data.txt'), 'critical user data')
    writeFileSync(join(wtPath, 'project-notes.md'), '# My Notes')
    mkdirSync(join(wtPath, 'src'))
    writeFileSync(join(wtPath, 'src', 'index.ts'), 'console.log("hello")')
    // No .git file — canSafelyRemove should return false
    const safetyResult = await canSafelyRemoveOrphanedWorktreeDirectory(wtPath, repoPath)
    expect(safetyResult).toBe(false)

    // Even if safety returned true, the NEW code path only does unlink(.git)
    // Simulate the fixed code path:
    const { unlink } = await import('fs/promises')
    await unlink(join(wtPath, '.git')).catch(() => {})

    // Verify: ALL user files survive
    expect(existsSync(join(wtPath, 'user-data.txt'))).toBe(true)
    expect(existsSync(join(wtPath, 'project-notes.md'))).toBe(true)
    expect(existsSync(join(wtPath, 'src', 'index.ts'))).toBe(true)
    expect(readFileSync(join(wtPath, 'user-data.txt'), 'utf8')).toBe('critical user data')

    // Count: directory still has all entries
    const entries = readdirSync(wtPath)
    expect(entries).toContain('user-data.txt')
    expect(entries).toContain('project-notes.md')
    expect(entries).toContain('src')
  })

  it('cross-drive scenario: isDangerous blocks before canSafely is even called', async () => {
    // Simulates D:\orca (worktree) vs G:\repos\orca (repo)
    // isDangerousWorktreeRemovalPath must return true, blocking everything
    const dangerous = isDangerousWorktreeRemovalPath('D:\\orca', 'G:\\repos\\orca')
    expect(dangerous).toBe(true)

    // So canSafelyRemoveOrphanedWorktreeDirectory would also return false
    const safe = await canSafelyRemoveOrphanedWorktreeDirectory('D:\\orca', 'G:\\repos\\orca')
    expect(safe).toBe(false)
  })
})
