import { buildConfiguredProxyEnv } from '../../shared/network/network-proxy'
import { readNetworkProxySettings } from '../browser/network/execution-routes/browser-network-proxy-settings-source'

// Why: hidden CLI subprocesses (git/gh/glab, codex app-server/login/heal/backfill)
// spawn from the main process, whose desktop-shell env carries no proxy. Settings
// source is registered once at startup via setBrowserNetworkProxySettingsResolver;
// with no proxy configured this returns {}, so consumers are a strict no-op.
export function configuredProxyEnv(): Record<string, string> {
  return buildConfiguredProxyEnv(readNetworkProxySettings())
}
