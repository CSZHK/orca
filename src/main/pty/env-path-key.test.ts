import { describe, it, expect } from 'vitest'
import { findEnvPathKey, normalizeWindowsEnvPathKey } from './env-path-key'

describe('findEnvPathKey', () => {
  it('returns PATH when uppercase key exists', () => {
    expect(findEnvPathKey({ PATH: '/usr/bin', HOME: '/home' })).toBe('PATH')
  })

  it('returns the Windows Path key when PATH is absent', () => {
    expect(findEnvPathKey({ Path: 'C:\\Windows', HOME: '/home' })).toBe('Path')
  })

  it('prefers uppercase PATH over Windows Path when both exist', () => {
    expect(findEnvPathKey({ Path: 'C:\\Windows', PATH: '/usr/bin' })).toBe('PATH')
  })

  it('returns PATH as default when no path key exists', () => {
    expect(findEnvPathKey({ HOME: '/home', USER: 'test' })).toBe('PATH')
  })

  it('removes duplicate Windows path keys while preserving the preferred PATH value', () => {
    const env = {
      Path: 'C:\\Windows\\System32',
      PATH: 'C:\\Users\\tester\\AppData\\Local\\Programs\\reclaude\\bin',
      FOO: 'bar'
    }

    normalizeWindowsEnvPathKey(env, 'win32')

    expect(env).toEqual({
      PATH: 'C:\\Users\\tester\\AppData\\Local\\Programs\\reclaude\\bin',
      FOO: 'bar'
    })
  })

  it('leaves non-Windows duplicate path keys unchanged', () => {
    const env = { Path: '/windows-ish', PATH: '/usr/bin' }

    normalizeWindowsEnvPathKey(env, 'linux')

    expect(env).toEqual({ Path: '/windows-ish', PATH: '/usr/bin' })
  })
})
