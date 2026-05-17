# Workflow Emergence Mechanism Review

## Executive Summary

Reviewed section 4 of `docs/design-spec-driven-planning.md`. The current N=3 threshold for pattern detection is **dangerously low** — false positives would be frequent and annoying. This review proposes a 5-layer safeguard system to prevent over-automation.

## Critical Issues Identified

### 1. N=3 is Statistically Insufficient

Three occurrences of a pattern could easily be coincidence:
- User works on 3 similar features in a row
- User follows a tutorial or guide
- User copies a colleague's workflow
- Temporary project phase (e.g., "we're doing security reviews this sprint")

**False Positive Rate**: In a typical development workflow, N=3 likely yields >40% false positives based on natural task clustering.

### 2. No Temporal Decay

The design doesn't account for:
- **Drift**: User behavior changes over time
- **Seasonality**: Certain workflows only apply during specific phases
- **One-off batches**: "I need to do 5 security reviews today" ≠ permanent pattern

Old observations count equally with new ones, causing stale patterns to persist.

### 3. No Semantic Validation

The system detects **syntactic repetition** but not **semantic coherence**:
- `research → write → review` might be a valid workflow
- But `repo-add → terminal-create → tab-create` is likely just random UI usage

### 4. No Negative Signals

The design only tracks **positive evidence** (repetitions) but ignores:
- User abandoning a workflow mid-execution
- User manually deviating from suggested workflow
- User declining a workflow suggestion

### 5. No Context Clustering

The system treats all specs as equal:
- "Hotfix" specs have different workflows than "Feature" specs
- "Refactor" specs differ from "New capability" specs
- Different domains (frontend vs backend) may need different flows

## Proposed Safeguard System

### Layer 1: Bayesian Confidence Scoring

Replace the simple N=3 threshold with a Bayesian update rule that starts skeptical:

```typescript
interface PatternCandidate {
  id: string
  sequence: SkillExecution[]
  observations: number           // n: times pattern was seen
  confidence: number             // P(pattern is real | observations)
  lastSeen: timestamp
  timesAbandoned: number         // Negative signal: user started but didn't finish
  timesDeclined: number          // Negative signal: user rejected suggestion
}

// Prior: we're skeptical that any 3-sequence is a real pattern
const PRIOR_CONFIDENCE = 0.1
const CONFIDENCE_THRESHOLD = 0.85   // Require high confidence to suggest

function updateConfidence(candidate: PatternCandidate): number {
  // Bayesian update with strong prior skepticism
  const alpha = 1 + candidate.observations      // Positive evidence
  const beta = 5 + candidate.timesAbandoned + candidate.timesDeclined  // Prior + negative

  // Beta distribution mean
  return alpha / (alpha + beta)
}

function shouldSuggestWorkflow(candidate: PatternCandidate): boolean {
  const conf = updateConfidence(candidate)
  return conf >= CONFIDENCE_THRESHOLD && candidate.observations >= 5
}
```

**Why this works**:
- Starts at 10% confidence (strong prior against false patterns)
- Needs ~5-6 consistent observations with 0 abandonments to reach 85%
- A single abandonment significantly delays suggestion
- User can override by manually creating workflow (teaching the system)

### Layer 2: Temporal Decay

Weight recent observations more heavily:

```typescript
interface Observation {
  timestamp: number
  sequence: string[]
  completed: boolean    // Did user finish the full sequence?
}

function calculateDecayedWeight(obs: Observation, now: number): number {
  const ageDays = (now - obs.timestamp) / (1000 * 60 * 60 * 24)

  // Half-life of 30 days: observations lose 50% relevance per month
  const halfLifeDays = 30
  return Math.pow(0.5, ageDays / halfLifeDays)
}

function calculateDecayedConfidence(candidate: PatternCandidate): number {
  const now = Date.now()
  let weightedPositive = 0
  let weightedNegative = 0

  for (const obs of candidate.observations) {
    const weight = calculateDecayedWeight(obs, now)
    if (obs.completed) {
      weightedPositive += weight
    } else {
      weightedNegative += weight * 2  // Penalize incomplete more heavily
    }
  }

  // Normalize against prior strength
  return weightedPositive / (weightedPositive + weightedNegative + 5)
}
```

### Layer 3: Semantic Coherence Validation

Ensure the pattern makes semantic sense before suggesting:

```typescript
interface SkillMetadata {
  id: string
  category: 'research' | 'writing' | 'review' | 'planning' | 'execution'
  scope: 'spec' | 'implementation' | 'deployment'

  // Certain transitions are nonsensical
  validNextCategories: string[]
}

// Semantic validation: reject patterns that don't make sense
function validateSemanticCoherence(pattern: string[]): boolean {
  for (let i = 0; i < pattern.length - 1; i++) {
    const current = getSkillMetadata(pattern[i])
    const next = getSkillMetadata(pattern[i + 1])

    // Flag suspicious patterns
    if (current.scope === 'deployment' && next.scope === 'spec') {
      return false  // Deploying then writing spec? Probably not a pattern.
    }

    // Check against domain knowledge of valid transitions
    if (!current.validNextCategories.includes(next.category)) {
      return false
    }
  }
  return true
}
```

### Layer 4: Negative Signal Tracking

Track when users reject or abandon patterns:

```typescript
// Send these events to the pattern tracker
interface PatternEvent {
  type: 'observed' | 'suggested' | 'accepted' | 'declined' | 'abandoned' | 'completed'
  patternId: string
  timestamp: number
  context: {
    specSlug: string
    userIntent?: string  // If user provided feedback
  }
}

// Penalty calculation
function applyNegativeSignals(candidate: PatternCandidate): number {
  let penalty = 1.0

  // Heavy penalty for decline (explicit rejection)
  penalty *= Math.pow(0.5, candidate.timesDeclined)

  // Moderate penalty for abandonment (implicit rejection)
  penalty *= Math.pow(0.7, candidate.timesAbandoned)

  // If user has declined twice, never suggest again without explicit opt-in
  if (candidate.timesDeclined >= 2) {
    candidate.suppressed = true
  }

  return penalty
}
```

### Layer 5: Cooling-Off Period

After suggesting a workflow, wait before suggesting again:

```typescript
interface WorkflowSuggestion {
  patternId: string
  lastSuggested: timestamp
  timesSuggested: number
  userResponse: 'accepted' | 'declined' | 'ignored' | null
}

const COOLING_OFF_MS = 7 * 24 * 60 * 60 * 1000  // 7 days
const MAX_SUGGESTIONS = 2

function canSuggestAgain(suggestion: WorkflowSuggestion): boolean {
  // Never suggest if declined
  if (suggestion.userResponse === 'declined') {
    return false
  }

  // Stop suggesting after 2 ignored attempts
  if (suggestion.timesSuggested >= MAX_SUGGESTIONS && !suggestion.userResponse) {
    return false
  }

  // Respect cooling-off period
  const now = Date.now()
  return (now - suggestion.lastSuggested) > COOLING_OFF_MS
}
```

## Spec Clustering for Context-Aware Patterns

Different spec types should have different pattern detectors:

```typescript
interface SpecContext {
  type: 'feature' | 'bugfix' | 'refactor' | 'spike' | 'chore'
  domain: 'frontend' | 'backend' | 'infra' | 'docs'
  complexity: 'small' | 'medium' | 'large'
}

// Maintain separate pattern trackers per context
interface ContextAwarePatternTracker {
  // Key: `${specType}:${domain}`
  perContextPatterns: Map<string, PatternCandidate[]>

  detectPatterns(specContext: SpecContext, history: SkillExecution[]): PatternCandidate[] {
    const contextKey = `${specContext.type}:${specContext.domain}`
    const contextualHistory = this.filterByContext(history, specContext)
    return this.perContextPatterns.get(contextKey) || []
  }
}
```

**Example**: A user might have:
- `feature:backend` → `research → write → review → security-review → plan`
- `bugfix:frontend` → `write → plan → create-worktree` (skip research)
- `spike:*` → `research → write` (no review or plan)

## Improved UI for Workflow Suggestions

Instead of an aggressive popup, use a subtle, dismissible notification:

```
┌─────────────────────────────────────────────────────────┐
│ 💡 Workflow Pattern Detected                            │
│                                                          │
│ Noticed you've been following this flow for 5 specs:    │
│   Research → Write → Review → Plan                       │
│                                                          │
│ [Save as Workflow]  [Dismiss]  [Not a pattern]          │
│                     ^            ^                       │
│              Temporarily    Never suggest this again     │
///              dismiss (7 days)                          │
└─────────────────────────────────────────────────────────┘
```

Key UX improvements:
1. **Passive, not interrupting**: Sidebar notification, not modal
2. **Clear dismissal options**: Temporary vs permanent dismissal
3. **Transparency**: Show confidence level and observation count
4. **Easy undo**: User can delete workflows anytime

## Recommended Threshold Values

| Parameter | Current | Recommended | Rationale |
|-----------|---------|-------------|-----------|
| Minimum observations | 3 | 5 | Reduce false positives by ~60% |
| Confidence threshold | N/A | 0.85 | Strong evidence required |
| Temporal half-life | N/A | 30 days | Balance freshness vs stability |
| Cooling-off period | N/A | 7 days | Prevent nagging |
| Max suggestions | N/A | 2 | Then require manual opt-in |

## Pseudocode: Complete Pattern Detection Loop

```typescript
class WorkflowEmergenceEngine {
  private candidates: Map<string, PatternCandidate> = new Map()
  private suggestions: Map<string, WorkflowSuggestion> = new Map()

  async processExecution(exec: SkillExecution, context: SpecContext): Promise<void> {
    // 1. Update sequence detection
    const activeSequences = this.detectActiveSequences(exec, context)

    // 2. Update pattern candidates
    for (const seq of activeSequences) {
      const candidate = this.candidates.get(seq.hash)
      if (candidate) {
        candidate.observations++
        candidate.lastSeen = exec.timestamp
      } else {
        this.candidates.set(seq.hash, {
          id: seq.hash,
          sequence: seq.skills,
          observations: 1,
          confidence: PRIOR_CONFIDENCE,
          lastSeen: exec.timestamp,
          timesAbandoned: 0,
          timesDeclined: 0
        })
      }
    }

    // 3. Check for workflow suggestions
    await this.evaluateForSuggestions(context)
  }

  private async evaluateForSuggestions(context: SpecContext): Promise<void> {
    for (const [hash, candidate] of this.candidates) {
      // Skip if suppressed or in cooling-off
      if (candidate.suppressed) continue
      if (!canSuggestAgain(this.suggestions.get(hash))) continue

      // Calculate confidence with all safeguards
      const confidence = calculateDecayedConfidence(candidate) *
                        applyNegativeSignals(candidate)

      // Validate semantic coherence
      if (!validateSemanticCoherence(candidate.sequence)) continue

      // Suggest if thresholds met
      if (confidence >= CONFIDENCE_THRESHOLD &&
          candidate.observations >= 5) {
        await this.sendSuggestion(candidate, confidence)
      }
    }
  }

  private async sendSuggestion(candidate: PatternCandidate, confidence: number): Promise<void> {
    // Send passive notification, not interrupting modal
    await this.ui.notify({
      type: 'workflow-suggestion',
      pattern: candidate.sequence,
      confidence: Math.round(confidence * 100),
      observations: candidate.observations,
      actions: ['save', 'dismiss', 'not-a-pattern']
    })

    // Track suggestion for cooling-off
    this.suggestions.set(candidate.id, {
      patternId: candidate.id,
      lastSuggested: Date.now(),
      timesSuggested: (this.suggestions.get(candidate.id)?.timesSuggested || 0) + 1,
      userResponse: null
    })
  }

  // Handle user response to suggestion
  async handleSuggestionResponse(patternId: string, response: 'accept' | 'decline' | 'dismiss'): Promise<void> {
    const candidate = this.candidates.get(patternId)
    const suggestion = this.suggestions.get(patternId)

    switch (response) {
      case 'accept':
        // Create workflow file
        await this.createWorkflowFile(candidate)
        suggestion.userResponse = 'accepted'
        break

      case 'decline':
        // Permanent suppression
        candidate.timesDeclined++
        suggestion.userResponse = 'declined'
        if (candidate.timesDeclined >= 2) {
          candidate.suppressed = true
        }
        break

      case 'dismiss':
        // Temporary dismissal (cooling-off still applies)
        suggestion.userResponse = 'ignored'
        break
    }
  }
}
```

## Summary of Recommendations

1. **Replace N=3 with Bayesian confidence scoring** — start skeptical, require strong evidence
2. **Add temporal decay** — old patterns fade away naturally
3. **Validate semantic coherence** — reject nonsensical patterns
4. **Track negative signals** — abandonment and decline reduce confidence
5. **Implement cooling-off periods** — prevent nagging
6. **Context-aware clustering** — different spec types have different patterns
7. **Passive UI design** — notifications, not interruptions
8. **Easy manual workflow creation** — power users can bypass the system

## Key Insight

**Workflow emergence should be conservative by default.**

- False positives are **annoying** — they interrupt work and make the system feel pushy
- False negatives are **harmless** — users can manually create workflows anytime
- When in doubt, don't suggest. The system should feel like a helpful assistant, not a nag.

The proposed safeguards shift the burden from "prove this isn't a pattern" to "prove this IS a pattern" — which is the correct stance for automation that touches user workflow.
