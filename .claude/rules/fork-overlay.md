# fork-overlay — fork 本地功能的落点约定

> 目的：最小化与 upstream 的冲突面，让每次上游同步的补丁可机械重放。来源：2026-11-26 同步 14,650 提交的实战教训。

1. **fork 新行为放 fork 自有模块**，不写进上游文件。先例：`src/main/network/configured-proxy-env.ts`（代理委托）、`src/main/codex-accounts/login/codex-login-session-proxy.ts`（登录代理包装）、`src/main/network/global-fetch-proxy.ts`（undici 路由）。
2. **对上游文件只允许净零改动**——换一行 import、换一个调用名。禁止加删代码行：上游大量文件恰在 oxlint max-lines=300（跳过注释/空行计数），任何加行都会炸 lint-staged 并触发回滚洗掉整个 merge 工作区。改前先 `pnpm exec oxlint <file>` 量行数余量。
3. **注入类需求优先挂上游已有的中心层**（例：`provider-process-launch.ts` 的 `resolveProviderChildEnv`、`proxy-settings.ts` 的 `applyElectronProxySettings`、`wsl-codex-command.ts` 的 builder 默认参数），在其有行数余量的文件内 ≤2 行。
4. **`NO_PROXY` 默认 `localhost,127.0.0.1,::1`**（`src/shared/network/network-proxy.ts` 的 `buildConfiguredProxyEnv`）是 fork 有意偏离上游（上游为 `''`）——同步解冲突时保留，不得"修"回上游。
5. **解冲突时先查上游等价实现**：`git grep <关键词> upstream/main -- src/`——上游已原生实现的本地补丁直接作废取上游，不重放。
