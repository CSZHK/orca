import { net } from 'electron'

// Why: Orca's main process performs HTTP via Node's global fetch (undici), which
// does NOT honor the Electron session proxy configured by applyElectronProxySettings.
// On hosts that require a proxy, bare fetch() call sites (Codex backend usage,
// gitea/bitbucket/azure-devops clients, artifact cloud, hosted review, speech
// transcription, ...) silently bypass the user's proxy and fail. Delegating global
// fetch to Electron's net.fetch routes those through the configured defaultSession
// network stack: proxy rules, NO_PROXY bypass, cert handling and socks come free.
//
// The patch is applied ONLY while a proxy is configured. On hosts with no
// configured proxy we deliberately keep Node's undici fetch untouched, so behavior
// is byte-for-byte the pre-patch behavior (Node CA bundle / NODE_EXTRA_CA_CERTS,
// ignored system proxy, undici connection semantics). Routing no-proxy hosts
// through Chromium's net.fetch instead would silently change their TLS trust model
// and break hosts that reach private endpoints via NODE_EXTRA_CA_CERTS.
//
// This is main-process only. The CLI and SSH relay are separate entry points with
// their own network handling and must not import this module.
//
// net.fetch reads the current session proxy at request time, so later
// applyElectronProxySettings calls take effect without re-patching; only the
// install/uninstall decision (driven by whether a proxy is configured) is managed
// here.

const ORIGINAL_FETCH = globalThis.fetch

let patched = false

export function updateGlobalFetchProxyRouting(proxyConfigured: boolean): void {
  if (proxyConfigured && !patched) {
    globalThis.fetch = ((
      input: Parameters<typeof net.fetch>[0],
      init?: Parameters<typeof net.fetch>[1]
    ): ReturnType<typeof net.fetch> => net.fetch(input, init)) as typeof fetch
    patched = true
  } else if (!proxyConfigured && patched) {
    globalThis.fetch = ORIGINAL_FETCH
    patched = false
  }
}
