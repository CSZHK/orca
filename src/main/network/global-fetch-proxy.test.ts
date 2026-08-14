import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { updateGlobalFetchProxyRouting } from './global-fetch-proxy'

const { netFetchMock } = vi.hoisted(() => ({ netFetchMock: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: netFetchMock } }))

describe('updateGlobalFetchProxyRouting', () => {
  const originalFetch = globalThis.fetch
  let update: typeof updateGlobalFetchProxyRouting

  beforeEach(async () => {
    vi.resetModules()
    netFetchMock.mockReset()
    update = (await import('./global-fetch-proxy')).updateGlobalFetchProxyRouting
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('delegates global fetch to Electron net.fetch only when a proxy is configured', async () => {
    netFetchMock.mockResolvedValue({ ok: true } as Response)
    update(true)

    const result = await globalThis.fetch('https://example.com/api', { method: 'POST' })

    expect(netFetchMock).toHaveBeenCalledTimes(1)
    expect(netFetchMock).toHaveBeenCalledWith('https://example.com/api', { method: 'POST' })
    expect(result).toEqual({ ok: true })
  })

  it('keeps the original undici fetch untouched when no proxy is configured (zero regression)', async () => {
    // Why: no-proxy hosts must behave byte-for-byte as before — the patch must
    // not swap in Chromium's TLS model when no proxy is set.
    update(false)
    expect(globalThis.fetch).toBe(originalFetch)
    expect(netFetchMock).not.toHaveBeenCalled()
  })

  it('restores the original fetch when the proxy is removed at runtime', async () => {
    update(true)
    expect(globalThis.fetch).not.toBe(originalFetch)
    update(false)
    expect(globalThis.fetch).toBe(originalFetch)
  })

  it('is idempotent — installing twice does not double-wrap', () => {
    update(true)
    const first = globalThis.fetch
    update(true)
    expect(globalThis.fetch).toBe(first)
    expect(netFetchMock).not.toHaveBeenCalled()
  })
})
