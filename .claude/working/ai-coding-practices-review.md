# AI Coding Best Practices Review
## Spec-Driven Planning System

**Date**: 2026-05-17
**Reviewer**: AI Coding Workflow Expert
**Document**: docs/design-spec-driven-planning.md

---

## Executive Summary

The Spec-Driven Planning design has a solid architecture (UI primitives + Skill atoms + file-based truth) but the **default workflow is fundamentally waterfall-like** and misaligned with how AI coding actually works best. The workflow emergence mechanism is good, but the built-in skills set a sequential example (research→write→review→plan→create-worktree) that doesn't support rapid iteration.

**Recommendation**: Add granular state tracking, parallel skill execution, and fast-iteration presets before v1.5 release.

---

## Critical Issues

### Issue 1: Linear Skill Flow is Anti-Thetical to AI Coding

**Current state**: Built-in skills execute sequentially with gates:
```
research → write → review → plan → create-worktree
```

**Why this matters for AI coding**:
- AI coding is **iterative and incremental** - write a little, test a little, refine
- AI coding is **parallelizable** - research can continue while writing
- AI coding benefits from **early feedback** - review should be continuous

**Evidence from AI coding practice**:
- Claude Code and similar tools work best when you can refine requirements while implementation is in progress
- The "prompt → response → refine" loop is measured in minutes, not phases
- Developers frequently jump back to research after discovering something during implementation

### Issue 2: Monolithic State Tracking

**Current state**: Single spec status (draft/writing/review/approved)

**Problem**:
- Can't re-run research without invalidating approved design
- Can't update just one section of context.json
- No way to have "requirements approved" while "design is draft"

**Impact**: Forces sequential execution instead of parallel work

### Issue 3: Review as a Gate, Not Continuous Process

**Current state**: Review is a separate skill that produces `reviews/*.md` files

**Problem**:
- Creates a "review phase" that feels like a code review gate
- Doesn't provide inline feedback while writing
- No mechanism for continuous improvement

**What AI coding needs**:
- Inline suggestions and critiques as you write
- "Review mode" that runs in background
- Ability to accept/reject individual suggestions

---

## Specific Recommendations

### Recommendation 1: Granular Per-Section State Tracking

Replace monolithic status with section-level tracking:

```typescript
type SpecSectionState = {
  section: 'requirements' | 'design' | 'tasks' | 'context'
  status: 'empty' | 'draft' | 'approved' | 'stale'
  lastVerified: string
  approvedBy?: 'user' | 'ai-agent-name'
  version: number
}

type SpecStatus = {
  sections: SpecSectionState[]
  overall: 'draft' | 'in-review' | 'approved' | 'implemented' | 'archived'
}
```

**Benefits**:
- Re-run research without invalidating approved design
- Parallel skill work on different sections
- Selective freshness checks per section
- Clear visual indication of which parts need attention

### Recommendation 2: Parallel Skill Execution

Allow skills to run concurrently:

```yaml
id: spec-research
execution:
  type: orchestration
  mode: parallel  # NEW: allow concurrent with write
  dependsOn: []   # empty = can run anytime

id: spec-write
execution:
  type: orchestration
  mode: parallel
  dependsOn: []   # can start with partial research
  mergeStrategy: latest  # if research finishes during write, merge latest
```

**Benefits**:
- Start writing with partial research
- Research can continue in background while writing
- Reduces total turnaround time

### Recommendation 3: Continuous/Inline Review

Add streaming review mode:

```yaml
id: spec-continuous-review
description: AI provides inline comments as you write, not a separate review step
execution:
  type: orchestration
  mode: streaming  # NEW: real-time feedback
  trigger: onEdit  # runs on every significant edit
  output:
    target: spec.md
    mode: inline-comments  # adds <!-- AI: ... --> comments
```

**UI Behavior**:
- Comments appear in DocEditor as marginal notes
- User can accept (incorporate into text) or dismiss
- Review runs in background, not as a blocking phase

### Recommendation 4: Fast-Iteration Workflow Preset

Add a preset optimized for AI coding:

```yaml
# .orca/workflows/quick-iteration.yaml
id: quick-spec
label: Quick Iteration (for AI coding)
description: Research + Write in parallel, continuous review, skip formal gates
steps:
  - skill: spec-research
    parallelWith: spec-write
  - skill: spec-write
    mode: incremental  # can save intermediate states
  - skill: spec-continuous-review
    mode: background
  - skill: spec-create-worktree
    gate: false  # auto-advance
```

**Difference from "standard-feature" workflow**:
- No formal review gate (continuous instead)
- Research and write overlap
- Auto-advance to worktree creation
- Optimized for speed, not ceremony

### Recommendation 5: Bi-Directional Spec-to-Code Feedback

Add skill to update spec from implementation learnings:

```yaml
id: spec-reconcile-from-code
description: After implementation work, update spec with what actually worked
availableWhen:
  worktreeHasCommits: true
inputs:
  - source: worktree/commits
  - source: spec.md
outputs:
  - target: spec.md
    mode: merge  # add "Implementation Notes" section
  - target: implementation-plan.json
    mode: update-completed-tasks
```

**Why this matters**:
- Specs should be living documents, not static artifacts
- Implementation often reveals better approaches
- Creates a feedback loop that improves both spec and code

### Recommendation 6: Incremental Context Updates

Allow partial context.json updates:

```yaml
id: spec-update-context-section
description: Update only one section of context (e.g., just API surfaces)
inputs:
  - source: spec.md
  - source: context.json
outputs:
  - target: context.json
    mode: merge-section  # NEW: merge only specified section
    section: 'apis'  # only update this key
```

**Benefits**:
- Don't need to re-run full research to update one area
- Faster iteration cycles
- Less disruptive to other sections

---

## What Works Well

The following aspects of the design are well-aligned with AI coding:

1. **File-based truth source**: All state in `.orca/specs/`, Git-tracked
2. **Skill composability**: Skills are independent and can be combined
3. **Workflow emergence**: System learns from patterns, doesn't prescribe
4. **Freshness detection**: Recognizes that specs go stale
5. **UI as primitives**: No hardcoded workflow logic in UI

The architecture is sound; the default workflow needs adjustment.

---

## Priority Actions for v1.5

| Priority | Action | Impact | Effort |
|----------|--------|--------|--------|
| P0 | Add granular section state tracking | High | Medium |
| P0 | Create quick-iteration workflow preset | High | Low |
| P1 | Add parallel skill execution support | High | Medium |
| P1 | Continuous review mode | Medium | Medium |
| P2 | Bi-directional spec-to-code feedback | Medium | High |
| P2 | Incremental context updates | Low | Low |

---

## Conclusion

The Spec-Driven Planning system has the right architecture but needs workflow adjustments to support AI coding's rapid, iterative nature. The emergence mechanism will eventually discover better workflows, but the built-in skills should model best practices from day one.

**Key insight**: The current design treats spec-writing like document production (research → draft → review → finalize). AI coding works more like conversation (ask → refine → ask → refine), which requires different workflow structures.

---

*Review complete. Prepared by worker agent task_2d6378a7c105*
