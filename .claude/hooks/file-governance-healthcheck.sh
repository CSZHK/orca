#!/bin/bash
# File Governance Healthcheck — UserPromptSubmit hook
# 每 5 次用户提交自动执行一次轻量健康检查
#
# 永远 exit 0（不阻断用户输入），通过 stderr 输出摘要

# 不使用 set -e: 所有失败都应容错，永不崩溃
set -uo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
metrics_dir="$PROJECT_ROOT/.claude/context"
mkdir -p "$metrics_dir" 2>/dev/null || true
counter_file="$metrics_dir/healthcheck-counter"

# ═══════════════════════════════════════════════════════════════════════════
# 计数器：使用 flock 原子递增，每 5 次执行一次
# ═══════════════════════════════════════════════════════════════════════════
(
    if flock -w 2 200 2>/dev/null; then
        count=0
        [[ -f "$counter_file" ]] && count=$(cat "$counter_file" 2>/dev/null || echo 0)
        count=$((count + 1))
        echo "$count" > "$counter_file"
    fi
) 200>"${counter_file}.lock" 2>/dev/null || true

count=$(cat "$counter_file" 2>/dev/null || echo 0)

if [[ $((count % 5)) -ne 0 ]]; then
    exit 0  # 未到检查间隔，静默放行
fi

# ═══════════════════════════════════════════════════════════════════════════
# 健康检查（轻量级，<3s）—— 所有检查都做容错
# ═══════════════════════════════════════════════════════════════════════════
warnings=0

# 1. .claude/ 根目录孤儿 .md
if [[ -d "$PROJECT_ROOT/.claude" ]]; then
    orphan_count=$(find "$PROJECT_ROOT/.claude" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l || echo 0)
    if [[ "$orphan_count" -gt 0 ]]; then
        echo "HEALTHCHECK: .claude/ 根目录有 $orphan_count 个孤儿 .md 文件" >&2
        warnings=$((warnings + 1))
    fi
fi

# 2. Tier 0 文件行数
for f in CLAUDE.md CLAUDE.local.md; do
    if [[ -f "$PROJECT_ROOT/$f" ]]; then
        lines=$(wc -l < "$PROJECT_ROOT/$f" 2>/dev/null || echo 0)
        limit=200; [[ "$f" == "CLAUDE.local.md" ]] && limit=450
        if [[ "$lines" -gt "$limit" ]]; then
            echo "HEALTHCHECK: $f 已达 ${lines} 行（上限 $limit）" >&2
            warnings=$((warnings + 1))
        fi
    fi
done

# 3. Skills 体积
if [[ -d "$PROJECT_ROOT/.claude/skills" ]]; then
    skills_size=$(du -sm "$PROJECT_ROOT/.claude/skills" 2>/dev/null | cut -f1 || echo 0)
    if [[ "$skills_size" -gt 50 ]]; then
        echo "HEALTHCHECK: .claude/skills/ 体积 ${skills_size}MB（检查 .output/ 是否需清理）" >&2
        warnings=$((warnings + 1))
    fi
fi

# 4. Stale docs (>90天未修改)
if [[ -d "$PROJECT_ROOT/docs" ]]; then
    stale_count=$(find "$PROJECT_ROOT/docs" -name '*.md' -not -path '*/archive/*' -mtime +90 -type f 2>/dev/null | wc -l || echo 0)
    if [[ "$stale_count" -gt 10 ]]; then
        echo "HEALTHCHECK: docs/ 有 $stale_count 个文件超过 90 天未修改" >&2
        warnings=$((warnings + 1))
    fi
fi

# 5. 断链检测（流式取前 20 行，避免 shuf 全量扫描）
link_graph="$PROJECT_ROOT/.claude/context/link-graph.jsonl"
if [[ -f "$link_graph" ]]; then
    broken=0
    while IFS= read -r line; do
        target=$(echo "$line" | jq -r '.target // empty' 2>/dev/null || true)
        if [[ -n "$target" ]] && [[ ! -f "$PROJECT_ROOT/$target" ]]; then
            broken=$((broken + 1))
        fi
    done < <(head -20 "$link_graph" 2>/dev/null || true)
    if [[ "$broken" -gt 0 ]]; then
        echo "HEALTHCHECK: 链接图抽样发现 $broken 个断链（共检查 20 条）" >&2
        warnings=$((warnings + 1))
    fi
fi

# 输出摘要
if [[ "$warnings" -eq 0 ]]; then
    echo "HEALTHCHECK: 全部通过 (check #$count)" >&2
else
    echo "HEALTHCHECK: 发现 $warnings 个问题 (check #$count)。运行 /docs audit 查看详情" >&2
fi

# 记录到治理指标
echo "$(date +%Y-%m-%dT%H:%M:%S):healthcheck:warnings=$warnings:check=$count" >> "$metrics_dir/governance-metrics.log" 2>/dev/null || true

exit 0
