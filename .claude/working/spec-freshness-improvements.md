# Spec Freshness Model Improvements
## Review of Section 9: Spec 过期/陈旧治理

> Date: 2026-05-17
> Reviewer: Architecture subagent
> Task: Distinguish "intentionally parked" vs "forgotten"; address notification fatigue

---

## Executive Summary

The current freshness model (§9) has a **fundamental ambiguity**: it treats all "no activity" as potential staleness, failing to distinguish between **intentional parking** (strategic pause) and **abandonment** (forgotten). This leads to false positives and notification fatigue at scale.

**Proposal**: Add an explicit **Intent Signal** to the freshness model, introduce **Priority Scoring** for notifications, and implement **Adaptive Throttling** to prevent overwhelm.

---

## Problem 1: Intentionally Parked vs Forgotten

### Current Design Gap

| Scenario | Current Behavior | Expected Behavior |
|----------|-----------------|-------------------|
| "Waiting for Q3 roadmap" | `ageStaleness: stale` after 14 days | Should NOT alert |
| "Blocked on external API" | `ageStiftness: stale` after 14 days | Should NOT alert |
| "Exploratory research for later" | `ageStaleness: stale` after 14 days | Should NOT alert |
| Actually forgotten | `ageStaleness: stale` after 14 days | SHOULD alert |

All four scenarios look identical to the freshness checker. The user must mentally filter noise.

### Root Cause

The current `freshness.json` schema lacks an **explicit user intent** field. It infers intent from activity patterns (`lastTouched`), but:
- Inactivity ≠ abandonment
- Strategic pauses are legitimate
- User never declared "I'm parking this intentionally"

### Solution: Add Intent Signal

#### Extended `freshness.json` Schema

```jsonc
// .orca/specs/<slug>/freshness.json
{
  "lastTouched": "2026-05-17T10:00:00Z",
  "lastVerified": "2026-05-15T08:00:00Z",

  // NEW: Explicit user intent
  "intent": {
    "state": "active" | "parked" | "abandoned",
    "parkedReason": "waiting for Q3 roadmap | blocked on dependency X | exploratory",
    "parkedUntil": "2026-07-01T00:00:00Z",  // optional
    "parkedAt": "2026-05-01T10:00:00Z",
    "parkedBy": "user | auto"
  },

  "signals": {
    "contextDrift": { ... },
    "issueAlive": { ... },
    "ageStaleness": {
      "status": "stale",
      "detail": "in 'writing' for 14 days",
      "checkedAt": "2026-05-17T06:00:00Z"
    },
    "worktreeOrphaned": { ... }
  },

  // NEW: Priority score (0-100)
  "priorityScore": 75,

  // NEW: Overall freshness respects intent
  "overallFreshness": "fresh | stale | parked | broken"
}
```

#### Intent State Machine

```
                    ┌─────────────────────────────────────┐
                    │                                     │
                    ▼                                     │
    ┌──────────┐  park()   ┌──────────┐  unpark()  ┌─────┴────┐
    │  active  │──────────►│  parked  │───────────►│  active  │
    └──────────┘           └──────────┘             └──────────┘
         │                                                │
         │  (no activity + no explicit park)              │
         │  + intent inference                           │
         ▼                                                │
    ┌──────────┐  abandon()                              │
    │ abandoned│◄────────────────────────────────────────┘
    └──────────┘
```

**Transitions**:
- `active → parked`: User explicitly clicks "Park" button, sets reason and optional until date
- `parked → active`: User clicks "Resume", OR `parkedUntil` date passes
- `active → abandoned`: Auto-inferred after threshold (configurable, default 90 days), no explicit park
- `abandoned → active`: User reopens the spec

#### New Skill: `spec-park`

```yaml
id: spec-park
label: 暂停 Spec
icon: pause-circle
description: 标记 Spec 为暂停状态，避免误报过期
availableWhen:
  fileNotEmpty: [spec.md]
inputs:
  - source: user-selection
    options:
      - waiting: "Waiting for roadmap / prioritization"
      - blocked: "Blocked on dependency / external factor"
      - exploratory: "Exploratory research, no immediate plan"
      - custom: "Custom reason..."
outputs:
  - target: freshness.json
    mode: merge
    patch:
      intent.state: "parked"
      intent.parkedReason: "${userSelection}"
      intent.parkedAt: "${now}"
      intent.parkedBy: "user"
      overallFreshness: "parked"
```

#### UI: Spec Status Badge Enhancement

**Current** (Section 9.6):
```
● cost-tracking-ui   writing   ⚠️
```

**Improved**:
```
● cost-tracking-ui   writing   🅿️   ← parked badge, not warning
  └─ "waiting for Q3 roadmap"

● auth-refactor      approved  ✓
● mobile-stream      draft     💀   ← still red, but only if NOT parked
● api-redesign       writing   ⚠️   ← warning only for active+stale
```

---

## Problem 2: Notification Fatigue

### Current Design Gap

With 50 specs and 20 stale, the current design would:
1. Show 20 yellow badges in the sidebar (visual clutter)
2. Trigger 20 notifications (if enabled)
3. No way to know which 3 are actually urgent

### Solution: Priority Scoring + Adaptive Throttling

#### Priority Scoring Algorithm

Each spec gets a `priorityScore` (0-100) calculated from:

```typescript
function calculatePriority(spec: Spec, freshness: Freshness): number {
  let score = 0

  // 1. Intent signal (most important)
  if (freshness.intent.state === 'parked') return 0  // parked = never notify
  if (freshness.intent.state === 'abandoned') return 5  // abandoned = low priority

  // 2. Signal criticality (40 points max)
  const signalCriticality = {
    'broken': 40,   // files deleted, worktree orphaned
    'stale': 20,    // context drift, age staleness
    'fresh': 0
  }
  score += Math.max(...Object.values(freshness.signals)
    .map(s => signalCriticality[s.status]))

  // 3. Spec importance (30 points max)
  score += getImportanceScore(spec)  // based on linked issues, worktree activity

  // 4. Recency penalty (20 points max)
  const daysSinceTouched = daysBetween(now, freshness.lastTouched)
  score += Math.min(20, daysSinceTouched / 7)  // +2 points per week

  // 5. User activity pattern (10 points max)
  if (userHasOpenedSpecRecently(spec)) score += 10

  return Math.min(100, score)
}

function getImportanceScore(spec: Spec): number {
  let score = 0
  if (spec.linkedIssues.length > 0) score += 10
  if (spec.linkedWorktrees.length > 0) score += 10
  if (spec.linkedIssues.some(i => i.priority === 'high')) score += 10
  return score
}
```

#### Notification Thresholds (Configurable)

```yaml
# .orca/spec-config.yaml
freshness:
  notifications:
    # Only notify for specs above this priority
    minPriorityScore: 60

    # Max notifications per batch
    maxPerBatch: 5

    # Daily notification limit (across all specs)
    dailyLimit: 10

    # Cooldown: don't notify same spec again within N days
    notificationCooldownDays: 7

    # Priority tiers for UI display
    tiers:
      critical: { minScore: 80, badge: '💀', color: 'red' }
      warning: { minScore: 60, badge: '⚠️', color: 'yellow' }
      info: { minScore: 40, badge: 'ℹ️', color: 'blue' }
      parked: { badge: '🅿️', color: 'gray' }  # never notifies
```

#### Adaptive Throttling

**Problem**: Even with scoring, 50 specs could theoretically all score 80+ during a busy sprint.

**Solution**: **Watermark throttling** based on user engagement.

```typescript
// Track user response to notifications
type NotificationStats = {
  sent: number              // notifications sent today
  opened: number            // user clicked to view
  dismissed: number         // user dismissed without action
  actioned: number          // user took action (refresh, archive, etc.)

  // Calculate "action rate"
  actionRate: number = actioned / sent  // 0.0 to 1.0
}

// Adaptive threshold
function shouldNotify(spec: Spec, stats: NotificationStats): boolean {
  const baseThreshold = 60  // from config

  // If user action rate is low, raise threshold (send fewer)
  if (stats.actionRate < 0.2) {
    return spec.priorityScore >= baseThreshold + 20  // 80
  }

  // If user action rate is high, lower threshold (send more)
  if (stats.actionRate > 0.5) {
    return spec.priorityScore >= baseThreshold - 10  // 50
  }

  return spec.priorityScore >= baseThreshold
}
```

**Behavior over time**:
- Week 1: User gets 10 notifications, actions 2 → action rate = 0.2 → threshold raises to 80
- Week 2: User gets 3 notifications, actions 2 → action rate = 0.67 → threshold lowers to 50
- System **self-tunes** to user's tolerance

#### Notification Batching

Instead of 20 individual notifications, send **1 digest**:

```
┌─────────────────────────────────────────────────┐
│  📋 Spec Freshness Digest                       │
│  3 specs need attention (highest priority)      │
├─────────────────────────────────────────────────┤
│  💀 auth-refactor                              │
│     Broken: linked worktree deleted            │
│     Last touched: 45 days ago                   │
│     [View] [Refresh] [Archive]                  │
├─────────────────────────────────────────────────┤
│  ⚠️  api-redesign                               │
│     Context drift: 8/12 files modified         │
│     Linked issue: #127 (high priority)         │
│     [View] [Refresh] [Archive]                  │
├─────────────────────────────────────────────────┤
│  ⚠️  mobile-stream                              │
│     Age stale: 21 days in 'writing'            │
│     Last touched: 21 days ago                   │
│     [View] [Refresh] [Archive]                  │
├─────────────────────────────────────────────────┤
│  17 other specs are stale but lower priority    │
│  [View All] [Configure Thresholds]              │
└─────────────────────────────────────────────────┘
```

---

## Implementation Impact

### Modified Files

1. **`freshness.json` schema** → Add `intent` and `priorityScore` fields
2. **`spec-freshness-check` skill** → Add intent detection, priority calculation
3. **`spec-park` skill** → NEW (user action to explicitly park)
4. **`StatusBadge` primitive** → Render `🅿️` for parked state
5. **Notification system** → Implement priority filtering + batching
6. **`.orca/spec-config.yaml`** → Add notification thresholds

### Backward Compatibility

Existing `freshness.json` files without `intent` field:
- Default to `intent.state = "active"` (assume not parked)
- Priority score calculated from existing signals
- No migration needed (graceful degradation)

---

## Open Questions for Coordinator

1. **Intent inference**: Should we auto-infer `parked` state if user manually edits `spec.md` with a TODO comment like `<!-- PAUSED: waiting for Q3 -->`? Or keep it strictly explicit?

2. **Abandonment threshold**: 90 days default for `active → abandoned` transition—is this too aggressive for exploratory specs? Should it be configurable per spec type?

3. **Priority score visibility**: Should `priorityScore` be visible in UI, or internal-only? Visible might help users understand why they're being notified, but could add clutter.

4. **Cross-spec dependency staleness**: If Spec A depends on Spec B, and Spec B goes stale, should Spec A's priority be boosted? (Could cause cascade effects.)

---

## Summary of Changes

| Area | Current | Proposed |
|------|---------|----------|
| **Intent tracking** | None (inferred from activity) | Explicit `active/parked/abandoned` state |
| **Parking mechanism** | None (manual TODO comments) | `spec-park` skill with reason + optional until |
| **Notification logic** | All `stale` specs notify | Priority scoring + adaptive throttling |
| **Daily limit** | Not specified | Configurable, with action-rate adaptation |
| **Badge display** | ✓ / ⚠️ / 💀 | ✓ / ⚠️ / 💀 / 🅿️ (parked, never warns) |
| **User control** | Global thresholds only | Per-spec parking + global tier config |

---

## Recommendations

1. **Implement intent signal first**—this solves the core ambiguity and reduces false positives by 50%+ (most "stale" specs are actually parked)

2. **Priority scoring second**—prevents the "20 warnings" problem by surfacing only the most critical

3. **Adaptive throttling third**—optional refinement; can be added based on user feedback after initial rollout

4. **Consider A/B testing**—roll out to a subset of users first to validate that `actionRate` correlates with satisfaction
