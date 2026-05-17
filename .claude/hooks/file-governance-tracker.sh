#!/bin/bash
# File Governance Tracker — PostToolUse hook on Edit|Write|MultiEdit
# 膨胀检测 + 链接图维护（独立于现有 post-tool-use-tracker.sh）
#
# 永远 exit 0（PostToolUse 不阻断），通过 stderr 输出警告

set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════
# 读取 hook payload
# ═══════════════════════════════════════════════════════════════════════════
payload=$(cat)
tool_name=$(echo "$payload" | jq -r '.tool_name // empty' 2>/dev/null)
file_path=$(echo "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [[ -z "$file_path" ]]; then
    exit 0
fi

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# 路径规范化 + 项目根边界校验（防穿越）
if [[ "$file_path" == /* ]]; then
    abs_path=$(realpath -m "$file_path" 2>/dev/null || echo "$file_path")
else
    abs_path=$(realpath -m "$PROJECT_ROOT/$file_path" 2>/dev/null || echo "$PROJECT_ROOT/$file_path")
fi
if [[ "$abs_path" != "$PROJECT_ROOT"/* ]]; then
    exit 0  # 项目外路径，静默跳过
fi
rel_path="${abs_path#"$PROJECT_ROOT"/}"

# ═══════════════════════════════════════════════════════════════════════════
# Step 0: 快速路径
# ═══════════════════════════════════════════════════════════════════════════
case "$rel_path" in
    src-ui/src/*|src-ui/public/*|src-tauri/src/*|src-python/*)
        exit 0 ;;  # Tauri/Python 项目源码
    backend/src/*|frontend/src/*|frontend/public/*)
        exit 0 ;;
    .claude/working/*|.claude/context/*|.claude/tsc-cache/*|.claude/plugins/*)
        exit 0 ;;
esac

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: 记录变更到 session manifest
# ═══════════════════════════════════════════════════════════════════════════
manifest_dir="$PROJECT_ROOT/.claude/working"
mkdir -p "$manifest_dir"
lines=0
if [[ -f "$abs_path" ]]; then
    lines=$(wc -l < "$abs_path" 2>/dev/null || echo 0)
fi
echo "$(date +%Y-%m-%dT%H:%M:%S):${tool_name}:${rel_path}:${lines}" >> "$manifest_dir/session-manifest.log" 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════
# Step 2: 膨胀检测（仅受管 .md 文件）
# ═══════════════════════════════════════════════════════════════════════════
if [[ "$rel_path" == *.md ]] && [[ -f "$abs_path" ]]; then
    line_count=$(wc -l < "$abs_path" 2>/dev/null || echo 0)

    case "$rel_path" in
        CLAUDE.md)
            [[ "$line_count" -gt 200 ]] && echo "WARN: CLAUDE.md 已达 ${line_count} 行（上限 200）。考虑精简或迁移内容到 .claude/rules/" >&2
            ;;
        CLAUDE.local.md)
            [[ "$line_count" -gt 450 ]] && echo "WARN: CLAUDE.local.md 已达 ${line_count} 行（上限 450）。考虑精简" >&2
            ;;
        .claude/rules/*.md)
            [[ "$line_count" -gt 100 ]] && echo "WARN: $rel_path 已达 ${line_count} 行（单文件上限 100）" >&2
            ;;
        .claude/skills/*/SKILL.md)
            [[ "$line_count" -gt 500 ]] && echo "WARN: $rel_path 已达 ${line_count} 行（上限 500）" >&2
            ;;
        docs/*.md)
            [[ "$line_count" -gt 1000 ]] && echo "WARN: $rel_path 已达 ${line_count} 行（上限 1000）。考虑拆分" >&2
            ;;
    esac
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 3: 链接图更新（仅 .md 文件变更时）
# ═══════════════════════════════════════════════════════════════════════════
if [[ "$rel_path" == *.md ]] && [[ -f "$abs_path" ]]; then
    context_dir="$PROJECT_ROOT/.claude/context"
    mkdir -p "$context_dir"
    link_graph="$context_dir/link-graph.jsonl"

    # 使用 flock 防止并发写入；锁失败则跳过本次更新
    (
        if ! flock -w 5 200 2>/dev/null; then
            exit 0  # 锁获取失败，跳过
        fi

        # 先删除该 source 的所有旧链接（使用 jq 精确匹配，避免 grep 正则误删）
        if [[ -f "$link_graph" ]]; then
            tmp_graph="${link_graph}.tmp.$$"
            jq -c --arg s "$rel_path" 'select(.source != $s)' "$link_graph" > "$tmp_graph" 2>/dev/null || cp "$link_graph" "$tmp_graph"
            mv "$tmp_graph" "$link_graph" 2>/dev/null || true
        fi

        # 提取新链接（过滤代码块）
        source_dir=$(dirname "$rel_path")
        in_code_block=false
        today=$(date +%Y-%m-%d)
        link_regex='\[([^]]+)\]\(([^)]+)\)'

        while IFS= read -r line; do
            # 代码块状态机
            if [[ "$line" =~ ^\`\`\` ]]; then
                if [[ "$in_code_block" == "false" ]]; then
                    in_code_block=true
                else
                    in_code_block=false
                fi
                continue
            fi
            [[ "$in_code_block" == "true" ]] && continue

            while [[ "$line" =~ $link_regex ]]; do
                anchor="${BASH_REMATCH[1]}"
                target="${BASH_REMATCH[2]}"
                line="${line#*"${BASH_REMATCH[0]}"}"

                # 跳过外部链接和锚点
                case "$target" in
                    http://*|https://*|mailto:*|\#*) continue ;;
                esac

                # 移除锚点部分
                target="${target%%#*}"
                [[ -z "$target" ]] && continue

                # 路径归一化：相对路径 → 项目根相对路径
                if [[ "$target" != /* ]]; then
                    if [[ "$source_dir" != "." ]]; then
                        target=$(realpath -m --relative-to="$PROJECT_ROOT" "$PROJECT_ROOT/$source_dir/$target" 2>/dev/null || echo "$source_dir/$target")
                    fi
                else
                    target="${target#/}"
                fi

                # 使用 jq 生成合法 JSON（防注入）
                jq -nc --arg s "$rel_path" --arg t "$target" --arg a "${anchor:0:100}" --arg d "$today" \
                    '{source:$s,target:$t,anchor:$a,updated:$d}' >> "$link_graph" 2>/dev/null || true
            done
        done < "$abs_path"

    ) 200>"${link_graph}.lock"
fi

exit 0
