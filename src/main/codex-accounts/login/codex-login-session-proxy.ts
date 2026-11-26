import { configuredProxyEnv } from '../../network/configured-proxy-env'
import { runCodexLoginSession } from './codex-login-session'

export type { CodexLoginChild } from './codex-login-session'

// Fork: desktop-shell env carries no proxy and both login children (host `codex login`
// and the wsl.exe wrapper) must reach the auth server. Both branches funnel through
// deps.spawn, so inject there; WSL in-command exports stay authoritative for the guest.
export function runProxiedLoginSession(
  managedHomePath: string,
  dependencies: Parameters<typeof runCodexLoginSession>[1]
): Promise<void> {
  const inner = dependencies.spawn
  return runCodexLoginSession(managedHomePath, {
    ...dependencies,
    spawn: (request) => inner({ ...request, env: { ...request.env, ...configuredProxyEnv() } })
  })
}
