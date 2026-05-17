#!/bin/bash
# File Governance Gate — PreToolUse hook on Write
# 准入门控：命名规范 + 位置检查 + 容量检查 + 重复提醒
#
# 退出码:
#   0 = 放行
#   2 = 阻断（BLOCK）
#
# 治理边界：仅拦截 Claude 文件工具 (Write)
# Bash 工具 (rm/mv/git mv) 不受此 hook 管控——这是 Claude Code hook 机制的固有限制

set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════
# 读取 hook payload
# ═══════════════════════════════════════════════════════════════════════════
payload=$(cat)
file_path=$(echo "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [[ -z "$file_path" ]]; then
    exit 0  # 无文件路径，放行
fi

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# 路径规范化 + 项目根边界校验（防止 ../escape.md 和 /tmp/evil.md 绕过）
if [[ "$file_path" == /* ]]; then
    abs_path=$(realpath -m "$file_path" 2>/dev/null || echo "$file_path")
else
    abs_path=$(realpath -m "$PROJECT_ROOT/$file_path" 2>/dev/null || echo "$PROJECT_ROOT/$file_path")
fi

# 强校验: 路径必须在项目根内
if [[ "$abs_path" != "$PROJECT_ROOT"/* ]] && [[ "$abs_path" != "$PROJECT_ROOT" ]]; then
    echo "BLOCK: 路径 '$file_path' 不在项目根目录内" >&2
    exit 2
fi

rel_path="${abs_path#"$PROJECT_ROOT"/}"
filename=$(basename "$rel_path")
dirpath=$(dirname "$rel_path")

# ═══════════════════════════════════════════════════════════════════════════
# Step 0: 快速路径——非受管路径直接放行
# ═══════════════════════════════════════════════════════════════════════════
case "$rel_path" in
    src-ui/src/*|src-ui/public/*|src-tauri/src/*|src-python/*)
        exit 0 ;;  # Tauri/Python 项目源码不受管
    backend/src/*|frontend/src/*|frontend/public/*)
        exit 0 ;;  # 通用前后端源码不受管
    .claude/working/*|.claude/context/*|.claude/tsc-cache/*|.claude/plugins/*)
        exit 0 ;;  # 临时/缓存/插件区自由写入
    .claude/collab/*)
        exit 0 ;;  # 协作区自由写入
esac

# 仅管控 .md 和 .sh 文件
case "$filename" in
    *.md|*.sh) ;;  # 继续检查
    *) exit 0 ;;   # 非 .md/.sh 直接放行
esac

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: 命名检查
# ═══════════════════════════════════════════════════════════════════════════

# 白名单矩阵（大写例外）
is_whitelisted() {
    local fname="$1"
    local fdir="$2"
    # 全局白名单
    case "$fname" in
        CLAUDE.md|CLAUDE.local.md|README.md|LICENSE|CHANGELOG.md|CHANGELOG-*.md)
            return 0 ;;
    esac
    # 技能目录白名单
    if [[ "$fdir" == .claude/skills/* ]] && [[ "$fname" == "SKILL.md" ]]; then
        return 0
    fi
    # 子项目 CLAUDE.md
    if [[ "$fdir" == "backend" || "$fdir" == "frontend" ]] && [[ "$fname" == "CLAUDE.md" ]]; then
        return 0
    fi
    return 1
}

# 禁止模式
case "$filename" in
    temp-*|untitled-*|draft-*)
        echo "BLOCK: 禁止命名模式 '$filename'。临时文件请用 .claude/working/" >&2
        exit 2 ;;
esac

# kebab-case 检查（跳过白名单）
if ! is_whitelisted "$filename" "$dirpath"; then
    # kebab-case 正则: 小写字母开头, 允许小写字母/数字/连字符, 以 .md 或 .sh 结尾
    # ADR 特殊格式: adr-NNN-kebab-case.md
    # docs 特殊格式: NN-kebab-case.md
    if [[ "$filename" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.(md|sh)$ ]]; then
        :  # 通过
    elif [[ "$filename" =~ ^adr-[0-9]{3}-[a-z0-9-]+\.md$ ]]; then
        :  # ADR 格式通过
    elif [[ "$filename" =~ ^[0-9]{2}-[a-z0-9-]+\.md$ ]]; then
        :  # docs NN-kebab 格式通过
    else
        suggested=$(echo "$filename" | tr '[:upper:]' '[:lower:]' | tr ' _' '--' | sed 's/[^a-z0-9._-]//g')
        echo "BLOCK: 文件名 '$filename' 不符合 kebab-case 规范。建议: $suggested" >&2
        exit 2
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 2: 位置检查
# ═══════════════════════════════════════════════════════════════════════════

# .claude/ 根目录禁止 .md 文件（settings*.json 除外）
if [[ "$dirpath" == ".claude" ]] && [[ "$filename" == *.md ]]; then
    echo "BLOCK: .claude/ 根目录禁止创建 .md 文件。请使用 .claude/rules/ .claude/skills/ 或 .claude/commands/" >&2
    exit 2
fi

# 项目根目录禁止新 .md（CLAUDE.md/CLAUDE.local.md/README.md 除外）
if [[ "$dirpath" == "." ]] && [[ "$filename" == *.md ]]; then
    case "$filename" in
        CLAUDE.md|CLAUDE.local.md|README.md|CHANGELOG.md|CHANGELOG-*.md) ;;  # 允许
        *)
            # 仅阻断新文件创建，已存在的文件允许编辑
            if [[ ! -f "$PROJECT_ROOT/$rel_path" ]]; then
                echo "BLOCK: 项目根目录禁止创建新 .md 文件 '$filename'。请使用 docs/ 或 .claude/" >&2
                exit 2
            fi
            ;;
    esac
fi

# docs/archive/ 禁止直接创建新文件
if [[ "$rel_path" == docs/archive/* ]] && [[ ! -f "$PROJECT_ROOT/$rel_path" ]]; then
    # 允许 README.md
    if [[ "$filename" != "README.md" ]]; then
        echo "BLOCK: docs/archive/ 只能从 docs/ 移入，不能直接创建。请先在 docs/ 创建后归档" >&2
        exit 2
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 3: 容量检查（Phase A: 仅 WARN，不阻断）
# ═══════════════════════════════════════════════════════════════════════════
# 切换为 BLOCK: 设置 ENFORCE_CAPACITY=true
ENFORCE=${ENFORCE_CAPACITY:-false}

if [[ "$rel_path" == .claude/rules/*.md ]] && [[ -d "$PROJECT_ROOT/.claude/rules" ]]; then
    count=$(find "$PROJECT_ROOT/.claude/rules" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l) || count=0
    if [[ "$count" -ge 5 ]] && [[ ! -f "$PROJECT_ROOT/$rel_path" ]]; then
        echo "WARN: .claude/rules/ 已有 $count 个文件（上限 5）" >&2
        [[ "$ENFORCE" == "true" ]] && exit 2
    fi
fi

if [[ "$rel_path" == .claude/skills/*/SKILL.md ]] && [[ -d "$PROJECT_ROOT/.claude/skills" ]]; then
    count=$(find "$PROJECT_ROOT/.claude/skills" -mindepth 1 -maxdepth 1 -type d ! -name '_archive' 2>/dev/null | wc -l)
    if [[ "$count" -ge 50 ]] && [[ ! -f "$PROJECT_ROOT/$rel_path" ]]; then
        echo "WARN: .claude/skills/ 已有 $count 个技能包（上限 50）" >&2
        [[ "$ENFORCE" == "true" ]] && exit 2
    fi
fi

if [[ "$rel_path" == docs/*.md ]] && [[ "$rel_path" != docs/archive/* ]] && [[ -d "$PROJECT_ROOT/docs" ]]; then
    count=$(find "$PROJECT_ROOT/docs" -name '*.md' -not -path '*/archive/*' -type f 2>/dev/null | wc -l) || count=0
    if [[ "$count" -ge 500 ]] && [[ ! -f "$PROJECT_ROOT/$rel_path" ]]; then
        echo "WARN: docs/ 已有 $count 个文件（上限 500）" >&2
        [[ "$ENFORCE" == "true" ]] && exit 2
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 4: 重复检查（仅 WARN，不阻断）
# ═══════════════════════════════════════════════════════════════════════════
if [[ "$rel_path" == docs/*.md ]] && [[ ! -f "$PROJECT_ROOT/$rel_path" ]] && [[ -d "$PROJECT_ROOT/docs" ]]; then
    # 检查同名文件
    basename_noext="${filename%.md}"
    existing=$(find "$PROJECT_ROOT/docs" -name "*${basename_noext}*" -type f 2>/dev/null | head -3) || existing=""
    if [[ -n "$existing" ]]; then
        echo "WARN: 发现可能重复的文件:" >&2
        echo "$existing" >&2
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 5: 放行
# ═══════════════════════════════════════════════════════════════════════════
exit 0
