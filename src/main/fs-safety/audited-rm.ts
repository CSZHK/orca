/**
 * Audited recursive removal — every `rm -rf` in production code must go
 * through this module. Three layers of defense:
 *
 *   1. Local rules engine (instant, no network)
 *   2. Directory content scan (checks what's actually inside)
 *   3. Optional AI audit (when ANTHROPIC_API_KEY is set)
 *
 * Any layer returning DENY blocks the operation. The decision, path, and
 * directory listing are logged to `<userData>/rm-audit.log` for post-hoc
 * review.
 */

import { readdir, rm, appendFile, mkdir, stat } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join, resolve, parse, relative, sep } from 'path'
import { app } from 'electron'

// ── Types ──

type AuditVerdict = 'APPROVE' | 'DENY'

type AuditResult = {
  verdict: AuditVerdict
  layer: 'allowlist' | 'denylist' | 'content-scan' | 'ai-audit' | 'ai-fallback'
  reason: string
}

type AuditRecord = {
  timestamp: string
  path: string
  caller: string
  entries: string[]
  result: AuditResult
}

// ── Configuration ──

const MAX_ENTRIES_TO_LOG = 50
const AI_TIMEOUT_MS = 15_000

// Paths matching these prefixes are always safe to delete recursively
function getAllowlistPrefixes(): string[] {
  const t = tmpdir()
  const prefixes = [resolve(t)]

  try {
    const userData = app.getPath('userData')
    prefixes.push(
      resolve(userData, 'Cache'),
      resolve(userData, 'Code Cache'),
      resolve(userData, 'GPUCache'),
      resolve(userData, 'DawnGraphiteCache'),
      resolve(userData, 'DawnWebGPUCache'),
      resolve(userData, 'blob_storage'),
      resolve(userData, 'Session Storage'),
      resolve(userData, 'Shared Dictionary')
    )
  } catch {
    // app may not be ready yet during tests
  }

  return prefixes
}

// ── Layer 1: Local Rules ──

function checkLocalRules(targetPath: string): AuditResult | null {
  const resolved = resolve(targetPath)

  // Allowlist: tmpdir and known cache directories
  const allowlist = getAllowlistPrefixes()
  for (const prefix of allowlist) {
    const lowerResolved = resolved.toLowerCase()
    const lowerPrefix = prefix.toLowerCase()
    // Exact match or resolved is strictly inside prefix (path boundary check
    // prevents "C:\Temp" matching "C:\Temporary Evil Dir")
    if (
      lowerResolved === lowerPrefix ||
      lowerResolved.startsWith(`${lowerPrefix}${sep}`)
    ) {
      return { verdict: 'APPROVE', layer: 'allowlist', reason: `Inside safe prefix: ${prefix}` }
    }
  }

  // Denylist: filesystem root
  const root = parse(resolved).root
  if (resolved === root) {
    return { verdict: 'DENY', layer: 'denylist', reason: 'Cannot delete filesystem root' }
  }

  // Denylist: too shallow (depth < 3 from root)
  const rel = relative(root, resolved)
  const depth = rel.split(sep).filter(Boolean).length
  if (depth < 3) {
    return {
      verdict: 'DENY',
      layer: 'denylist',
      reason: `Path depth ${depth} is below minimum safe depth 3: ${resolved}`
    }
  }

  // Denylist: home directory itself
  const home = homedir()
  if (home && resolved.toLowerCase() === resolve(home).toLowerCase()) {
    return { verdict: 'DENY', layer: 'denylist', reason: 'Cannot delete home directory' }
  }

  // Denylist: home directory parent
  if (home && resolve(home).toLowerCase().startsWith(resolved.toLowerCase() + sep.toLowerCase())) {
    return { verdict: 'DENY', layer: 'denylist', reason: 'Path contains home directory' }
  }

  return null
}

// ── Layer 2: Content Scan ──

async function checkDirectoryContent(targetPath: string): Promise<AuditResult | null> {
  try {
    const s = await stat(targetPath)
    if (!s.isDirectory()) {
      return null
    }
  } catch {
    return null
  }

  let entries: string[]
  try {
    entries = await readdir(targetPath)
  } catch {
    return null
  }

  // A directory with > 500 top-level entries is almost certainly not something
  // we should be recursively deleting
  if (entries.length > 500) {
    return {
      verdict: 'DENY',
      layer: 'content-scan',
      reason: `Directory has ${entries.length} top-level entries, exceeds safe limit of 500`
    }
  }

  // Check for known important markers that should never be in a deletable dir
  const dangerousMarkers = [
    // Windows
    'Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos',
    'AppData', 'Program Files', 'Windows', 'System32',
    // macOS
    'Applications', 'Library', '.Trash',
    // Linux / Unix
    'bin', 'etc', 'usr', 'var', 'lib', 'opt', 'sbin',
    // User sensitive dirs (all platforms)
    '.ssh', '.gnupg', '.config', '.local'
  ]
  const lowerEntries = entries.map((e) => e.toLowerCase())
  for (const marker of dangerousMarkers) {
    if (lowerEntries.includes(marker.toLowerCase())) {
      return {
        verdict: 'DENY',
        layer: 'content-scan',
        reason: `Directory contains system marker "${marker}"`
      }
    }
  }

  return null
}

// ── Layer 3: AI Audit ──

async function checkWithAI(
  targetPath: string,
  entries: string[],
  caller: string
): Promise<AuditResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      verdict: 'DENY',
      layer: 'ai-fallback',
      reason: 'No ANTHROPIC_API_KEY set — AI audit unavailable, defaulting to DENY'
    }
  }

  const prompt = buildAuditPrompt(targetPath, entries, caller)

  try {
    const response = await callClaudeAPI(apiKey, prompt)
    const parsed = parseAuditResponse(response)
    return { ...parsed, layer: 'ai-audit' }
  } catch (error) {
    return {
      verdict: 'DENY',
      layer: 'ai-fallback',
      reason: `AI audit failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

function buildAuditPrompt(targetPath: string, entries: string[], caller: string): string {
  const entrySample = entries.slice(0, MAX_ENTRIES_TO_LOG).join('\n  ')
  const truncated = entries.length > MAX_ENTRIES_TO_LOG
    ? `\n  ... and ${entries.length - MAX_ENTRIES_TO_LOG} more`
    : ''

  return `You are a filesystem safety auditor. A program wants to recursively delete a directory.
Your job is to decide if this is safe. Respond with EXACTLY one line: "APPROVE" or "DENY: <reason>"

Context:
- Caller: ${caller}
- Path to delete: ${targetPath}
- Operating system tmpdir: ${tmpdir()}
- User home: ${homedir()}
- Top-level entries in the directory:
  ${entrySample}${truncated}

Rules:
- DENY if the path looks like a user project, home directory, or system directory
- DENY if the path is shallow (close to a drive root like D:\\ or C:\\)
- DENY if the directory contains files that look like user data (documents, source code, configs)
- APPROVE only if the path is clearly a temporary, cache, or build artifact directory
- When in doubt, DENY

Your verdict:`
}

async function callClaudeAPI(apiKey: string, prompt: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    })

    if (!res.ok) {
      throw new Error(`API returned ${res.status}: ${await res.text()}`)
    }

    const data = (await res.json()) as { content: { text: string }[] }
    return data.content[0].text.trim()
  } finally {
    clearTimeout(timeout)
  }
}

function parseAuditResponse(response: string): { verdict: AuditVerdict; reason: string } {
  const line = response.split('\n')[0].trim()
  if (line === 'APPROVE') {
    return { verdict: 'APPROVE', reason: 'AI approved the deletion' }
  }
  const denyMatch = /^DENY:\s*(.+)$/i.exec(line)
  if (denyMatch) {
    return { verdict: 'DENY', reason: `AI denied: ${denyMatch[1]}` }
  }
  return { verdict: 'DENY', reason: `AI response not parseable as APPROVE, treating as DENY: ${line}` }
}

// ── Audit Log ──

async function writeAuditLog(record: AuditRecord): Promise<void> {
  try {
    let logDir: string
    try {
      logDir = app.getPath('userData')
    } catch {
      logDir = join(homedir(), '.orca-audit')
    }
    await mkdir(logDir, { recursive: true })

    const logPath = join(logDir, 'rm-audit.log')
    const line = `${JSON.stringify(record)}\n`
    await appendFile(logPath, line, 'utf8')
  } catch {
    // Audit logging must never crash the app
  }
}

// ── Public API ──

/**
 * Audited recursive remove. Every production `rm(path, {recursive: true})`
 * MUST go through this function.
 *
 * @param targetPath  — the path to delete
 * @param caller      — a short description of why this deletion is happening
 *                      (e.g. "worktree orphan cleanup", "clone abort")
 */
export async function auditedRm(targetPath: string, caller: string): Promise<void> {
  const resolved = resolve(targetPath)

  // Layer 1: local rules
  const localResult = checkLocalRules(resolved)
  if (localResult) {
    if (localResult.verdict === 'APPROVE') {
      await writeAuditLog({
        timestamp: new Date().toISOString(),
        path: resolved,
        caller,
        entries: [],
        result: localResult
      })
      await rm(resolved, { recursive: true, force: true })
      return
    }
    await writeAuditLog({
      timestamp: new Date().toISOString(),
      path: resolved,
      caller,
      entries: [],
      result: localResult
    })
    console.warn(`[audited-rm] BLOCKED: ${localResult.reason} — ${resolved}`)
    return
  }

  // Layer 2: content scan
  let entries: string[] = []
  try {
    entries = await readdir(resolved)
  } catch {
    // Path may not exist or not be a directory — rm will handle it
  }

  const contentResult = await checkDirectoryContent(resolved)
  if (contentResult && contentResult.verdict === 'DENY') {
    await writeAuditLog({
      timestamp: new Date().toISOString(),
      path: resolved,
      caller,
      entries: entries.slice(0, MAX_ENTRIES_TO_LOG),
      result: contentResult
    })
    console.warn(`[audited-rm] BLOCKED: ${contentResult.reason} — ${resolved}`)
    return
  }

  // Layer 3: AI audit
  const aiResult = await checkWithAI(resolved, entries, caller)
  await writeAuditLog({
    timestamp: new Date().toISOString(),
    path: resolved,
    caller,
    entries: entries.slice(0, MAX_ENTRIES_TO_LOG),
    result: aiResult
  })

  if (aiResult.verdict === 'DENY') {
    console.warn(`[audited-rm] BLOCKED by AI: ${aiResult.reason} — ${resolved}`)
    return
  }

  console.info(`[audited-rm] APPROVED: ${aiResult.reason} — ${resolved}`)
  await rm(resolved, { recursive: true, force: true })
}
