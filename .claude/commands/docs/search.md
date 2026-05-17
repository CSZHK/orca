# /docs search — 分层语义检索

在项目文档中搜索关键词，按 5 层递进检索。

## 参数

$ARGUMENTS = 搜索关键词

## 检索流程

### Layer 1: 索引导航（0 cost）
读取 `docs/00-index.md`，查找与关键词匹配的分区。

### Layer 2: 关键词检索
```bash
grep -rli "$ARGUMENTS" docs/ .claude/rules/ .claude/skills/*/SKILL.md --include='*.md' 2>/dev/null | head -20
```

### Layer 3: 标签检索
```bash
grep -rli "tags:.*$ARGUMENTS" docs/ .claude/ --include='*.md' 2>/dev/null
```

### Layer 4: 链接追踪
从 Layer 2/3 发现的文件，在 `.claude/context/link-graph.jsonl` 中查找相关链接：
```bash
# 对每个已找到的文件
grep '"source":"<found_file>"' .claude/context/link-graph.jsonl
grep '"target":"<found_file>"' .claude/context/link-graph.jsonl
```

### Layer 5: 内容摘要
对最相关的 top 5 文件，读取开头 20 行给出摘要。

## 输出格式

| 文件 | 匹配层 | 相关性 | 摘要 |
|------|--------|--------|------|
| docs/xx.md | L2 关键词 | 高 | 前20行摘要 |
