import { describe, it, expect } from 'vitest'
import { findEnvPathKey } from './env-path-key'

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
})
