# /docs cleanup — 引导式清理

扫描过期/臃肿文件，引导用户决策（归档/精简/保留）。

## 流程

### 1. 扫描 Stale 文件（>90天未修改）
```bash
find docs/ .claude/skills/ -name '*.md' -not -path '*/archive/*' -not -path '*/_archive/*' -mtime +90 -type f -printf '%T+ %p\n' | sort
```

### 2. 扫描大文件（>500行）
```bash
find docs/ .claude/ -name '*.md' -type f -exec sh -c 'lines=$(wc -l < "$1"); [ "$lines" -gt 500 ] && echo "$lines $1"' _ {} \; | sort -rn
```

### 3. 扫描 .output/ 可回收空间
```bash
du -sh .claude/skills/*/.output/ 2>/dev/null
```

### 4. 扫描 tsc-cache 可回收
```bash
du -sh .claude/tsc-cache/ 2>/dev/null
```

## 对每个候选文件，提供选项

- **归档**: 移至 `docs/archive/<来源>/` 或 `.claude/skills/_archive/`
- **精简**: 当场帮用户压缩内容
- **保留**: 标记为已审查（touch 更新 mtime）
- **删除**: 仅对 .output/ 和 tsc-cache/（非文档）

## 执行归档时

1. `mkdir -p` 目标目录
2. `git mv` 源文件到目标
3. 更新 `docs/archive/README.md` 记录来源和原因
4. 更新 `docs/00-index.md` 移除已归档条目
