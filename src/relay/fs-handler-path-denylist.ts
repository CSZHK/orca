/**
 * Defense-in-depth denylist for relay filesystem operations.
 *
 * Why: although PTY access already grants full filesystem reach (see
 * docs/relay-fs-allowlist-removal.md), the structured FS API should not
 * silently operate on system-critical or user-credential paths. This
 * denylist catches accidental misuse, not a determined attacker.
 */
import { resolve, sep } from 'path'
import { homedir } from 'os'

const IS_WIN = process.platform === 'win32'

// Why: on Windows path comparison must be case-insensitive because
// C:\Windows and c:\windows refer to the same directory.
function normCase(p: string): string {
  return IS_WIN ? p.toLowerCase() : p
}

function toForwardSlash(p: string): string {
  return p.replaceAll('\\', '/')
}

// --- Unix sensitive prefixes ---------------------------------------------------
const UNIX_SYSTEM_PREFIXES = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/var',
  '/boot',
  '/proc',
  '/sys',
  '/dev',
]

// --- Windows sensitive prefixes ------------------------------------------------
function getWinSystemPrefixes(): string[] {
  const sysRoot = (process.env.SystemRoot || process.env.windir || 'C:\\Windows').toLowerCase()
  const sysDrive = sysRoot.split('\\')[0] || 'c:'
  return [
    toForwardSlash(sysRoot),
    `${toForwardSlash(sysDrive)}/program files`,
    `${toForwardSlash(sysDrive)}/program files (x86)`,
  ]
}
const WIN_SYSTEM_PREFIXES = IS_WIN ? getWinSystemPrefixes() : []

// --- User-home sensitive relative paths ----------------------------------------
// These are resolved against homedir() at check time.
const HOME_SENSITIVE_RELPATHS = [
  '.ssh',
  '.gnupg',
  '.bashrc',
  '.bash_profile',
  '.profile',
  '.zshrc',
  '.zprofile',
  '.config/systemd',
  '.aws/credentials',
  '.aws/config',
  '.kube/config',
  '.docker/config.json',
  '.npmrc',
  '.pypirc',
  '.netrc',
]

/**
 * Throws if `inputPath` targets a sensitive system or credential path.
 *
 * Call this after `expandTilde` but before any filesystem operation so
 * that both `~/.ssh/id_rsa` and `/home/user/.ssh/id_rsa` are caught.
 */
export function assertNotSensitivePath(inputPath: string): void {
  // resolve() normalizes and eliminates relative segments
  const abs = resolve(inputPath)

  if (abs.includes(`..${sep}`) || abs.endsWith('..')) {
    throw new Error(`Refusing to access sensitive path: ${inputPath}`)
  }

  const fwd = toForwardSlash(normCase(abs))
  const home = toForwardSlash(normCase(homedir()))

  // Check system prefixes (platform-specific)
  const systemPrefixes = IS_WIN ? WIN_SYSTEM_PREFIXES : UNIX_SYSTEM_PREFIXES
  for (const prefix of systemPrefixes) {
    // Match the exact dir or anything nested under it
    if (fwd === prefix || fwd.startsWith(`${prefix}/`)) {
      throw new Error(`Refusing to access sensitive path: ${inputPath}`)
    }
  }

  // Check user-home sensitive paths (cross-platform)
  for (const rel of HOME_SENSITIVE_RELPATHS) {
    const sensitive = `${home}/${rel}`
    if (fwd === sensitive || fwd.startsWith(`${sensitive}/`)) {
      throw new Error(`Refusing to access sensitive path: ${inputPath}`)
    }
  }
}
