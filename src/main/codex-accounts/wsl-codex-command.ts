import { buildPosixCommandPathLookupScript } from '../../shared/posix-command-path-lookup'
import {
  buildWslLoginShellCommand,
  escapeWslShCommandForWindows,
  quotePosixShell
} from '../../shared/wsl-login-shell-command'

export const WSL_CODEX_AVAILABILITY_TIMEOUT_MS = 5_000
export const WSL_CODEX_NOT_FOUND_MESSAGE = 'Codex CLI not found in the WSL login-shell PATH.'

export function buildWslCodexAvailabilityArgs(distro: string): string[] {
  const command = [buildCodexPathLookup(), '[ -n "$resolved" ]'].join('\n')
  return buildWslCodexShellArgs(distro, command)
}

export function buildWslCodexIdentityArgs(distro: string): string[] {
  const command = [
    buildCodexPathLookup(),
    'if [ -z "$resolved" ]; then',
    `  printf '%s\\n' '${WSL_CODEX_NOT_FOUND_MESSAGE}' >&2`,
    '  exit 127',
    'fi',
    'printf \'%s\\n\' "$resolved"',
    'exec "$resolved" --version'
  ].join('\n')
  return buildWslCodexShellArgs(distro, command)
}

function proxyExportCommands(proxyEnv: Record<string, string> | undefined): string[] {
  // Why: Windows-side env does not cross into the distro without WSLENV, so the
  // configured proxy must be exported inside the Linux command for the inner codex.
  // Tradeoff (matches claude-pty.ts:280): a proxy URL with credentials rides the
  // wsl.exe argv, which is visible to same-session processes on Windows. Values
  // are single-quote-escaped here; a WSLENV-based forward would be more discreet
  // but is a larger refactor shared with the Claude path.
  return Object.entries(proxyEnv ?? {}).map(
    ([key, value]) => `export ${key}=${quotePosixShell(value)}`
  )
}

export function buildWslCodexAppServerArgs(
  distro: string,
  linuxHomePath: string,
  proxyEnv?: Record<string, string>
): string[] {
  const command = [
    buildCodexPathLookup(),
    'if [ -z "$resolved" ]; then',
    `  printf '%s\\n' '${WSL_CODEX_NOT_FOUND_MESSAGE}' >&2`,
    '  exit 127',
    'fi',
    `export CODEX_HOME=${quotePosixShell(linuxHomePath)}`,
    ...proxyExportCommands(proxyEnv),
    'exec "$resolved" app-server'
  ].join('\n')
  return buildWslCodexShellArgs(distro, command)
}

export function buildWslCodexLoginArgs(
  distro: string,
  linuxHomePath: string,
  proxyEnv?: Record<string, string>
): string[] {
  const command = [
    buildCodexPathLookup(),
    'if [ -z "$resolved" ]; then',
    "  printf '%s\\n' 'Codex CLI not found in the WSL login-shell PATH.' >&2",
    '  exit 127',
    'fi',
    `export CODEX_HOME=${quotePosixShell(linuxHomePath)}`,
    ...proxyExportCommands(proxyEnv),
    'exec "$resolved" login'
  ].join('\n')
  return buildWslCodexShellArgs(distro, command)
}

function buildCodexPathLookup(): string {
  return buildPosixCommandPathLookupScript({ kind: 'literal', value: 'codex' })
}

function buildWslCodexShellArgs(distro: string, command: string): string[] {
  // Why: Codex must use the distro user's configured login shell, whose PATH
  // can differ from a hard-coded non-login bash invocation.
  return [
    '-d',
    distro,
    '--',
    'sh',
    '-c',
    escapeWslShCommandForWindows(buildWslLoginShellCommand(command))
  ]
}
