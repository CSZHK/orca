import { buildPosixCommandPathLookupScript } from '../../shared/shell/command-resolution/posix-command-path-lookup'
import {
  buildWslCapturedLoginShellCommand,
  buildWslExecArgs,
  buildWslLoginShellCommand
} from '../../shared/shell/wsl/wsl-login-shell-command'
import { quotePosixShell } from '../../shared/shell/launch/shell-argument-quoting'
import { configuredProxyEnv } from '../network/configured-proxy-env'

export const WSL_CODEX_AVAILABILITY_TIMEOUT_MS = 5_000
export const WSL_CODEX_NOT_FOUND_MESSAGE = 'Codex CLI not found in the WSL login-shell PATH.'

/** Exits 0 only when `codex` resolves on the login PATH the runner supplies. */
export function buildWslCodexAvailabilityScript(): string {
  return [buildCodexPathLookup(), '[ -n "$resolved" ]'].join('\n')
}

export type WslCodexIdentityProbe = {
  args: string[]
  /** The `<path>\n<version>` payload, or null when the fence never appeared. */
  readStdout: (stdout: string) => string | null
}

/** Fence off login banners; exec leaves no closing fence after the path/version payload. */
export function buildWslCodexIdentityProbe(distro: string): WslCodexIdentityProbe {
  const command = [
    buildCodexPathLookup(),
    'if [ -z "$resolved" ]; then',
    `  printf '%s\\n' '${WSL_CODEX_NOT_FOUND_MESSAGE}' >&2`,
    '  exit 127',
    'fi',
    'printf \'%s\\n\' "$resolved"',
    'exec "$resolved" --version'
  ].join('\n')
  const captured = buildWslCapturedLoginShellCommand(command)
  return {
    args: buildWslExecArgs(distro, ['sh', '-c', captured.command]),
    readStdout: captured.readStdout
  }
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
  appServerArgs: readonly string[] = ['app-server'],
  proxyEnv: Record<string, string> = configuredProxyEnv()
): string[] {
  const command = [
    buildCodexPathLookup(),
    'if [ -z "$resolved" ]; then',
    `  printf '%s\\n' '${WSL_CODEX_NOT_FOUND_MESSAGE}' >&2`,
    '  exit 127',
    'fi',
    `export CODEX_HOME=${quotePosixShell(linuxHomePath)}`,
    ...proxyExportCommands(proxyEnv),
    `exec "$resolved" ${appServerArgs.map(quotePosixShell).join(' ')}`
  ].join('\n')
  return buildWslCodexShellArgs(distro, command)
}

export function buildWslCodexLoginArgs(
  distro: string,
  linuxHomePath: string,
  options: { orcaOpensSignInLink?: boolean; proxyEnv?: Record<string, string> } = {}
): string[] {
  const proxyEnv = options.proxyEnv ?? configuredProxyEnv()
  const command = [
    buildCodexPathLookup(),
    'if [ -z "$resolved" ]; then',
    "  printf '%s\\n' 'Codex CLI not found in the WSL login-shell PATH.' >&2",
    '  exit 127',
    'fi',
    `export CODEX_HOME=${quotePosixShell(linuxHomePath)}`,
    ...(options.orcaOpensSignInLink ? ['export BROWSER=true'] : []),
    ...proxyExportCommands(proxyEnv),
    'exec "$resolved" login'
  ].join('\n')
  return buildWslCodexShellArgs(distro, command)
}

function buildCodexPathLookup(): string {
  // Match detection by skipping Windows mount directories when resolving the guest CLI.
  return buildPosixCommandPathLookupScript(
    { kind: 'literal', value: 'codex' },
    { skipWindowsMountDirs: true }
  )
}

function buildWslCodexShellArgs(distro: string, command: string): string[] {
  // Use the configured login shell so CLI launches inherit the user's PATH.
  return buildWslExecArgs(distro, ['sh', '-c', buildWslLoginShellCommand(command)])
}
