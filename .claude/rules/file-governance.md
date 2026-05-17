# 文件治理规范 v3.0

> 自动化门控 + 手动命令补充。完整框架设计见 `docs/file-governance-framework.md`

## 受管范围

`.claude/`（hooks/rules/skills/commands）+ `docs/` + 根目录 `.md`。
源码（`backend/src/` `frontend/src/`）不受管。

## 命名规范

- **默认**: `lowercase-kebab-case.md` / `.sh`
- **白名单例外**: CLAUDE.md, CLAUDE.local.md, README.md, SKILL.md, CHANGELOG.md, LICENSE
- **禁止**: `temp-*`, `untitled-*`, `draft-*`（用 `.claude/working/`）
- **ADR**: `adr-NNN-kebab-case.md`（编号查 `docs/99-adr/README.md`）

## 位置规则

| 放在哪 | 放什么 |
|--------|--------|
| `.claude/rules/` | 治理规则（≤5个，合计≤300行） |
| `.claude/skills/<name>/` | 技能包（≤50个，含 SKILL.md） |
| `.claude/commands/` | 用户命令模板 |
| `docs/` | 项目文档 |
| `docs/archive/` | 已废弃文档（仅从 docs/ 移入） |
| `.claude/` 根目录 | 禁止 .md 文件 |
| 项目根目录 | 仅 CLAUDE.md / CLAUDE.local.md / README.md |

## 自动门控（hook 驱动）

- **PreToolUse Write** → `file-governance-gate.sh`: 命名+位置+容量检查
- **PostToolUse Edit|Write** → `file-governance-tracker.sh`: 膨胀检测+链接图
- **UserPromptSubmit** → `file-governance-healthcheck.sh`: 每5次轻量健康检查
- **SessionEnd** → `cleanup_storage.sh`: tsc-cache/skills .output/working 自动清理

## 膨胀阈值

| 文件 | 行数上限 | 超限动作 |
|------|---------|---------|
| CLAUDE.md | 200 | WARN |
| CLAUDE.local.md | 450 | WARN |
| .claude/rules/*.md | 100/个 | WARN |
| SKILL.md | 500 | WARN |
| docs/*.md | 1000 | WARN |

## 手动命令

`/docs audit` · `/docs budget` · `/docs cleanup` · `/docs search` · `/docs links` · `/docs graph`

## 链接图

持久化位置: `.claude/context/link-graph.jsonl`。PostToolUse 自动维护。
查询: `grep '"target":"<file>"' .claude/context/link-graph.jsonl`

## 归档

- 活跃: mtime ≤90天
- 过期: mtime >90天 → `/docs cleanup` 引导归档
- 归档: 移入 `archive/` 或 `_archive/` → 180天后可清除

## 参见

- [部署规范](deployment-standards.md)
- 原 `documentation-standards.md` 已合并入本文件
