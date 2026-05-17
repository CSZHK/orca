# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- @AGENTS.md is a Claude Code include directive — it inlines AGENTS.md (design system,
cross-platform rules, naming, type declaration policy) into this file at load time. -->
@AGENTS.md

## Prerequisites

- **Node 24** (enforced by `engines` field and `ensure-native-runtime.mjs`)
- **pnpm 10.24+** (corepack-managed via `packageManager` field)
- This is a single-package repo (no `pnpm-workspace.yaml`)

## Build & Development Commands

```bash
pnpm install                # install dependencies (runs postinstall to rebuild native deps)
pnpm dev                    # launch Electron app in dev mode (hot-reload)
pnpm dev:web                # web-only dev server (no Electron)
pnpm build                  # full build: typecheck → relay → computer-macos → electron-vite → web → cli
pnpm build:cli              # build CLI only (outputs to out/cli/, installs orca-dev shim)
pnpm build:relay            # build relay server (outputs to out/relay/)
```

### Typecheck

Three separate TS projects — run all three before declaring work done:

```bash
pnpm tc                     # all three via tsgo (fast)
pnpm tc:node                # main + preload + shared + relay + types
pnpm tc:cli                 # CLI
pnpm tc:web                 # renderer
```

`tsgo` (native TS compiler) is the default. Fallback to `pnpm typecheck:tsc` if `tsgo` is unavailable.

### Lint & Format

```bash
pnpm lint                   # oxlint
pnpm format                 # oxfmt --write .
```

Pre-commit hook (husky + lint-staged) runs `oxlint` and `oxfmt --write` on staged `.ts/.tsx/.js/.jsx/.mts/.cts` files.

### Code Style (enforced by oxlint + oxfmt)

**Formatter** (`.oxfmtrc.json`): single quotes, no semicolons, `printWidth: 100`, no trailing commas.

**Lint rules that trip up agents** (`.oxlintrc.json`):
- `consistent-type-definitions`: use `type`, never `interface`
- `consistent-type-imports`: use `import type { … }` for type-only imports
- `no-explicit-any`: error (use `unknown` or narrow properly; `...rest` args exempt)
- `max-lines`: **300** for `.ts`, **400** for `.tsx` (skip blank lines and comments) — split files that approach the limit
- `curly`: always use braces, even for single-line `if`/`else`
- `prefer-template`: use template literals, not string concatenation
- `react/jsx-curly-brace-presence`: no unnecessary `{}` around string props/children
- `switch-exhaustiveness-check`: switch on unions must be exhaustive

### shadcn/ui Conventions

Components live in `src/renderer/src/components/ui/`. Config in `components.json`:
- Style: `new-york-v4`, base color: `neutral`
- Aliases: `@/components`, `@/lib`, `@/hooks`, `@/components/ui`
- Not RSC — this is Electron, `rsc: false`

When adding new shadcn components: `pnpm dlx shadcn@latest add <component>`.

### Test

```bash
pnpm test                   # vitest run (unit tests, Node environment)
pnpm test -- --reporter=verbose src/path/to/file.test.ts   # single test file
pnpm test:e2e               # Playwright E2E (builds app first; SKIP_BUILD=1 to skip)
pnpm test:e2e:headful       # E2E with visible Electron window
```

Vitest config: `config/vitest.config.ts`. Tests are co-located with source (`src/**/*.test.ts`).

## Architecture

Orca is an Electron app ("Next-gen IDE for parallel agentic development") that orchestrates CLI coding agents (Claude Code, Codex, Grok, etc.) across git worktrees.

### Process Model

```
┌─────────────────┐    IPC (preload bridge)    ┌────────────────┐
│  Main Process    │◄─────────────────────────►│    Renderer     │
│  (src/main/)     │                            │  (src/renderer/)│
│                  │    fork()                  │  React + Zustand│
│  ├─ daemon/      │◄──────────────────────┐    └────────────────┘
│  │  (node-pty)   │                       │
│  ├─ ipc/         │    subprocess          │
│  └─ relay        │◄──────────────────────┘
│    (src/relay/)  │
└─────────────────┘
       ▲
       │ WebSocket
  ┌────┴─────┐
  │  CLI     │  (src/cli/)
  └──────────┘
```

- **Main** (`src/main/`): Electron main process — window lifecycle, IPC handlers (`src/main/ipc/`, 100+ files by domain), git operations, SSH connections, terminal management via daemon subprocess, integrations (GitHub, GitLab, Azure DevOps, Bitbucket, Linear).
- **Renderer** (`src/renderer/`): React UI with Tailwind CSS. State via a single Zustand store (`src/renderer/src/store/index.ts`) composed from 25+ slices in `src/renderer/src/store/slices/`.
- **Preload** (`src/preload/index.ts`): Single-file IPC bridge (~3000 lines). Exposes `window.api` with 40+ namespaces (repos, worktrees, pty, gh, browser, settings, etc.). This is the audited security boundary — kept in one file intentionally.
- **Relay** (`src/relay/`): WebSocket/TCP relay server for SSH multiplexing and agent hook forwarding. Runs as subprocess or standalone daemon on remote machines.
- **CLI** (`src/cli/`): `orca` command-line interface. Communicates with the running app over WebSocket (`src/cli/runtime/`).
- **Shared** (`src/shared/`): ~150 type definition and contract files used across all processes. Wire formats, domain types, envelopes.

### Key Domain Concepts

- **Repos**: tracked git repositories (local or remote via SSH)
- **Worktrees**: git worktrees — each feature gets its own, indexed by worktreeId
- **Terminals**: PTY sessions managed by a daemon subprocess (`src/main/daemon/`), supporting local and SSH targets
- **Tabs/Panes**: UI layout system — terminals, browsers, editors composed into split panes within tab groups
- **Agent Status**: hooks listen on loopback HTTP; status events streamed and cached per pane
- **Browser**: embedded Electron webviews with session profiles, cookie management, and grab mode (screenshotting)
- **SSH Targets**: connection profiles with port forwarding; relay multiplexes multiple clients

### Build Configuration

- `electron.vite.config.ts`: main entry points include `index.ts`, `daemon-entry.ts`, `computer-sidecar.ts`, `stt-worker.ts`
- TS configs in `config/`: `tsconfig.node.json` (main/preload/shared/relay/types), `tsconfig.cli.json`, `tsconfig.web.json`, `tsconfig.relay.json` (relay build output), `tsconfig.tc.cli.json`, `tsconfig.tc.web.json`
- Native deps requiring rebuild: `better-sqlite3`, `node-pty`, `@parcel/watcher`, `electron`, `sherpa-onnx`
- On Windows, `cpu-features` (optional dep of `ssh2`) is intentionally skipped during postinstall
- Patched packages: `node-pty`, `@xterm/addon-ligatures`, `@xterm/addon-webgl` (see `config/patches/`)

### Renderer Path Aliases

- `@renderer` and `@` both resolve to `src/renderer/src`

### Testing Patterns

- Unit tests: Vitest, Node environment, co-located `.test.ts` files
- Store tests use helper utilities in `src/renderer/src/store/slices/store-test-helpers.ts`
- E2E tests: Playwright with `@stablyai/playwright-test`, config in `tests/playwright.config.ts`
- E2E launches fresh Electron instances with isolated userData per test

### Notable Project Files

- `orca.yaml` — internal dev setup script (runs `node config/scripts/run-internal-dev-setup.mjs` then `pnpm install`)
- `docs/STYLEGUIDE.md` — UI/visual design rules (referenced by AGENTS.md); `docs/` also has design docs for specific features
- `.env.e2e` — sets `VITE_EXPOSE_STORE=true` for E2E tests (exposes `window.__store` for Zustand state assertions)
