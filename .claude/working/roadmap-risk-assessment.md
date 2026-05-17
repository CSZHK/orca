# Orca Roadmap Risk Assessment
> Ambitious Features Deep-Dive (v1.7-v2.0)
> Generated: 2026-05-17

## Executive Summary

This report assesses five high-impact roadmap features across technical complexity, team capability gaps, integration risks, competitive urgency, and fallback MVP strategies. The **Multi-Agent Pipeline** and **Workspace Server Mode** features carry the highest risk (4.5/5 each), while **Project Knowledge Graph** poses the greatest capability gap given no existing semantic analysis infrastructure. Top mitigations include: (1) incremental rollout starting with linear pipelines before full DAG support, (2) partnering with vector database specialists for knowledge graph, and (3) phased multi-user deployment starting with team-level isolation before true multi-tenancy.

---

## Risk Matrix (Summary)

| Feature | Tech Complexity (1-5) | Capability Gap | Integration Risk | Competitive Urgency | Overall Risk |
|---------|----------------------|----------------|------------------|---------------------|--------------|
| Multi-Agent Pipeline (v1.7) | 4.5 | HIGH | HIGH | MEDIUM | **CRITICAL** |
| QA Verification Loop (v2.0) | 3.5 | MEDIUM | MEDIUM | HIGH | **HIGH** |
| Workspace Server Mode (v2.0) | 4.5 | VERY HIGH | VERY HIGH | LOW | **CRITICAL** |
| Project Knowledge Graph (v1.7) | 4.0 | VERY HIGH | MEDIUM | HIGH | **HIGH** |
| Task Decomposition Engine (v2.0) | 3.0 | MEDIUM | LOW | MEDIUM | **MEDIUM** |

---

## Feature 1: Multi-Agent Pipeline (v1.7)

**Description:** Visual DAG editor for orchestrating multi-agent workflows with execution engine supporting parallel/serial execution, conditional branching, and data passing between agents.

### Technical Complexity: 4.5/5

**Breakdown:**
- **DAG Editor UI (3/5):** Visual node-graph editor is well-understood UX pattern. Libraries like ReactFlow provide solid foundation. Complexity in serialization, validation, and undo/redo.
- **Execution Engine (5/5):** Requires robust state management, fault tolerance, and checkpoint/recovery. Must handle agent failures, timeouts, and retry logic. Existing orchestration infrastructure (`src/main/runtime/orchestration/coordinator.ts`) provides primitives but needs significant extension for:
  - True parallel execution (current model is sequential dispatch)
  - Inter-agent data passing (no current mechanism)
  - Conditional branching logic (no current decision primitives beyond gates)
- **State Persistence (4/5):** Current SQLite-based persistence would need schema extensions for DAG topology, execution history, and intermediate results. Concurrency concerns increase with multi-user scenarios.

### Team Capability Gap: HIGH

**Existing Strengths:**
- Strong orchestration coordinator pattern (see `coordinator.ts`)
- Agent hook integration infrastructure
- SQLite persistence patterns

**Gaps:**
- **No visual editor experience:** Current UI is terminal-first; node-graph UX is new domain
- **Limited distributed systems expertise:** DAG execution requires understanding of deadlocks, race conditions, and distributed consensus
- **No existing inter-agent communication protocol:** Current model is agent-to-human; agent-to-agent is unexplored

### Integration Risk: HIGH

**Risk Points:**
1. **Coordinator coupling:** Current coordinator is tightly coupled to terminal dispatch model. DAG execution may require fundamental refactoring.
2. **Agent compatibility:** Not all 25+ supported agents support programmatic input/output. May need agent adapter layer.
3. **Performance:** Long-running DAGs could exhaust memory/process handles. Existing single-user architecture may not scale.

**Mitigation:**
- Phase 1: Linear pipelines only (no branching), serial execution
- Phase 2: Add parallel fan-out, then conditional branching
- Reuse existing dispatch infrastructure rather than replacing

### Competitive Urgency: MEDIUM

**Market Reality:**
- Aperant has full autonomous pipelines (Spec→Code→QA) — but their approach is "closed-loop" rather than visual
- Cursor Windsurf has "Casual" but focused on single-agent workflows
- Visual DAG orchestration is **differentiator** if executed before competitors

**Timeline Pressure:** Moderate. v1.7 is targeted for Q4 2026; Aperant is already live. However, Orca's "agent-agnostic orchestration" angle is unique.

### Fallback MVP Plan

**If full DAG proves infeasible:**

**Phase 1 (v1.7): Linear Chain Builder**
- Text-based pipeline definition (YAML/JSON)
- Serial execution only: A → B → C
- Reuse existing coordinator with task chaining
- Visual preview: simple list view, not node graph

**Phase 2 (v1.8): Visual Layer**
- ReactFlow-based viewer (read-only DAGs)
- Drag-and-drop node rearrangement
- Still serial execution under the hood

**Phase 3 (v2.0): True DAG**
- Parallel execution engine
- Conditional branching
- Inter-agent data passing

**Success Metric:** Users can define and execute 3-step pipelines (e.g., "analyze → implement → test") with 80% success rate.

---

## Feature 2: QA Verification Loop (v2.0)

**Description:** Automatic test generation + agent output validation, creating a closed quality loop where agent work is automatically verified before acceptance.

### Technical Complexity: 3.5/5

**Breakdown:**
- **Test Generation (3/5):** Leverage LLMs to generate tests based on code changes. Prompt engineering challenge, not novel tech.
- **Test Execution (2/5):** Standard test runner integration (Vitest, Jest, pytest). Well-understood.
- **Result Validation (4/5):** Interpreting test results and determining pass/fail is nuanced. Must handle:
  - Flaky tests
  - Test environment issues
  - False positives/negatives
- **Feedback Loop (3/5):** Routing results back to agent for fixes. Existing escalation mechanism supports this.

### Team Capability Gap: MEDIUM

**Existing Strengths:**
- Test infrastructure (Vitest, Playwright) already in place
- Agent escalation patterns well-understood
- Code execution via terminals

**Gaps:**
- **No test generation experience:** Team hasn't built LLM-based test generators
- **Limited validation logic expertise:** Determining "what counts as a valid test result" is domain-specific

### Integration Risk: MEDIUM

**Risk Points:**
1. **Test environment isolation:** Generated tests must run in isolated environments to avoid side effects
2. **Agent compatibility:** Different agents produce different output formats; validation layer must be agent-agnostic
3. **False positive cascade:** Bad validation logic could reject good work repeatedly

**Mitigation:**
- Start with human-in-the-loop validation (agent proposes, human approves)
- Gradually automate as confidence increases
- Strict rollback mechanisms for false positives

### Competitive Urgency: HIGH

**Market Reality:**
- Aperant's "11-Agent PR Review Pipeline" includes automated QA verification
- This is table stakes for "enterprise-grade" AI development tools
- Customers will expect automated verification at v2.0 maturity level

**Timeline Pressure:** High. v2.0 is "platform" release; missing QA verification would be conspicuous gap.

### Fallback MVP Plan

**If fully automated loop proves infeasible:**

**Phase 1 (v1.8): Manual Test Generation**
- Agent generates test suggestions as pull request comments
- Human reviews and applies tests
- Manual execution via existing test runners

**Phase 2 (v1.9): Semi-Automated**
- Agent generates and runs tests in isolated environment
- Results presented to human for approval
- Agent can iterate based on feedback

**Phase 3 (v2.0): Full Automation**
- Tests run automatically on agent completion
- Auto-approve if passing (with configurable thresholds)
- Auto-escalate if failing

**Success Metric:** 50% reduction in human test review time for generated tests.

---

## Feature 3: Workspace Server Mode (v2.0)

**Description:** Orca runs as shared server instance with multi-user access, role-based permissions, and concurrent worktree operations.

### Technical Complexity: 4.5/5

**Breakdown:**
- **Multi-tenancy (5/5):** Current architecture is single-user-by-design. Major refactoring required:
  - All global state becomes per-user
  - Database schema requires user_id scoping
  - IPC handlers must authenticate and authorize
- **Concurrency Control (4/5):** Multiple users accessing same worktree simultaneously requires:
  - Row-level locking in database
  - Conflict resolution for git operations
  - Terminal session multiplexing
- **Authentication (4/5):** SSO integration, session management, token refresh
- **Permission System (3/5):** RBAC is well-understood pattern, but implementation is non-trivial

### Team Capability Gap: VERY HIGH

**Existing Strengths:**
- SQLite persistence (but single-user)
- SSH multiplexing experience ( Relay server)
- PTY session management

**Gaps:**
- **No multi-tenant architecture experience:** Current codebase assumes single user
- **No authentication/authorization infrastructure:** Currently relies on OS user
- **Limited web security expertise:** RBAC, session hijacking prevention, CSRF protection are new domains
- **No database sharding/multi-tenancy patterns:** SQLite per-user may not scale

### Integration Risk: VERY HIGH

**Risk Points:**
1. **Architecture upheaval:** This touches virtually every subsystem. Risk of regressions is extreme.
2. **Data migration:** Existing single-user databases must migrate to multi-tenant schema. High risk of data loss.
3. **Performance:** SQLite may not handle concurrent multi-user load. May need PostgreSQL migration.
4. **Electron limitations:** Electron is fundamentally single-user tech. Server mode may require separate headless build.

**Mitigation:**
- Separate server mode as distinct deployment artifact (not same binary)
- Start with team-level isolation (one team per server instance)
- Phase in true multi-tenancy after architecture stabilizes

### Competitive Urgency: LOW

**Market Reality:**
- Most competitors (Cursor, Windsurf, Aperant) are single-user tools
- Team features exist (Vibeyard session sharing) but not full multi-tenant server mode
- This is **enterprise** feature, not developer-facing

**Timeline Pressure:** Low. v2.0 target is early 2027; enterprise sales cycle is long anyway.

### Fallback MVP Plan

**If true multi-tenancy proves infeasible:**

**Phase 1 (v2.0): Team Server**
- Single-tenant server (one team per instance)
- Shared workspace configurations
- No true multi-user concurrency (just shared settings)
- Deploy via Docker/Kubernetes

**Phase 2 (v2.1): Multi-Session**
- Multiple users can connect, but not simultaneously
- Session isolation (like screen sharing)

**Phase 3 (v2.5): True Multi-Tenant**
- Concurrent users
- Row-level security
- Full RBAC

**Success Metric:** Teams of 5 can share single Orca instance without data leakage.

---

## Feature 4: Project Knowledge Graph (v1.7)

**Description:** Semantic codebase knowledge graph tracking file relationships, dependencies, change history, and cross-references for AI-augmented code navigation.

### Technical Complexity: 4.0/5

**Breakdown:**
- **Graph Construction (4/5):** Requires parsing code for:
  - Import/dependency relationships
  - Function/class call graphs
  - Data flow analysis
  - Git history correlation
- **Storage (4/5):** Graph databases are specialized. Could use:
  - Neo4j (external dependency)
  - SQLite with adjacency lists (limited query capability)
  - In-memory graph (doesn't persist)
- **Query Engine (4/5):** Graph queries (pathfinding, centrality, community detection) are complex
- **Incremental Updates (4/5):** Must update graph efficiently as code changes without full rebuilds

### Team Capability Gap: VERY HIGH

**Existing Strengths:**
- Git history parsing (`git-history-graph.ts`)
- File system watching
- SQLite persistence

**Gaps:**
- **No static analysis experience:** No AST parsing, symbol resolution, or dataflow analysis
- **No graph database expertise:** Graph algorithms and storage are new
- **No embedding/vector experience:** Semantic similarity requires embeddings (unless purely structural)
- **Limited language support:** Would need parsers for TS, JS, Python, Rust, Go, etc.

### Integration Risk: MEDIUM

**Risk Points:**
1. **Performance impact:** Graph construction could be slow on large codebases
2. **Storage growth:** Graphs can grow large; may exceed SQLite practical limits
3. **Language fragmentation:** Supporting all languages users care about is massive undertaking

**Mitigation:**
- Start with TypeScript/JavaScript only (Orca's own stack)
- Use Tree-sitter for parsing (battle-tested, multi-language)
- Consider hybrid approach: structural graph + external embeddings for semantics

### Competitive Urgency: HIGH

**Market Reality:**
- Aperant's "Graphiti" knowledge graph is core differentiator
- This is becoming table stakes for "AI-native" IDEs
- Sourcegraph's Code Graph and GitHub's Copilot Workspace are setting expectations

**Timeline Pressure:** High. v1.7 is when Orca positions itself as "intelligent development platform." Without knowledge graph, positioning is weak.

### Fallback MVP Plan

**If full semantic graph proves infeasible:**

**Phase 1 (v1.7): Structural Graph**
- Import/dependency graph only (static analysis)
- No semantic understanding
- Tree-sitter based, TypeScript/JavaScript only
- Simple queries: "what depends on X?", "what does X import?"

**Phase 2 (v1.8): Git History Augmentation**
- Layer on co-change frequency (files changed together often)
- Layer on change recency
- No embeddings, just heuristics

**Phase 3 (v2.0): Semantic Layer**
- Add embeddings via OpenAI/Claude API
- Semantic search over graph nodes
- Multi-language support via Tree-sitter

**Success Metric:** Graph answers "what files are related to this file?" with 70% precision.

---

## Feature 5: Task Decomposition Engine (v2.0)

**Description:** Automatically split high-level goals into subtasks and assign to appropriate agents, enabling goal-directed execution.

### Technical Complexity: 3.0/5

**Breakdown:**
- **Decomposition Logic (3/5):** LLM-based task breakdown. Prompt engineering challenge, not novel.
- **Agent Selection (2/5):** Rule-based routing (e.g., "test tasks → test agent") is straightforward
- **Dependency Resolution (3/5):** Topological sort for task dependencies. Standard algorithm.
- **Existing Infrastructure (1/5):** Orca already has task DAG infrastructure in coordinator

### Team Capability Gap: MEDIUM

**Existing Strengths:**
- Coordinator already supports task DAGs
- Task creation/dispatch infrastructure mature
- Agent capability metadata (agent types)

**Gaps:**
- **No LLM-based decomposition experience:** Haven't built hierarchical task planners
- **Limited agent capability modeling:** Don't have formal model of what each agent can do

### Integration Risk: LOW

**Risk Points:**
1. **Decomposition quality:** Bad breakdowns lead to failed tasks
2. **Agent mismatches:** Wrong agent assignment wastes time
3. **Dependency cycles:** Circular dependencies must be detected

**Mitigation:**
- Human-in-the-loop approval before execution
- Start with template-based decomposition (not pure LLM)
- Build agent capability registry gradually

### Competitive Urgency: MEDIUM

**Market Reality:**
- Aperant has this (auto Spec→Code→QA)
- Cursor's "Composer" does lightweight task breakdown
- Becoming expected feature for "agentic" tools

**Timeline Pressure:** Medium. v2.0 is "platform" release; this is flagship "autonomous" feature.

### Fallback MVP Plan

**If full auto-decomposition proves infeasible:**

**Phase 1 (v1.8): Template-Based**
- Pre-defined task templates for common patterns
- User selects template, fills in parameters
- Simple dependency rules

**Phase 2 (v1.9): LLM-Assisted**
- LLM proposes decomposition
- Human edits and approves
- No auto-execution

**Phase 3 (v2.0): Full Auto**
- LLM decomposes and executes
- Human intervention only on failure
- Learned improvements from past runs

**Success Metric:** 60% of decompositions execute without human intervention.

---

## Top 3 Mitigations (Cross-Cutting)

### 1. Incremental DAG Rollout (Multi-Agent Pipeline)

**Problem:** Full DAG execution is highest-risk feature in roadmap.

**Solution:**
- **v1.7:** Linear chains only, serial execution, text-based config
- **v1.8:** Visual editor (read-only), parallel fan-out
- **v1.9:** Conditional branching, inter-agent data passing
- **v2.0:** Full DAG with fault tolerance and checkpointing

**Rationale:** Spreads risk over 4 releases. Each phase delivers value independently. Allows validation of lower layers before adding complexity.

**Dependency:** Requires robust task DAG persistence (v1.7 prerequisite).

### 2. Partner for Vector Infrastructure (Knowledge Graph)

**Problem:** Team lacks embeddings/vector database expertise. Building from scratch is high-risk.

**Solution:**
- **Option A:** Use managed vector service (Pinecone, Weaviate Cloud)
- **Option B:** Partner with vector database startup for integration
- **Option C:** Use SQLite extensions (sqlite-vec) for lightweight solution

**Rationale:** Reduces capability gap by leveraging external expertise. Managed services scale without ops burden. SQLite extension keeps architecture simple.

**Dependency:** Decision by v1.6 to allow v1.7 implementation.

### 3. Phased Multi-User Deployment (Server Mode)

**Problem:** True multi-tenancy is architecture-shaking change.

**Solution:**
- **v2.0:** "Team Server" — one team per instance, shared configs only
- **v2.1:** "Multi-Session" — multiple users, non-concurrent
- **v2.5:** True multi-tenant with RBAC

**Rationale:** Delivers value to teams (primary customer for server mode) without architecture upheaval. Each phase validates demand before next investment.

**Dependency:** Requires separate deployment artifact for server mode (not in Electron app bundle).

---

## Risk Heatmap

```
                    LOW CAP GAP        MEDIUM CAP GAP       HIGH CAP GAP          VERY HIGH CAP GAP
                    ────────────────────────────────────────────────────────────────────────────────────────
                    │                    │                    │                    │
 VERY HIGH          │                    │                    │                    │
                    │                    │                    │                    │
   HIGH             │                    │                    │                    │  Workspace Server Mode
                    │                    │                    │  Project Knowledge  │  Multi-Agent Pipeline
   MEDIUM           │                    │                    │  Graph              │
                    │                    │                    │                    │
   LOW              │                    │  Task Decomposition│                    │
                    │                    │  QA Verification   │                    │
                    └────────────────────┴────────────────────┴────────────────────┴───────────────────────
                       LOW INTEGRATION    MEDIUM INTEGRATION   HIGH INTEGRATION     VERY HIGH INTEGRATION
                       RISK               RISK                RISK                RISK
```

---

## Recommendations

### For v1.7 (Intelligence Layer)

1. **Scope Multi-Agent Pipeline to linear chains only.** Full DAG can wait for v1.8.
2. **Prioritize Project Knowledge Graph** but start with structural graph only. Semantic layer is v2.0 feature.
3. **Defer Task Decomposition** to v1.8 or v2.0. v1.7 is already heavy with orchestration and knowledge work.

### For v2.0 (Platform)

1. **Launch "Team Server" not "Multi-User Server."** Single-tenant is sufficient for initial enterprise customers.
2. **QA Verification Loop is table stakes.** Must ship in v2.0 or risk being perceived as incomplete.
3. **Consider deferring true multi-tenancy** to v2.5. Focus on platform stability (SSO, audit logs, RBAC foundation) instead.

### Cross-Cutting

1. **Invest in testing infrastructure early.** All high-risk features need robust E2E tests.
2. **Hire or consult for:** (a) graph databases, (b) multi-tenant architecture, (c) distributed systems.
3. **Create feature spikes:** Build proof-of-concept for each high-risk feature before committing to full implementation.

---

*End of Report*
