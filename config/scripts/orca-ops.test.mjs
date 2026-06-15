import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupScratch,
  createCliDeployPackage,
  getCleanupTargets,
  parseOpsArgs,
  runOps
} from './orca-ops.mjs'

const tempRoots = []

function makeTempRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), 'orca-ops-'))
  tempRoots.push(repo)
  writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({
      name: 'orca',
      version: '1.2.3',
      dependencies: {
        ws: '^8.20.0',
        zod: '~4.4.3',
        react: '^19.2.5'
      }
    })
  )
  return repo
}

function makeBuiltCli(repo) {
  mkdirSync(path.join(repo, 'out', 'cli'), { recursive: true })
  mkdirSync(path.join(repo, 'out', 'shared'), { recursive: true })
  writeFileSync(path.join(repo, 'out', 'cli', 'index.js'), '#!/usr/bin/env node\n')
  writeFileSync(path.join(repo, 'out', 'shared', 'constants.js'), 'exports.ok = true\n')
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('parseOpsArgs', () => {
  it('parses positionals, booleans, equals flags, and valued flags', () => {
    const parsed = parseOpsArgs([
      'cli',
      'package',
      '--out-dir',
      'tmp-cli-deploy',
      '--archive=orca-cli-deploy.tar.gz',
      '--force'
    ])

    expect(parsed.positionals).toEqual(['cli', 'package'])
    expect(parsed.flags.get('out-dir')).toBe('tmp-cli-deploy')
    expect(parsed.flags.get('archive')).toBe('orca-cli-deploy.tar.gz')
    expect(parsed.flags.get('force')).toBe(true)
  })

  it('fails when a valued ops flag is missing its value', async () => {
    const repo = makeTempRepo()

    await expect(
      runOps(['cli', 'package', '--out-dir'], {
        repoRoot: repo,
        execFileSync: vi.fn(),
        spawnSync: vi.fn()
      })
    ).rejects.toThrow('--out-dir requires a value')
  })
})

describe('cleanupScratch', () => {
  it('lists root scratch artifacts without deleting by default', () => {
    const repo = makeTempRepo()
    mkdirSync(path.join(repo, 'tmp-cli-deploy'))
    writeFileSync(path.join(repo, 'orca-cli-deploy.tar.gz'), 'archive')
    writeFileSync(path.join(repo, 'test-e2e.txt'), 'scratch')

    const result = cleanupScratch({ repoRoot: repo })

    expect(result).toEqual({
      force: false,
      removed: [],
      wouldRemove: ['orca-cli-deploy.tar.gz', 'test-e2e.txt', 'tmp-cli-deploy']
    })
    expect(existsSync(path.join(repo, 'tmp-cli-deploy'))).toBe(true)
  })

  it('removes only explicitly registered root scratch artifacts when forced', () => {
    const repo = makeTempRepo()
    mkdirSync(path.join(repo, 'tmp-cli-deploy'))
    writeFileSync(path.join(repo, 'orca-cli-deploy.tar.gz'), 'archive')
    writeFileSync(path.join(repo, 'manual-evidence.tar.gz'), 'archive')
    mkdirSync(path.join(repo, 'nested'))
    writeFileSync(path.join(repo, 'nested', 'not-cleaned.tar.gz'), 'archive')

    const result = cleanupScratch({ repoRoot: repo, force: true })

    expect(result.removed).toEqual(['orca-cli-deploy.tar.gz', 'tmp-cli-deploy'])
    expect(existsSync(path.join(repo, 'tmp-cli-deploy'))).toBe(false)
    expect(existsSync(path.join(repo, 'manual-evidence.tar.gz'))).toBe(true)
    expect(existsSync(path.join(repo, 'nested', 'not-cleaned.tar.gz'))).toBe(true)
  })

  it('reports cleanup targets in stable order', () => {
    const repo = makeTempRepo()
    mkdirSync(path.join(repo, 'tmp-cli-deploy'))
    writeFileSync(path.join(repo, 'orca-cli-deploy.tar.gz'), 'archive')
    writeFileSync(path.join(repo, 'test-e2e.txt'), 'scratch')
    writeFileSync(path.join(repo, 'manual-evidence.tar.gz'), 'archive')

    expect(getCleanupTargets({ repoRoot: repo }).map((target) => target.relativePath)).toEqual([
      'orca-cli-deploy.tar.gz',
      'test-e2e.txt',
      'tmp-cli-deploy'
    ])
  })
})

describe('createCliDeployPackage', () => {
  it('packages built cli output with shims and dependency metadata', () => {
    const repo = makeTempRepo()
    makeBuiltCli(repo)
    const execFile = vi.fn((command, args) => {
      if (command === 'tar') {
        execFileSync(command, args, { cwd: repo })
      }
    })

    const result = createCliDeployPackage({
      repoRoot: repo,
      skipBuild: true,
      force: true,
      execFile
    })

    expect(result.files).toEqual(['cli/', 'shared/', 'package.json', 'orca', 'orca.cmd'])
    expect(existsSync(path.join(repo, 'tmp-cli-deploy', 'cli', 'index.js'))).toBe(true)
    expect(existsSync(path.join(repo, 'tmp-cli-deploy', 'shared', 'constants.js'))).toBe(true)
    expect(existsSync(path.join(repo, 'tmp-cli-deploy', 'orca'))).toBe(true)
    expect(existsSync(path.join(repo, 'tmp-cli-deploy', 'orca.cmd'))).toBe(true)
    expect(existsSync(path.join(repo, 'orca-cli-deploy.tar.gz'))).toBe(true)

    const deployPackage = JSON.parse(
      readFileSync(path.join(repo, 'tmp-cli-deploy', 'package.json'))
    )
    expect(deployPackage).toMatchObject({
      name: 'orca-cli',
      version: '1.2.3',
      private: true,
      bin: { orca: './cli/index.js' }
    })
    expect(deployPackage.dependencies).toEqual({
      ws: '^8.20.0',
      zod: '~4.4.3'
    })
  })

  it('refuses to replace an existing package directory without force', () => {
    const repo = makeTempRepo()
    makeBuiltCli(repo)
    mkdirSync(path.join(repo, 'tmp-cli-deploy'))

    expect(() =>
      createCliDeployPackage({
        repoRoot: repo,
        skipBuild: true
      })
    ).toThrow('Pass --force to replace it')
  })

  it('rejects disposable output outside the repo root', () => {
    const repo = makeTempRepo()
    makeBuiltCli(repo)

    expect(() =>
      createCliDeployPackage({
        repoRoot: repo,
        outDir: path.join(tmpdir(), 'external-cli-deploy'),
        skipBuild: true,
        force: true,
        noArchive: true
      })
    ).toThrow('must stay inside the repo root')
  })

  it('rejects archive paths outside the repo root', () => {
    const repo = makeTempRepo()
    makeBuiltCli(repo)

    expect(() =>
      createCliDeployPackage({
        repoRoot: repo,
        archivePath: path.join(tmpdir(), 'orca-cli-deploy.tar.gz'),
        skipBuild: true,
        force: true
      })
    ).toThrow('archive path must stay inside the repo root')
  })

  it('rejects custom archive names', () => {
    const repo = makeTempRepo()
    makeBuiltCli(repo)

    expect(() =>
      createCliDeployPackage({
        repoRoot: repo,
        archivePath: path.join(repo, 'custom.tar.gz'),
        skipBuild: true,
        force: true
      })
    ).toThrow('archive must be named orca-cli-deploy.tar.gz')
  })

  it('refuses to replace an archive directory even with force', () => {
    const repo = makeTempRepo()
    makeBuiltCli(repo)
    mkdirSync(path.join(repo, 'orca-cli-deploy.tar.gz'))

    expect(() =>
      createCliDeployPackage({
        repoRoot: repo,
        skipBuild: true,
        force: true
      })
    ).toThrow('Archive path is a directory')
  })

  it('runs the CLI build before packaging unless skipped', () => {
    const repo = makeTempRepo()
    makeBuiltCli(repo)
    const spawn = vi.fn(() => ({ status: 0 }))

    createCliDeployPackage({
      repoRoot: repo,
      force: true,
      noArchive: true,
      spawn
    })

    expect(spawn).toHaveBeenCalledWith(
      'pnpm',
      ['run', 'build:cli'],
      expect.objectContaining({
        cwd: repo,
        stdio: 'inherit'
      })
    )
  })
})

describe('release ops', () => {
  it('requires force before publishing complete draft releases', async () => {
    const repo = makeTempRepo()

    await expect(
      runOps(['release', 'publish-complete-drafts'], {
        repoRoot: repo,
        env: {
          GH_TOKEN: 'token',
          GITHUB_REPOSITORY: 'stablyai/orca'
        }
      })
    ).rejects.toThrow('pass --force to continue')
  })
})
