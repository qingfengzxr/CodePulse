# 模块规划：共享核心

## 模块范围

覆盖以下代码：

- `packages/domain`
- `packages/contracts`
- `packages/config`

目标是稳定核心概念、共享类型和配置模型，为 analyzer、storage、api、web、tui 提供统一基础。

## 当前状态

- [x] 已有基础领域模型
- [x] 已有 API DTO 与共享契约
- [x] 已有分析配置基础结构
- [ ] 手工模块规则 schema 仍未完整驱动 provider 链
- [ ] 错误码与前端本地化友好的错误结构仍不完整

## 当前重点

### P0

- [ ] 明确手工模块规则 schema
- [ ] 明确 provider 链配置模型
- [ ] 为 API 错误补稳定 `code`

### P1

- [ ] 为 Web 多语言补稳定枚举和值对象
- [ ] 收敛 repository / analysis / snapshot 的状态字段语义

## 风险

- `config` 不稳定会直接阻塞 analyzer provider 链
- `contracts` 中错误结构不稳定会阻塞 Web 本地化

## 完成标准

- [ ] 手工模块规则可通过共享 schema 表达
- [ ] API 与前端共享的错误结构具备稳定 `code`
- [ ] domain / contracts / config 的变更不会导致下游重复定义同一概念
