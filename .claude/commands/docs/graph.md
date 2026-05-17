# /docs graph — 知识图谱摘要

输出项目文档的知识图谱概览。

## 执行

### 1. 链接图统计
```bash
link_graph=".claude/context/link-graph.jsonl"
if [ -f "$link_graph" ]; then
  total=$(wc -l < "$link_graph")
  sources=$(jq -r '.source' "$link_graph" | sort -u | wc -l)
  targets=$(jq -r '.target' "$link_graph" | sort -u | wc -l)
  echo "链接总数: $total | 源文件: $sources | 目标文件: $targets"
fi
```

### 2. 核心节点（被引用最多的 top 10）
```bash
jq -r '.target' .claude/context/link-graph.jsonl | sort | uniq -c | sort -rn | head -10
```

### 3. 孤岛节点（零引用文件）
列出 docs/ 和 .claude/rules/ 下没有被任何文件引用的 .md 文件。

### 4. 断链列表
```bash
jq -r '.target' .claude/context/link-graph.jsonl | sort -u | while read t; do
  [ ! -f "$t" ] && echo "断链: $t"
done
```

### 5. 主题聚类（按 frontmatter tags）
```bash
grep -rh '^tags:' docs/ .claude/ --include='*.md' 2>/dev/null | sed 's/tags: *\[//;s/\]//;s/, */\n/g' | sort | uniq -c | sort -rn | head -15
```

## 输出格式

```
=== 知识图谱摘要 ===

📊 链接: N条 | 源: N个 | 目标: N个

🏆 核心节点 (top 10):
  1. docs/foo.md (被引用 12 次)
  ...

🏝️ 孤岛节点: N 个
  - docs/orphan.md
  ...

🔗 断链: N 个
  - docs/deleted.md
  ...

🏷️ 主题聚类 (top 15):
  - governance (8)
  - deployment (6)
  ...
```
