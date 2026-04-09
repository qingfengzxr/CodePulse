# 模块规划：分析器与 Provider

## 模块范围

覆盖以下代码：

- `packages/analyzer`

目标是把 Git 历史、模块识别规则和指标计算组织成统一分析入口，并支持多语言仓库扩展。

## 当前状态

- [x] 已有统一 `analyzeRepositoryHistory` 入口
- [x] 已支持 Rust workspace / crate
- [x] 已支持 Node workspace / package
- [x] 已有 Node/Web 启发式 fallback
- [ ] `ManualConfigProvider` 未完成
- [ ] `PathPrefixProvider` 未完成
- [ ] provider 链优先级尚未完整配置化

## 当前重点

### P0

- [ ] 实现 `ManualConfigProvider`
- [ ] 实现 `PathPrefixProvider`
- [ ] 把当前 Node/Web fallback 收敛进统一 provider 链

### P1

- [ ] 定义 provider 链优先级和覆盖规则
- [ ] 让手工规则真正覆盖自动识别结果

## 风险

- 当前模块识别仍部分依赖工程约定，扩展性不足
- provider 链不完整会让配置能力停留在文档层

## 完成标准

- [ ] provider 链完全由配置驱动
- [ ] 手工规则能覆盖自动识别结果
- [ ] Rust 与 Node/Web 现有能力在新链路下不回退
