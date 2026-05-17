# /docs links — 双向链接查询

查询指定文件的引用关系和断链。

## 参数

$ARGUMENTS = 文件路径（项目相对路径）

## 执行

### 1. 正向链接（该文件引用了谁）
```bash
grep "\"source\":\"$ARGUMENTS\"" .claude/context/link-graph.jsonl 2>/dev/null | jq -r '.target' | sort -u
```

### 2. 反向链接（谁引用了该文件）
```bash
grep "\"target\":\"$ARGUMENTS\"" .claude/context/link-graph.jsonl 2>/dev/null | jq -r '.source' | sort -u
```

### 3. 断链检测
对正向链接中的每个 target，检查文件是否存在。

### 4. 孤岛检测（无参数时）
如果未提供文件路径，列出链接图中零引用的文件：
```bash
# 所有受管 .md 文件
find docs/ .claude/rules/ .claude/skills/ -name '*.md' -type f | while read f; do
  rel=$(echo "$f" | sed 's|^\./||')
  refs=$(grep -c "\"target\":\"$rel\"" .claude/context/link-graph.jsonl 2>/dev/null || echo 0)
  [ "$refs" -eq 0 ] && echo "孤岛: $rel"
done
```

## 输出格式

```
=== $ARGUMENTS 链接报告 ===

引用了 (N 个):
  → docs/foo.md
  → docs/bar.md

被引用 (N 个):
  ← CLAUDE.md
  ← docs/00-index.md

断链 (N 个):
  ✗ docs/deleted-file.md （目标不存在）
```
