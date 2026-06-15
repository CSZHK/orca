#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDraftRelease } from './create-draft-release.mjs'
import { fetchReleases, latestStableDesktopReleaseTag } from './latest-stable-release.mjs'
import {
  publishCompleteDraftReleases,
  writeGithubOutputs
} from './publish-complete-draft-releases.mjs'
import { verifyRequiredReleaseAssets } from './verify-release-required-assets.mjs'

const DEFAULT_REPO = 'stablyai/orca'
const DEFAULT_CLI_DEPLOY_DIR = 'tmp-cli-deploy'
const DEFAULT_CLI_ARCHIVE = 'orca-cli-deploy.tar.gz'
const CLEANUP_SCRATCH_NAMES = new Set([DEFAULT_CLI_DEPLOY_DIR, DEFAULT_CLI_ARCHIVE, 'test-e2e.txt'])

const HELP = `orca ops

Usage:
  pnpm ops status [--json]
  pnpm ops windows rebuild-installer [--out-dir <dir>] [--repackage-only] [--force] [--json]
  pnpm ops cli package [--out-dir <dir>] [--archive <path>] [--skip-build] [--force] [--no-archive] [--json]
  pnpm ops cleanup [--force] [--json]
  pnpm ops release latest-stable [--repo <owner/repo>] [--json]
  pnpm ops release create-draft <tag> [--repo <owner/repo>] [--json]
  pnpm ops release verify-assets <tag> [--repo <owner/repo>] [--json]
  pnpm ops release publish-complete-drafts --force [--repo <owner/repo>] [--json]

Notes:
  Release commands require GH_TOKEN or GITHUB_TOKEN when they call GitHub.
  cleanup is dry-run by default; pass --force to delete known root scratch files.
  publish-complete-drafts requires --force because it makes releases public.
`

function defaultRepoRoot() {
  return path.resolve(import.meta.dirname, '..', '..')
}

export function parseOpsArgs(argv) {
  const positionals = []
  const flags = new Map()

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }

    const raw = token.slice(2)
    const equalsIndex = raw.indexOf('=')
    if (equalsIndex !== -1) {
      flags.set(raw.slice(0, equalsIndex), raw.slice(equalsIndex + 1))
      continue
    }

    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      flags.set(raw, true)
      continue
    }

    flags.set(raw, next)
    index += 1
  }

  return { positionals, flags }
}

function getStringFlag(flags, name, fallback = undefined) {
  if (!flags.has(name)) {
    return fallback
  }
  const value = flags.get(name)
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`--${name} requires a value`)
  }
  return value
}

function hasFlag(flags, name) {
  return flags.get(name) === true
}

function getRepo(flags, env) {
  return getStringFlag(flags, 'repo', env.GITHUB_REPOSITORY || DEFAULT_REPO)
}

function getToken(env) {
  return env.GH_TOKEN || env.GITHUB_TOKEN
}

function requireToken(env) {
  const token = getToken(env)
  if (!token) {
    throw new Error('GH_TOKEN or GITHUB_TOKEN must be set')
  }
  return token
}

function requireTag(positionals, commandName) {
  const tag = positionals[2]
  if (!tag) {
    throw new Error(`Usage: pnpm ops release ${commandName} <tag>`)
  }
  return tag
}

function relativeFromRepo(repoRoot, target) {
  return path.relative(repoRoot, target) || '.'
}

function resolveFromRepo(repoRoot, target) {
  return path.resolve(repoRoot, target)
}

function assertNotRepoRoot(repoRoot, target, label) {
  const resolved = path.resolve(target)
  if (resolved === repoRoot || resolved === path.parse(resolved).root) {
    throw new Error(`${label} refuses to use ${resolved} as a disposable output path`)
  }
}

function isInsideDirectory(parent, target) {
  const relative = path.relative(parent, target)
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function assertSafeCliDeployDir(repoRoot, target) {
  const resolved = path.resolve(target)
  assertNotRepoRoot(repoRoot, resolved, 'cli package')
  if (!isInsideDirectory(repoRoot, resolved)) {
    throw new Error('CLI deploy output directory must stay inside the repo root')
  }
  const basename = path.basename(resolved)
  if (basename !== DEFAULT_CLI_DEPLOY_DIR && !basename.endsWith('cli-deploy')) {
    throw new Error(
      'CLI deploy output directory must be named tmp-cli-deploy or end with cli-deploy'
    )
  }
}

function assertSafeCliArchivePath(repoRoot, target) {
  const resolved = path.resolve(target)
  assertNotRepoRoot(repoRoot, resolved, 'cli package archive')
  if (!isInsideDirectory(repoRoot, resolved)) {
    throw new Error('CLI deploy archive path must stay inside the repo root')
  }
  if (path.basename(resolved) !== DEFAULT_CLI_ARCHIVE) {
    throw new Error(`CLI deploy archive must be named ${DEFAULT_CLI_ARCHIVE}`)
  }
}

function safeRemove(target) {
  rmSync(target, { recursive: true, force: true })
}

function safeRemoveFile(target) {
  unlinkSync(target)
}

export function getCleanupTargets({ repoRoot = defaultRepoRoot() } = {}) {
  const targets = []

  for (const name of CLEANUP_SCRATCH_NAMES) {
    const fullPath = path.join(repoRoot, name)
    if (existsSync(fullPath)) {
      targets.push({
        name,
        path: fullPath,
        relativePath: relativeFromRepo(repoRoot, fullPath),
        directory: statSync(fullPath).isDirectory()
      })
    }
  }

  return targets.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function assertRootScratchTarget(repoRoot, target) {
  if (path.dirname(target.path) !== repoRoot) {
    throw new Error(`cleanup target is outside the repo root: ${target.path}`)
  }
  if (
    target.name !== DEFAULT_CLI_DEPLOY_DIR &&
    target.name !== DEFAULT_CLI_ARCHIVE &&
    target.name !== 'test-e2e.txt'
  ) {
    throw new Error(`cleanup target is not a known scratch artifact: ${target.name}`)
  }
}

export function cleanupScratch({ repoRoot = defaultRepoRoot(), force = false } = {}) {
  const targets = getCleanupTargets({ repoRoot })
  for (const target of targets) {
    assertRootScratchTarget(repoRoot, target)
  }

  if (!force) {
    return {
      force,
      removed: [],
      wouldRemove: targets.map((target) => target.relativePath)
    }
  }

  for (const target of targets) {
    safeRemove(target.path)
  }

  return {
    force,
    removed: targets.map((target) => target.relativePath),
    wouldRemove: []
  }
}

function readRootPackage(repoRoot) {
  return JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
}

function writeCliPackageJson(repoRoot, outDir) {
  const rootPackage = readRootPackage(repoRoot)
  const dependencies = {}
  for (const name of ['ws', 'zod']) {
    const version = rootPackage.dependencies?.[name]
    if (version) {
      dependencies[name] = version
    }
  }

  writeFileSync(
    path.join(outDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'orca-cli',
        version: rootPackage.version,
        private: true,
        dependencies,
        bin: {
          orca: './cli/index.js'
        }
      },
      null,
      2
    )}\n`
  )
}

function writeCliShims(outDir) {
  const posixShim = [
    '#!/usr/bin/env sh',
    'DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
    'exec node "$DIR/cli/index.js" "$@"',
    ''
  ].join('\n')
  writeFileSync(path.join(outDir, 'orca'), posixShim)
  chmodSync(path.join(outDir, 'orca'), 0o755)

  writeFileSync(
    path.join(outDir, 'orca.cmd'),
    ['@echo off', 'node "%~dp0\\cli\\index.js" %*', ''].join('\r\n')
  )
}

function copyRequiredCliOutput(repoRoot, outDir) {
  for (const name of ['cli', 'shared']) {
    const source = path.join(repoRoot, 'out', name)
    if (!existsSync(source)) {
      throw new Error(`Missing build output: ${relativeFromRepo(repoRoot, source)}`)
    }
    cpSync(source, path.join(outDir, name), { recursive: true })
  }
}

function createArchive({ repoRoot, outDir, archivePath, execFile = execFileSync }) {
  const parent = path.dirname(archivePath)
  mkdirSync(parent, { recursive: true })
  execFile('tar', ['-czf', archivePath, '-C', outDir, '.'], {
    cwd: repoRoot,
    stdio: 'ignore'
  })
}

function runCommand(command, args, { cwd, stdio = 'inherit' } = {}, spawn = spawnSync) {
  const result = spawn(command, args, {
    cwd,
    shell: process.platform === 'win32',
    stdio
  })
  if (result.error) {
    throw result.error
  }
  if (result.signal) {
    throw new Error(`${command} stopped by signal ${result.signal}`)
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit ${result.status}`)
  }
}

export function createCliDeployPackage({
  repoRoot = defaultRepoRoot(),
  outDir = path.join(repoRoot, DEFAULT_CLI_DEPLOY_DIR),
  archivePath = path.join(repoRoot, DEFAULT_CLI_ARCHIVE),
  skipBuild = false,
  force = false,
  noArchive = false,
  execFile = execFileSync,
  spawn = spawnSync
} = {}) {
  const resolvedOutDir = path.resolve(outDir)
  const resolvedArchive = archivePath ? path.resolve(archivePath) : null
  assertSafeCliDeployDir(repoRoot, resolvedOutDir)
  if (resolvedArchive) {
    assertSafeCliArchivePath(repoRoot, resolvedArchive)
  }

  if (!skipBuild) {
    runCommand('pnpm', ['run', 'build:cli'], { cwd: repoRoot }, spawn)
  }

  if (existsSync(resolvedOutDir)) {
    if (!force) {
      throw new Error(
        `Output directory already exists: ${resolvedOutDir}. Pass --force to replace it.`
      )
    }
    safeRemove(resolvedOutDir)
  }

  if (!noArchive && resolvedArchive && existsSync(resolvedArchive)) {
    if (statSync(resolvedArchive).isDirectory()) {
      throw new Error(`Archive path is a directory: ${resolvedArchive}`)
    }
    if (!force) {
      throw new Error(`Archive already exists: ${resolvedArchive}. Pass --force to replace it.`)
    }
    safeRemoveFile(resolvedArchive)
  }

  mkdirSync(resolvedOutDir, { recursive: true })
  copyRequiredCliOutput(repoRoot, resolvedOutDir)
  writeCliPackageJson(repoRoot, resolvedOutDir)
  writeCliShims(resolvedOutDir)

  if (!noArchive && resolvedArchive) {
    createArchive({ repoRoot, outDir: resolvedOutDir, archivePath: resolvedArchive, execFile })
  }

  return {
    outDir: resolvedOutDir,
    archive: noArchive ? null : resolvedArchive,
    files: ['cli/', 'shared/', 'package.json', 'orca', 'orca.cmd']
  }
}

function runWindowsInstaller(flags, repoRoot, spawn = spawnSync) {
  if (process.platform !== 'win32') {
    throw new Error('windows rebuild-installer must run on Windows')
  }

  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(repoRoot, 'rebuild-windows-installer.ps1')
  ]
  if (hasFlag(flags, 'repackage-only')) {
    args.push('-RepackageOnly')
  }
  if (hasFlag(flags, 'force')) {
    args.push('-Force')
  }
  const outDir = getStringFlag(flags, 'out-dir')
  if (outDir) {
    args.push('-OutDir', outDir)
  }

  const result = spawn('powershell.exe', args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit'
  })
  if (result.error) {
    throw result.error
  }
  if (result.signal) {
    throw new Error(`Windows installer rebuild stopped by signal ${result.signal}`)
  }
  if (result.status !== 0) {
    throw new Error(`Windows installer rebuild failed with exit ${result.status}`)
  }
  return { ok: true, command: ['powershell.exe', ...args] }
}

function opsStatus(repoRoot) {
  return {
    repoRoot,
    commands: [
      'windows rebuild-installer',
      'cli package',
      'cleanup',
      'release latest-stable',
      'release create-draft',
      'release verify-assets',
      'release publish-complete-drafts'
    ],
    scratch: getCleanupTargets({ repoRoot }).map((target) => target.relativePath)
  }
}

function printTextResult(result) {
  if (result?.message) {
    console.log(result.message)
    return
  }
  console.log(JSON.stringify(result, null, 2))
}

function emitResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  printTextResult(result)
}

export async function runOps(argv = process.argv.slice(2), options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot())
  const env = options.env ?? process.env
  const { positionals, flags } = parseOpsArgs(argv)
  const json = hasFlag(flags, 'json')
  const [group, command] = positionals

  if (!group || group === 'help' || hasFlag(flags, 'help')) {
    console.log(HELP)
    return { help: true }
  }

  if (group === 'status') {
    const result = opsStatus(repoRoot)
    emitResult(result, json)
    return result
  }

  if (group === 'cleanup') {
    const result = cleanupScratch({ repoRoot, force: hasFlag(flags, 'force') })
    emitResult(result, json)
    return result
  }

  if (group === 'windows' && command === 'rebuild-installer') {
    const result = runWindowsInstaller(flags, repoRoot, options.spawnSync)
    emitResult(result, json)
    return result
  }

  if (group === 'cli' && command === 'package') {
    const outDir = resolveFromRepo(
      repoRoot,
      getStringFlag(flags, 'out-dir', DEFAULT_CLI_DEPLOY_DIR)
    )
    const archiveFlag = getStringFlag(flags, 'archive', DEFAULT_CLI_ARCHIVE)
    const result = createCliDeployPackage({
      repoRoot,
      outDir,
      archivePath: archiveFlag ? resolveFromRepo(repoRoot, archiveFlag) : null,
      skipBuild: hasFlag(flags, 'skip-build'),
      force: hasFlag(flags, 'force'),
      noArchive: hasFlag(flags, 'no-archive'),
      execFile: options.execFileSync
    })
    emitResult(result, json)
    return result
  }

  if (group === 'release') {
    const result = await runReleaseCommand({ command, positionals, flags, json, env })
    emitResult(result, json)
    return result
  }

  throw new Error(`Unknown ops command: ${positionals.join(' ')}`)
}

async function runReleaseCommand({ command, positionals, flags, json, env }) {
  const repo = getRepo(flags, env)

  if (command === 'latest-stable') {
    const token = getToken(env)
    if (!token) {
      throw new Error('GH_TOKEN or GITHUB_TOKEN must be set')
    }
    const releases = await fetchReleases(repo, token)
    const tag = latestStableDesktopReleaseTag(releases)
    return json ? { repo, tag } : { message: tag }
  }

  if (command === 'create-draft') {
    const tag = requireTag(positionals, command)
    const token = requireToken(env)
    const logs = []
    await createDraftRelease({ repo, tag, token, log: (line) => logs.push(line) })
    return json ? { repo, tag, logs } : { message: logs.join('\n') }
  }

  if (command === 'verify-assets') {
    const tag = requireTag(positionals, command)
    const token = requireToken(env)
    const result = await verifyRequiredReleaseAssets({ repo, tag, token })
    return json
      ? { repo, ...result }
      : { message: `Verified ${result.checked.length} assets for ${repo}@${tag}` }
  }

  if (command === 'publish-complete-drafts') {
    if (!hasFlag(flags, 'force')) {
      throw new Error('publish-complete-drafts makes releases public; pass --force to continue')
    }
    const token = requireToken(env)
    const logs = []
    const result = await publishCompleteDraftReleases({
      repo,
      token,
      log: (line) => logs.push(line)
    })
    writeGithubOutputs(result)
    return json ? { repo, ...result, logs } : { message: logs.join('\n') }
  }

  throw new Error(`Unknown release ops command: ${command ?? ''}`.trim())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOps().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
