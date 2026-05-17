# /docs budget — Token 预算报告

统计 Tier 0 自动加载文件的行数，计算 token 预算使用率。

## 执行

```bash
echo "=== Tier 0 Token Budget ==="
echo ""
echo "| 文件 | 行数 | 上限 | 使用率 |"
echo "|------|------|------|--------|"

for f in CLAUDE.md CLAUDE.local.md; do
  [ -f "$f" ] && lines=$(wc -l < "$f") && echo "| $f | $lines | $([ "$f" = "CLAUDE.md" ] && echo 200 || echo 450) | $((lines * 100 / $([ "$f" = "CLAUDE.md" ] && echo 200 || echo 450)))% |"
done

total_rules=0
for f in .claude/rules/*.md; do
  [ -f "$f" ] && lines=$(wc -l < "$f") && total_rules=$((total_rules + lines)) && echo "| $f | $lines | 100 | ${lines}% |"
done
echo "| rules/ 合计 | $total_rules | 300 | $((total_rules * 100 / 300))% |"

for f in backend/CLAUDE.md frontend/CLAUDE.md; do
  [ -f "$f" ] && lines=$(wc -l < "$f") && echo "| $f | $lines | - | - |"
done
```

输出 Tier 0 总行数和预算占比。如接近 2000 行上限，给出精简建议。
