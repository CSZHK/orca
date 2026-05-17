# /docs audit — 文件治理健康扫描

对项目文件执行深度健康检查，输出结构化报告。

## 检查项

请依次执行以下检查并输出表格：

### 1. Tier 0 膨胀检查
```bash
wc -l CLAUDE.md CLAUDE.local.md .claude/rules/*.md backend/CLAUDE.md frontend/CLAUDE.md 2>/dev/null
```
对比阈值: CLAUDE.md≤200, CLAUDE.local.md≤450, rules/*.md≤100/个, 子项目CLAUDE.md 自由

### 2. .claude/ 根目录孤儿
```bash
find .claude/ -maxdepth 1 -name '*.md' -type f
```
预期: 0 个（全部应在 rules/skills/commands/ 下）

### 3. 项目根目录孤儿
```bash
find . -maxdepth 1 -name '*.md' -type f ! -name 'CLAUDE.md' ! -name 'CLAUDE.local.md' ! -name 'README.md' ! -name 'CHANGELOG*.md'
```

### 4. docs/ 容量
```bash
find docs/ -name '*.md' -not -path '*/archive/*' -type f | wc -l
```
阈值: ≤500

### 5. Skills 体积
```bash
du -sm .claude/skills/ && find .claude/skills -mindepth 1 -maxdepth 1 -type d ! -name '_archive' | wc -l
```
阈值: ≤20MB（不含 .output）, ≤50 个

### 6. Stale 文件（>90天未修改）
```bash
find docs/ .claude/rules/ .claude/skills/ -name '*.md' -not -path '*/archive/*' -not -path '*/_archive/*' -mtime +90 -type f
```

### 7. 断链检测
```bash
# 检查 link-graph.jsonl 中 target 文件是否存在
```

## 输出格式

| 检查项 | 状态 | 详情 |
|--------|------|------|
| Tier 0 膨胀 | PASS/WARN | 具体行数 |
| .claude/ 孤儿 | PASS/FAIL | 文件列表 |
| 根目录孤儿 | PASS/FAIL | 文件列表 |
| docs/ 容量 | PASS/WARN | N/500 |
| Skills 体积 | PASS/WARN | NMB / N个 |
| Stale 文件 | PASS/WARN | 数量+列表 |
| 断链 | PASS/WARN | 数量 |
