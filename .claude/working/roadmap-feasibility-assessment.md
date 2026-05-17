# Orca Roadmap Technical Feasibility Assessment
**Date**: 2026-05-17
**Task**: task_a22d69ccfcfb
**Reviewer**: Worker Agent

---

## Executive Summary

The roadmap is **overly aggressive** across all versions. Key findings:

1. **v1.5 (6-8 weeks)**: Unrealistic. Realistic timeline: **10-12 weeks** for P0 features alone.
2. **v1.6 (6-8 weeks)**: Moderate-HIGH risk. Realistic: **8-10 weeks**.
3. **v1.7 (8-10 weeks)**: HIGH risk. Realistic: **12-16 weeks**.
4. **v2.0 (10-12 weeks)**: Very HIGH risk. Realistic: **16-24 weeks**.

**Overall Recommendation**: Rebaseline the entire roadmap. The current timeline assumes zero blockers, perfect execution, and underestimates hidden complexity in platform features (RBAC, SSO, Server Mode).

---

## v1.5 Analysis: "Polish & Differentiate" (6-8 weeks → **10-12 weeks**)

### Severity: **HIGH RISK**

#### P0 Feature Breakdown

| Feature | Risk Level | Estimate | Notes |
|---------|-----------|----------|-------|
| Worktree Delete Preflight | LOW | 1-2 weeks | Design doc exists; straightforward git status check |
| Agent Orchestration Protocol | MEDIUM | 3-4 weeks | Infrastructure exists but multi-agent DAG coordination is complex |
| Agent Cost Tracking | **HIGH** | 3-4 weeks | No unified API across providers; estimation required |
| Windows PTY Stability | **HIGH** | 2-3 weeks | ConPTY issues are historically difficult; may never be "fully stable" |

**Total P0 Estimate**: 9-13 weeks (vs. 6-8 weeks allocated)

#### Hidden Complexity Details

**1. Agent Orchestration Protocol (P0)**

*Current State*: Orca has orchestration infrastructure (`src/main/runtime/orchestration/`):
- Coordinator with task dispatch
- Decision gates
- Message passing between agents
- CLI handlers for send/check/ask

*Gap*: Multi-agent **chaining** (A's output → B's input) with:
- Output format standardization across 25+ agent types
- Error propagation (A fails → what does B do?)
- Parallel execution vs. serial coordination
- State management across agent boundaries

*Hidden Complexity*:
- Non-deterministic agent behavior makes testing difficult
- Different agents have different output formats (JSON vs. text vs. structured)
- No existing "agent contract" or interface standard

**Recommendation**: Phase implementation:
1. v1.5: Simple A→B chaining (CLI-level pipe-like behavior)
2. v1.6: DAG execution with parallel support
3. v1.7: Visual pipeline builder

**2. Agent Cost Tracking (P0)**

*Current State*:
- Claude: has `claude-usage` store with token/cost tracking
- Codex: has `codex-usage` store with token tracking
- Other agents: **no standardized cost reporting**

*Gap*: Unified cost tracking across all agents requires:
- Provider API integration (Anthropic, OpenAI, Google, etc.)
- For agents without APIs: **estimation heuristics** (token counting, model pricing)
- Real-time streaming updates
- Per-worktree, per-session attribution

*Hidden Complexity*:
- Token counting varies by provider (Claude counts characters vs. tokens differently)
- Some agents (Grok, Cursor) have **no public API** for usage
- Rate limit data ≠ cost data (need to map API tiers to pricing)
- Caching (prompt caching) complicates cost calculation

*Recommendation*:
- v1.5: Ship with **Claude + Codex only** (use existing stores)
- v1.6: Add estimation layer for other agents
- v1.7: Full multi-provider support

**3. Windows PTY Stability (P0)**

*Current State*:
- Orca patches `node-pty` for Spectre mitigation removal
- Patches focus on **macOS/Linux** (posix_spawn improvements)
- Windows ConPTY has historical issues with:
  - Unicode/multibyte character handling
  - Shell integration (PowerShell, CMD, WSL)
  - Process spawning edge cases

*Hidden Complexity*:
- ConPTY is a Windows OS component; patches to node-pty have limited effect
- Full "stability" may require Windows-specific workarounds
- Testing matrix: PowerShell 5/7, CMD, Git Bash, WSL1, WSL2

*Recommendation*:
- v1.5: Document known issues, add user-friendly error messages
- v1.5: Focus on **mitigation** not "perfect" stability
- Accept that Windows will always be "best effort" vs. Unix PTY

#### P1 Features Should Defer to v1.6

- **AI Readiness Score** (P1): Requires project scanning heuristics; no prior work
- **Session Inspector** (P1): Requires new event tracing infrastructure
- **Diff Annotation v2** (P1): Nice-to-have; not competitive differentiator

**Recommendation**: Move all P1 features to v1.6. Focus v1.5 on platform stability (Windows PTY) and P0 agent features.

---

## v1.6 Analysis: "Ecosystem Expansion" (6-8 weeks → **8-10 weeks**)

### Severity: **MODERATE-HIGH RISK**

#### Critical Dependencies

| Feature | Dependency | Risk |
|---------|-----------|------|
| Team Workspaces (P0) | Requires **shared state backend** (does not exist) | HIGH |
| Session Sharing (P1) | WebRTC server infrastructure (does not exist) | HIGH |
| GitHub Actions Dashboard (P0) | GitHub API integration (exists) | LOW |
| Plugin System v1 (P1) | Architectural redesign for extensibility | MEDIUM |

#### Hidden Complexity Details

**1. Team Workspaces (P0)**

*Gap*: Current Orca is **single-user**. Team Workspaces requires:
- Shared configuration storage (database or file server)
- Conflict resolution (two users modify same preset)
- Authentication/authorization (precursor to v2.0 RBAC)

*Hidden Complexity*:
- This is a **mini-v2.0** feature in disguise
- Overlaps significantly with v2.0's Workspace Server Mode
- Building this twice (once for v1.6, once for v2.0) is wasteful

*Recommendation*: **Move to v2.0**. Use v1.6 for integrations (GitHub Actions, Jira, MCP) which are standalone.

**2. Session Sharing via WebRTC (P1)**

*Gap*: No WebRTC infrastructure exists. Requires:
- Signaling server
- STUN/TURN servers
- Session state serialization
- Cross-network support (NAT traversal)

*Hidden Complexity*:
- WebRTC is notoriously finicky with firewalls
- Mobile companion adds complexity (network switching)
- Session state includes PTY buffers, agent state—complex to serialize

*Recommendation*: Defer to v1.7 or v2.0. Not a competitive requirement in 6-8 weeks.

**3. Plugin System v1 (P1)**

*Gap*: Current architecture is monolithic. Plugins require:
- Lifecycle hooks (install/enable/disable/update)
- API surface for plugins
- Security sandboxing

*Hidden Complexity*:
- Breaking changes risk stability
- Plugin API v1 will need v2 rewrite
- Documentation and examples required

*Recommendation*: Ship with **internal plugins only** (no third-party). Defer open plugin ecosystem to v2.0 Marketplace.

---

## v1.7 Analysis: "Intelligence Layer" (8-10 weeks → **12-16 weeks**)

### Severity: **HIGH RISK**

#### Critical Dependencies

| Feature | Dependency | Risk |
|---------|-----------|------|
| Smart Agent Routing | Requires **agent capability profiling** (does not exist) | HIGH |
| Context-Aware Agent Init | Requires **codebase analysis** (RAG/embeddings) | HIGH |
| Project Knowledge Graph | Requires **dependency graph** + persistence | HIGH |
| Multi-Agent Pipeline | Depends on v1.5 Orchestration Protocol | MEDIUM |

#### Hidden Complexity Details

**1. Smart Agent Routing (P0)**

*Gap*: How do we know which agent is "best" for a task?

*Requirements*:
- Agent capability taxonomy (which agents do what?)
- Task classification (what is the user asking?)
- Success metrics (did the agent succeed?)
- Learning from user behavior

*Hidden Complexity*:
- This is an **ML/recommendation problem**, not just engineering
- Requires labeled training data
- Cold start problem (no history → random recommendations)
- Agent capabilities change (new models, new features)

*Recommendation*: Start with **rule-based routing** (keyword matching). ML-based routing is v2.0+.

**2. Context-Aware Agent Init (P0)**

*Gap*: "Automatically inject relevant files" requires:

*Requirements*:
- Code indexing (which files exist?)
- Relevance scoring (which files relate to the task?)
- Context window management (don't overfill)
- Git-aware filtering (don't inject node_modules/)

*Hidden Complexity*:
- Requires maintaining a **code index** (watcher + database)
- Relevance is subjective (GIGO)
- Token counting varies by model
- RAG/embeddings are complex to implement correctly

*Recommendation*: v1.7 should ship **simple context** (git diff + related files by path proximity). Full RAG is v2.0+.

**3. Project Knowledge Graph (P1)**

*Gap*: No knowledge graph infrastructure exists.

*Requirements*:
- Dependency parsing (imports, requires, etc.)
- File relationship tracking
- Change history tracking
- Query interface

*Hidden Complexity*:
- Language-specific parsing (TypeScript, Python, Go, etc.)
- Dynamic imports (computed requires)
- Monorepo complexity
- Performance (large repos)

*Recommendation*: Start with **static dependency graph** (import analysis). Full knowledge graph with change history is v2.0+.

---

## v2.0 Analysis: "Platform" (10-12 weeks → **16-24 weeks**)

### Severity: **VERY HIGH RISK**

#### Critical Dependencies

| Feature | Dependency | Risk |
|---------|-----------|------|
| Workspace Server Mode | Complete **multi-user architecture** | VERY HIGH |
| Role-Based Access (RBAC) | Authentication system + permission model | VERY HIGH |
| SSO Integration | SAML/OIDC protocol implementation | HIGH |
| Task Decomposition Engine | **AI research problem** | VERY HIGH |
| QA Verification Loop | **AI research problem** | VERY HIGH |

#### Hidden Complexity Details

**1. Workspace Server Mode (P0)**

*Gap*: Transforming single-user Electron app into multi-user server.

*Requirements*:
- Server process (separate from Electron)
- Multi-user database schema
- Connection pooling
- Session management
- Resource isolation (per-user worktrees)

*Hidden Complexity*:
- Electron is single-user by design
- Requires **architectural redesign** of core systems
- IPC becomes network RPC
- State management is distributed
- Testing complexity explodes (N users × M features)

*Realistic Timeline*: 8-12 weeks for **MVP**. 16+ weeks for production-ready.

**2. RBAC + SSO (P0/P1)**

*Gap*: No authentication system exists today.

*Requirements*:
- User authentication (local + SSO)
- Role/permission model
- Authorization checks on **every operation**
- Audit logging
- Session management

*Hidden Complexity*:
- SAML/OIDC integration is **complex** (multiple providers, edge cases)
- Permission checks must be everywhere (high regression risk)
- Audit logging has performance implications
- Security review required

*Realistic Timeline*: 6-10 weeks for **basic** RBAC. 12+ weeks for SSO + enterprise features.

**3. Task Decomposition Engine (P0)**

*Gap*: This is an **AI research problem**, not engineering.

*Requirements*:
- Understand user intent
- Break down into subtasks
- Assign to appropriate agents
- Handle failures/retries
- Validate completion

*Hidden Complexity*:
- No off-the-shelf solution
- Requires prompt engineering + iteration
- Evaluation is subjective
- Failure modes are complex

*Recommendation*: **Move to v2.1+**. This should not block v2.0 platform features.

**4. QA Verification Loop (P1)**

*Gap*: Another **AI research problem**.

*Requirements*:
- Understand what was built
- Generate test cases
- Execute tests
- Interpret results
- Suggest fixes

*Hidden Complexity*:
- Test generation is an open problem
- Execution environment varies
- False positives/negatives
- Requires integration with test frameworks

*Recommendation*: **Move to v2.1+**. Start with human-in-the-loop verification.

---

## Timeline Risk Summary

| Version | Planned | Realistic | Risk | Key Blockers |
|---------|---------|-----------|------|--------------|
| v1.5 | 6-8 weeks | **10-12 weeks** | HIGH | Windows PTY, Agent Cost Tracking API fragmentation |
| v1.6 | 6-8 weeks | **8-10 weeks** | MODERATE-HIGH | Team Workspaces (architectural overlap with v2.0) |
| v1.7 | 8-10 weeks | **12-16 weeks** | HIGH | Smart Routing (ML problem), Knowledge Graph (parsing complexity) |
| v2.0 | 10-12 weeks | **16-24 weeks** | VERY HIGH | Server Mode (architectural redesign), RBAC+SSO (security complexity) |

**Cumulative**: Planned **30-38 weeks** → Realistic **46-62 weeks** (1.5x-2x overrun).

---

## Recommended Adjustments

### v1.5 (Revised: 10-12 weeks)

**Keep (P0)**:
- Worktree Delete Preflight (1-2 weeks)
- Agent Orchestration Protocol v1: Simple A→B chaining (3-4 weeks)
- Agent Cost Tracking: Claude + Codex only (2-3 weeks)
- Windows PTY: Best-effort mitigation (2-3 weeks)

**Defer to v1.6**:
- AI Readiness Score
- Session Inspector
- Diff Annotation v2
- Worktree Health Dashboard

### v1.6 (Revised: 8-10 weeks)

**Keep (P0)**:
- GitHub Actions Dashboard (2-3 weeks)
- MCP Server Support (2-3 weeks)
- Jira Integration (2 weeks)

**Defer to v2.0**:
- Team Workspaces (overlaps with Server Mode)
- Session Sharing (WebRTC complexity)
- Plugin System v1 (do it right in v2.0)

### v1.7 (Revised: 12-16 weeks)

**Keep (P0)**:
- Smart Agent Routing: Rule-based only (3-4 weeks)
- Context-Aware Agent Init: Simple path proximity (2-3 weeks)
- RRULE Scheduler (2 weeks)
- Trigger System (2-3 weeks)

**Defer to v2.0+**:
- Project Knowledge Graph (static only)
- Multi-Agent Pipeline visualizer
- Agent Learning (ML-based)

### v2.0 (Revised: 16-24 weeks)

**Phase 1 (Platform Foundation, 8-12 weeks)**:
- Workspace Server Mode MVP
- Basic RBAC (Admin/Developer/Viewer)
- Audit logging

**Phase 2 (Enterprise Features, 8-12 weeks)**:
- SSO Integration
- Centralized Config
- Self-hosted deployment guides

**Defer to v2.1+**:
- Task Decomposition Engine (AI research)
- QA Verification Loop (AI research)
- Goal-Directed Execution (AI research)
- Marketplace (requires ecosystem maturity)

---

## Architectural Debt to Address

1. **Preload Split** (planned for v1.6): Do this **sooner** (v1.5). 3000-line file is a liability.
2. **Store Slice Optimization** (planned for v1.5): Critical for performance. Don't defer.
3. **SQLite WAL Mode** (planned for v1.5): Do this. Enables better concurrency.
4. **E2E Test Coverage >60%** (planned for v1.6): **Do this in v1.5**. Can't ship fast without safety net.

---

## Final Recommendation

**Rebaseline the entire roadmap** with:

1. **v1.5**: Platform stability + P0 agent features (10-12 weeks)
2. **v1.6**: Integrations + ecosystem (8-10 weeks)
3. **v1.7**: Intelligence layer, rule-based (12-16 weeks)
4. **v2.0**: Platform foundation, **no AI features** (16-24 weeks)
5. **v2.1**: AI autonomy features (Task Decomposition, QA Loop)

**Total**: 46-62 weeks (realistic) vs. 30-38 weeks (planned).

**Key Insight**: The roadmap conflates **platform engineering** (Server Mode, RBAC, SSO) with **AI research** (Task Decomposition, QA Verification). These have different risk profiles and should be tracked separately. Platform features are predictable but labor-intensive. AI features are unpredictable and require iteration.

---

## Report End

*Generated by task_a22d69ccfcfb worker*
*Date: 2026-05-17*
