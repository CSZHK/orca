import { resolve, relative, parse as parsePath } from 'path'
import { homedir } from 'os'

const BLOCKED_SYSTEM_DIRS_UNIX = new Set([
  '/usr',
  '/etc',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/var',
  '/opt',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/tmp',
])

const BLOCKED_SYSTEM_DIRS_WIN = [
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
]

/**
 * Validate that `targetPath` is safe to permanently authorize.
 * Throws if the path is too broad (filesystem root, shallow depth,
 * home directory, or well-known system directory).
 */
export function validateExternalPathAuthorization(targetPath: string): void {
  const resolved = resolve(targetPath)
  const parsed = parsePath(resolved)
  const isWindows = process.platform === 'win32'

  if (resolved === parsed.root) {
    throw new Error(
      `Refusing to authorize filesystem root "${resolved}". Authorize a more specific path.`
    )
  }

  const belowRoot = relative(parsed.root, resolved)
  const segments = belowRoot.split(/[\\/]/).filter(Boolean)
  if (segments.length < 1) {
    throw new Error(
      `Refusing to authorize "${resolved}": path is the filesystem root. Authorize a specific directory.`
    )
  }

  const home = resolve(homedir())
  if (resolved === home) {
    throw new Error(
      `Refusing to authorize the home directory "${resolved}". Authorize a specific subdirectory instead.`
    )
  }

  if (isWindows) {
    const firstSegment = segments[0].toLowerCase()
    if (BLOCKED_SYSTEM_DIRS_WIN.includes(firstSegment)) {
      throw new Error(
        `Refusing to authorize system directory "${resolved}". Authorize a project-specific path instead.`
      )
    }
  } else {
    const lowerResolved = resolved.toLowerCase()
    for (const blocked of BLOCKED_SYSTEM_DIRS_UNIX) {
      if (lowerResolved === blocked || lowerResolved.startsWith(`${blocked}/`)) {
        throw new Error(
          `Refusing to authorize system directory "${resolved}". Authorize a project-specific path instead.`
        )
      }
    }
  }
}
