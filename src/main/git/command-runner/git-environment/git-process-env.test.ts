import { afterEach, describe, expect, it } from 'vitest'
import { promptGuardGitEnv } from './git-process-env'
import { setNetworkProxySettingsSource } from '../../../browser/network/execution-routes/browser-network-proxy-settings-source'

describe('promptGuardGitEnv configured-proxy injection', () => {
  afterEach(() => {
    // Resolver reset: null yields no proxy env (same as unset).
    setNetworkProxySettingsSource(null)
  })

  it('injects the configured proxy env into git/gh/glab subprocesses', () => {
    setNetworkProxySettingsSource(() => ({ httpProxyUrl: 'http://127.0.0.1:51081' }))
    const env = promptGuardGitEnv({ PATH: '/usr/bin' })
    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:51081')
    expect(env.https_proxy).toBe('http://127.0.0.1:51081')
    // Why: localhost must never route through the proxy.
    expect(env.NO_PROXY).toBe('localhost,127.0.0.1,::1')
  })

  it('does not inject proxy env when no proxy is configured (regression safety)', () => {
    setNetworkProxySettingsSource(() => ({}))
    const env = promptGuardGitEnv({ PATH: '/usr/bin' })
    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.https_proxy).toBeUndefined()
  })
})
