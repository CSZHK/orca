---
name: upstream-sync
description: >
  USE WHEN 用户决定把 stablyai/orca 上游 main 同步进本 fork（触发词：同步上游、sync upstream、merge upstream）：
  按固定 runbook 执行——探测差距→试合并评估→解冲突（净零侵入约定）→提交前 oxlint 自检→串行提交→定向验证→lockfile 重生成→立即 push。
  同步时机完全由用户手动决定，本 skill 不含任何自动触发。
  DON'T USE WHEN：想自动化同步节奏（用户明确拒绝）；只看上游新功能不合并（直接 git log 探测即可，不走本流程）。
---

# upstream-sync — 上游同步 runbook

源头：2026-11-26 同步 14,650 提交实操。事故与教训详见用户目录记忆（非仓内）`merge-sync-lint-staged` / `fork-proxy-architecture` / `windows-packaging-gotchas`；进度笔记 `.claude/working/merge-upstream-2026-11-26.md` 可能已被治理 hook 清理，仅为可失链的原始出处。

## 0. 前置

- `git status` 干净（`.claude/context/healthcheck-counter` 的 hook 噪音可忽略）；无未推提交（`git status -sb`）
- 一次只跑一个 git commit：等 `index.lock` 消失且 commit 进程退出，再跑下一个——后台排队的过期 commit 会在 merge 待提交时抢 concluding（用错消息）

## 1. 探测（动手前必做，结果交用户决定）

```bash
git fetch upstream main        # 只拉 main；全分支 fetch 会拖死
git rev-list --count HEAD..upstream/main   # 落后
git rev-list --count upstream/main..HEAD   # 领先
git merge-tree --write-tree HEAD upstream/main   # 试合并，数冲突文件（不碰工作区）
```

向用户汇报差距/冲突面后**等明确指令才 merge**——同步时机用户手动决定。

## 2. merge

```bash
git merge upstream/main -m "merge upstream/main: 同步 N 提交(YYYY-MM-DD→YYYY-MM-DD)"
```

## 3. 解冲突原则

- **先查上游是否已原生实现同款能力**（`git ls-tree -r upstream/main | grep /<basename>` + `git grep <关键词> upstream/main -- src/`）——已实现则本地补丁作废、直接取上游版。间隔越长命中越多
- **UD（modify/delete）冲突**：上游搬走了文件。按 basename 在上游树里找新路径，把本地补丁语义重放到新路径；确认补丁无残留价值则直接删旧取新
- **300 行冻结文件**：上游大量文件恰在 oxlint max-lines=300（跳过注释/空行计数）——这些文件**一个代码行都不能加**。fork 行为按 `.claude/rules/fork-overlay.md` 落自有模块或净零改 import
- 每解一个文件立即 `git add`

## 4. 提交前自检（防回滚洗工作区）

对**全部触碰文件**跑 `pnpm exec oxlint <files>`，exit 0 才允许 commit。
lint-staged 失败会回滚洗掉整个 merge 解冲突工作区（2026-06-11、2026-11-26 两次事故）——oxlint 先行是唯一防线。若还是被洗：重跑 merge（rerere 已开启会重放已记录的解法），按本节自检后再提交。

## 5. 提交与核对

- merge commit 落地后核对：`git log -1 --format='%h %s%n%P'` —— 双父 + 消息正确；消息错（如被过期任务抢 concluding）立即 `git commit --amend -m <正确消息>`（空暂存时秒过）
- 后续修复单独提交，信息按 Conventional Commits 中文惯例

## 6. 验证

- `pnpm tc`（全部项目零错误）
- 触碰模块的定向测试 `pnpm test <files> --maxWorkers=2`；**不跑全量**——Windows 环境性失败数百条是已知基线
- package.json 有改动时：取上游 lockfile → `pnpm install --lockfile-only --registry=https://registry.npmjs.org`（npmmirror 挂 minimumReleaseAge）→ 供应链校验通过 → 全量 `pnpm install`

## 7. 立即 push

```bash
git push origin main
```

K: 盘有高 IO 掉线前科（2026-11-26 整盘掉线自愈）——未推的 merge 就是未备份的工作。打包前也应先推。

## 8. 打包（如需）

`powershell -NoProfile -ExecutionPolicy Bypass -File rebuild-windows-installer.ps1 -OutDir dist-new [-RepackageOnly]`——流程与健康体积基线见记忆 `windows-packaging-gotchas`。

## 坑速查

| 坑                                  | 防线                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- |
| lint-staged 失败回滚洗 merge 工作区 | 第 4 节 oxlint 自检                                                    |
| 过期后台 commit 抢 concluding       | 第 0 节串行纪律 + 第 5 节核对                                          |
| 300 行冻结文件加行爆 lint           | fork-overlay 规则                                                      |
| lockfile 手解冲突                   | 永远重生成不手解                                                       |
| 打包被扫历史输出树                  | electron-builder files 排除清单保持含 dist-merged/dist-new/dist-staged |
