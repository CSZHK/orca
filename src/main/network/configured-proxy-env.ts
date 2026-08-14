import { buildConfiguredProxyEnv, type NetworkProxySettings } from '../../shared/network-proxy'

// Why: hidden CLI subprocesses (git/gh/glab, codex app-server/login/heal/backfill)
// spawn from the main process, whose env comes from the desktop shell and carries
// no proxy. They need the proxy injected into their spawn env; the settings source
// is Orca's persisted proxy config. A single module-level resolver keeps every
// spawn consumer consistent with the same settings snapshot, registered once at
// startup (index.ts). With no proxy configured buildConfiguredProxyEnv returns {},
// so all consumers are a strict no-op on hosts that need no proxy.

let networkProxySettingsResolver: (() => NetworkProxySettings) | null = null

export function setConfiguredProxySettingsResolver(resolver: () => NetworkProxySettings): void {
  networkProxySettingsResolver = resolver
}

export function configuredProxyEnv(): Record<string, string> {
  return buildConfiguredProxyEnv(networkProxySettingsResolver?.())
}
