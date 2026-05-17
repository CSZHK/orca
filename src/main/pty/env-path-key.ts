// Why: Windows stores PATH as `Path` in the registry. Once process.env is
// spread into a plain object, key lookup is case-sensitive and `obj.PATH`
// misses the `Path` entry. This helper finds the actual key so code that
// prepends to PATH doesn't accidentally create a duplicate that shadows
// the real value in the ConPTY environment block.
// Prefers uppercase `PATH` when present (POSIX convention and explicit
// caller override), then falls back to whatever casing Windows used.
export function findEnvPathKey(env: Record<string, string>): string {
  if ('PATH' in env) return 'PATH'
  return Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH'
}
