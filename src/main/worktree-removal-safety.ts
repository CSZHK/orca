import { lstat, readFile, readdir, realpath } from 'fs/promises'
import { homedir } from 'os'
import { posix, win32 } from 'path'
import type { GitWorktreeInfo } from '../shared/types'
import { areWorktreePathsEqual } from './ipc/worktree-logic'

type PathOps = typeof posix

function looksLikeWindowsPath(pathValue: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(pathValue) || pathValue.startsWith('\\\\')
}

export function getPathOps(...paths: string[]): PathOps {
  return paths.some(looksLikeWindowsPath) ? win32 : posix
}

function containsPath(parentPath: string, childPath: string, pathOps: PathOps): boolean {
  const relativePath = pathOps.relative(parentPath, childPath)
  return (
    relativePath === '' ||
    (!!relativePath && !relativePath.startsWith('..') && !pathOps.isAbsolute(relativePath))
  )
}

function getDepthFromRoot(resolvedPath: string, pathOps: PathOps): number {
  const rootPath = pathOps.parse(resolvedPath).root
  const relativePath = pathOps.relative(rootPath, resolvedPath)
  if (!relativePath) {
    return 0
  }
  return relativePath.split(pathOps.sep).filter(Boolean).length
}

function areSameDrive(pathA: string, pathB: string): boolean {
  const driveA = /^([A-Za-z]):/.exec(pathA)
  const driveB = /^([A-Za-z]):/.exec(pathB)
  if (driveA && driveB) {
    return driveA[1].toLowerCase() === driveB[1].toLowerCase()
  }
  return !driveA && !driveB
}

export function isDangerousWorktreeRemovalPath(worktreePath: string, repoPath: string): boolean {
  if (!worktreePath.trim()) {
    return true
  }

  if (areWorktreePathsEqual(worktreePath, repoPath)) {
    return true
  }

  const pathOps = getPathOps(worktreePath, repoPath)
  const resolvedWorktreePath = pathOps.resolve(worktreePath)
  const rootPath = pathOps.parse(resolvedWorktreePath).root
  if (resolvedWorktreePath === rootPath) {
    return true
  }

  // Refuse to delete paths too close to the filesystem root.
  // Worktrees at depth 1 (e.g. D:\orca) or 2 (e.g. D:\apps\orca) are almost
  // certainly not disposable worktree directories.
  const MIN_SAFE_DEPTH = 3
  if (getDepthFromRoot(resolvedWorktreePath, pathOps) < MIN_SAFE_DEPTH) {
    return true
  }

  // Worktrees on a different drive from the repo are suspect — normal
  // `git worktree add` keeps worktrees on the same volume.
  if (looksLikeWindowsPath(worktreePath) && !areSameDrive(worktreePath, repoPath)) {
    return true
  }

  const resolvedRepoPath = pathOps.resolve(repoPath)
  if (containsPath(resolvedWorktreePath, resolvedRepoPath, pathOps)) {
    return true
  }

  const homePath = homedir()
  return !!homePath && containsPath(resolvedWorktreePath, pathOps.resolve(homePath), pathOps)
}

export function getRegisteredDeletableWorktree(
  repoPath: string,
  requestedWorktreePath: string,
  worktrees: readonly GitWorktreeInfo[]
): GitWorktreeInfo {
  const worktree = worktrees.find((item) => areWorktreePathsEqual(item.path, requestedWorktreePath))
  if (!worktree) {
    throw new Error(`Refusing to delete unregistered worktree path: ${requestedWorktreePath}`)
  }
  if (worktree.isMainWorktree || isDangerousWorktreeRemovalPath(worktree.path, repoPath)) {
    throw new Error(`Refusing to delete protected worktree path: ${worktree.path}`)
  }
  return worktree
}

/**
 * Verify the .git file inside a worktree directory actually points back to
 * the expected repo. A worktree's .git is a plain text file containing
 * `gitdir: <path-to-main-repo>/.git/worktrees/<name>`.
 */
async function isGitFileLinkedToRepo(
  worktreePath: string,
  repoPath: string,
  pathOps: PathOps
): Promise<boolean> {
  try {
    const gitFilePath = pathOps.join(worktreePath, '.git')
    const content = await readFile(gitFilePath, 'utf8')
    const match = /^gitdir:\s*(.+)$/m.exec(content.trim())
    if (!match) {
      return false
    }
    const gitdir = match[1].trim()
    // realpath resolves Windows 8.3 short names (e.g. ADMINI~1 → Administrator)
    // so paths from git and from Node's tmpdir() compare correctly.
    const resolvedGitdir = await realpath(pathOps.resolve(worktreePath, gitdir)).catch(
      () => pathOps.resolve(worktreePath, gitdir)
    )
    const resolvedRepoGitDir = await realpath(pathOps.resolve(repoPath, '.git')).catch(
      () => pathOps.resolve(repoPath, '.git')
    )
    // Verify gitdir is strictly inside <repo>/.git/ (path boundary check
    // prevents ".git-evil" from matching ".git")
    const lower = resolvedGitdir.toLowerCase()
    const lowerRepo = resolvedRepoGitDir.toLowerCase()
    return lower === lowerRepo || lower.startsWith(`${lowerRepo}${pathOps.sep}`)
  } catch {
    return false
  }
}

export async function canSafelyRemoveOrphanedWorktreeDirectory(
  worktreePath: string,
  repoPath: string
): Promise<boolean> {
  if (isDangerousWorktreeRemovalPath(worktreePath, repoPath)) {
    return false
  }

  const pathOps = getPathOps(worktreePath, repoPath)

  try {
    const gitEntry = await lstat(pathOps.join(worktreePath, '.git'))
    if (!gitEntry.isFile()) {
      return false
    }
  } catch {
    return false
  }

  if (!(await isGitFileLinkedToRepo(worktreePath, repoPath, pathOps))) {
    return false
  }

  // Refuse if the directory has too many top-level entries — a real worktree
  // has roughly the same set of entries as the repo. A directory with dozens
  // of extra unrelated items is probably not a pure worktree checkout.
  try {
    const MAX_TOPLEVEL_ENTRIES = 200
    const entries = await readdir(worktreePath)
    if (entries.length > MAX_TOPLEVEL_ENTRIES) {
      return false
    }
  } catch {
    return false
  }

  return true
}
