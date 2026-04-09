# 模块规划：Git 与采样

## 模块范围

覆盖以下代码：

- `packages/git`

目标是提供稳定、可复用的 Git 访问原语与采样规划能力，不关心模块归类和展示语义。

## 当前状态

- [x] `listCommits`
- [x] `listFilesAtRevision`
- [x] `readTextFileAtRevision`
- [x] `readNumstatBetweenRevisions`
- [x] `sampleCommits`
- [x] 支持 `weekly`、`daily`、`per-commit`
- [ ] 批量 Git 读取与缓存未完成
- [ ] commit 级并发未完成

## 当前重点

### P0

- [ ] 评估批量 tree / file 读取优化
- [ ] 评估 commit 级并发策略

### P1

- [ ] 明确 rename / move 信息是否需要进入统一读取原语
- [ ] 为大仓库分析补性能基准

## 风险

- 大仓库历史读取性能会直接拖慢 analyzer
- 缺少缓存会放大重复分析成本

## 完成标准

- [ ] 在中大型仓库上保持稳定采样与历史读取
- [ ] 关键 Git 原语具备明确错误语义
- [ ] 性能优化方案不会破坏 analyzer 的调用稳定性
