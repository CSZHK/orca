# Handoff: 2026-09-06 17:05

## 一句话摘要
合并上游 1,783 提交(08-12→09-05)并解决全部 22 处冲突，fork 意图存活审查通过，Windows 安装包已重打(173MB/asar 110MB)，typecheck 与定向测试全绿。

## 当前状态

### Git
- **分支**: main
- **未提交变更**: 仅未跟踪的 `.claude/working/*` 草稿与本文档（无 tracked 脏文件）
- **最近 5 条 commit**:
  - `03937b52f4` chore(context): 同步 healthcheck 计数
  - `61a052d789` test(notebook): 补执行安全门覆盖 + dialog mock 修复碰撞
  - `edd80a8714` chore(deps): pnpm 12 供应链校验通过后的 lockfile 元数据同步
  - `caacfd3185` fix(network): codex 代理测试改用 resolver 注入 + 钉住 typescript win32 平台二进制
  - `250b974110` merge upstream/main: 同步 1783 提交(2026-08-12→09-05)

### 活跃任务
| 任务 | 类型 | 状态 | 关键阻塞 |
|------|------|------|---------|
| [无] | ExecPlan | — | — |
| [无] | REQ | — | — |

### 已完成事项
- 合并 upstream/main（v1.4.125→126），22 处冲突全解；策略=整取上游+移植 fork 意图（`250b974110` 提交信息含逐文件策略）
- proxy 接线移植到上游新结构：`startup/main-process-ready-foundation.ts`（fetch 路由）、`startup/main-process-account-services.ts`（resolver 注册）、`git/command-runner/{wsl-command-resolution,git-process-env}.ts`、`rate-limits/codex-fetcher.ts`、`codex-accounts/codex-login-session.ts`、`codex/codex-state-db-backfill-recovery.ts`、`codex/codex-trust-grant-host.ts`、`codex/codex-app-server-session.ts`
- secure-file fsync 取上游结构 + 保留 win32 best-effort 降级；`wsl-codex-command.ts` 签名扩为 `(appServerArgs?, proxyEnv?)`
- rpcBindHost 正式放弃（8-12 合并已被静默丢接线成死代码；上游 STA-2370 动态 bind-host 覆盖原始需求）
- typecheck 三项目绿；定向测试全绿（解决面 + command-runner 12 文件 + fork delta 6 文件），notebook 补 3 用例含执行安全门 2 例
- 打包：`dist-merged/orca-windows-setup.exe` 173MB / `app.asar` 110MB（健康区间）
- 报告：浮动工作区 `2026-09-06-fork-diff-report.html`（上游 diff 汇报）
- 记忆：`windows-pnpm-install` / `windows-packaging-gotchas` 重写为 pnpm 12 时代；新增 `merge-conflict-intent-survival`

### 未完成 / 下一步
- [用户决策] push：本地领先 origin/main（含吞入的上游历史），push 与否由用户定
- [可选深审] 全量套件 466 失败未做预合并基线对比（环境型主导，样本与 fork delta 无关）；需要时 worktree@`e9d1a85cb` + junction node_modules 跑基线 diff
- [deferred·沿袭自 08-14] CLI/SSH relay 进程代理覆盖（P2-4）
- [deferred·沿袭自 08-14] WSL git 代理注入缺直接单测
- [反哺上游] service-wsl-accounts 信任配置用例 Windows 本地失败（纯上游代码已取证）+ notebook dialog mock 模式，可提 issue/PR
- 下一步验证命令: `pnpm run tc && pnpm exec vitest run --config config/vitest.config.ts src/main/rate-limits/codex-fetcher.test.ts src/main/ipc/notebook.test.ts`

### 活跃 Worktree
- [无]

## 失败尝试
- pnpm shim 断链（12.0.0 死链）：`npx pnpm@10.24.0` 也会自派发到断链 12 报「不是内部或外部命令」——修法 `npm i -g pnpm@12.0.0`，勿再用 10.24 绕过
- npmmirror 缺发布元数据：minimumReleaseAge 校验必挂（sherpa-onnx-darwin-x64）——装依赖加 `--registry=https://registry.npmjs.org`，勿改上游 exclude
- `@typescript/typescript-win32-x64` 未物化（非冷静期问题，7.0.2 发布已 2 个月）——devDep 显式钉住解决
- electron-builder 默认输出 `dist/` 会撞运行中 Orca 的文件锁——必须 `--config.directories.output=dist-merged`
- 新写 vitest 用例在 handler 同步返回后立刻读 `mock.results[0]` 为 undefined——handler 首个 await 是对话框微任务，先 `advanceTimersByTimeAsync(0)` 冲刷

## 风险 & 提醒
- 6 个 Orca 进程仍从 `dist\win-unpacked` 运行，勿杀；重打包必须重定向 dist-merged
- 全量套件 466 失败为环境型主导（unix socket/conpty/dialog mock），非合并回归；勿当新回归追
- service-wsl-accounts 1 例失败为纯上游代码 Windows 本地行为差异（service.ts 与测试均与上游逐字节一致，已取证）
- pnpm 工具链现为 12.0.0（上游 packageManager 钉住），10.24 时代做法已作废
- notebook 执行安全门仍无上游等价物，属 fork 独有安全语义，后续同步上游时注意保护

## 恢复入口
1. `git checkout main`（已在）
2. 读取 `.agent/handoff.md`（本文档）
3. 下一步验证命令: `pnpm run tc && pnpm exec vitest run --config config/vitest.config.ts src/main/rate-limits/codex-fetcher.test.ts src/main/ipc/notebook.test.ts`
