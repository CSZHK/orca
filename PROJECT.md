# Orca-dev · 项目状态总览

> **一句话**:`stablyai/orca` 的个人 Windows fork —— 把"并行 agentic 开发 IDE"打磨到能在 Windows 上稳定跑、能打包分发。本 fork 做的是**兼容与加固**,不是上游产品功能开发。
> **最后更新**:2026-06-04 · 切到本项目先读「当前阶段」;阶段一变随手更新本文件。

---

## ⏱ 当前阶段(切过来先看这里)

**Post-merge 稳定化 → 出 Windows 安装包 / CLI 部署**

- ✅ **刚完成(06-01)**:同步 upstream `stablyai/orca` 共 **1994 个 commit** 到本 fork。
- 🔧 **正在收尾**:修 merge 带回的 Windows PATH 大小写回归(PTY 丢整个 PATH)、重接 agent-status coalescer 防渲染器 OOM、清失效测试 mock。
- 🚧 **在飞未提交**:
  - `rebuild-windows-installer.ps1`(06-01 新增)→ 重打 NSIS Windows 安装包
  - `orca-cli-deploy.tar.gz` + `tmp-cli-deploy/`(05-25)→ CLI 部署包
  - `pnpm-lock.yaml` 有改动(依赖未定版)

> 收工前:动代码后跑 `pnpm tc`(三个 TS project)+ `pnpm test`。

---

## 🎯 下一步(基于在飞产物推断,待确认)

- [ ] 跑通 `rebuild-windows-installer.ps1`,产出可分发的 Windows 安装包
- [ ] 落定 CLI 部署流程(`tmp-cli-deploy/` 转正或清理)
- [ ] 决定 `pnpm-lock.yaml` 改动去留并提交
- [ ] 清理根目录临时产物(`*.tar.gz` / `test-e2e.txt` / `tmp-cli-deploy/`)
- [ ] _(你的真实 roadmap 项写这里 —— 我只能从 git 反推已做的,做不到读心未来计划)_

---

## 📦 这是什么

| 维度 | 内容 |
|------|------|
| 上游 | `stablyai/orca` —— "Next-gen IDE for parallel agentic development",Electron 应用,跨 git worktree 编排 Claude Code / Codex / Grok 等 CLI agent |
| 本 fork | `CSZHK/orca`(origin),专注 **Windows 兼容 + 稳定性/安全加固** |
| 版本 | `1.4.51` · Electron 42 · Node 24 · pnpm 10.24+ |
| 架构 | Main / Renderer(React+Zustand)/ Preload(IPC 边界)/ Relay(SSH 多路复用)/ CLI;详见 `CLAUDE.md` |

---

## 🗺 本 fork 工作线(已完成,2026-05-17 起)

按主题归类 —— 这就是这个 fork 实际在解决的问题域:

**A · Windows 兼容(最大头)**
- PATH 大小写去重 / 回归修复(防环境变量重复、防 PTY 丢整个 PATH)
- ConPTY 双重 kill 修复;内核保留端口 EACCES → ws-transport fallback
- 新装 CLI 从注册表同步 PATH

**B · 渲染器稳定(agent-status OOM)**
- 合并快速 IPC 事件 / 重接 coalescer / 按状态切换分流,防渲染器 OOM

**C · 安全与安全删除**
- IPC/Relay/RPC 安全边界加固
- 孤儿 worktree 清理防递归删用户文件
- SSH IdentityFile 路径去引号

**D · 上游同步**
- 06-01 一次性合入 1994 commits(本轮稳定化的触发点)

---

## 🔧 怎么维护这份文件

- **位置固定**:永远在项目根 `PROJECT.md`,切项目第一眼就看它。
- **更新时机**:阶段切换 / 开新工作线 / 打包发版后 —— 改「当前阶段」+「下一步」两节即可,别攒着。
- **只放 high-level**:细节进 commit message 或 `docs/`;这里只回答"现在在哪、下一步去哪"。
- **可选自动播报**:加个 SessionStart hook 读本文件,切进来自动打印「当前阶段」(本次未启用,要的话说一声)。
