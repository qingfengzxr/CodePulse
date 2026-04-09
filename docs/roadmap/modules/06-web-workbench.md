# 模块规划：Web 工作台

## 模块范围

覆盖以下代码：

- `apps/web`

目标是把现有可视化页面整理为可持续扩展的工作台，而不是持续堆叠图表与文案。

## 当前状态

- [x] 仓库注册页面
- [x] 分析任务发起入口
- [x] 任务列表
- [x] 分析详情页
- [x] 模块趋势图
- [x] 模块堆叠面积图
- [x] 模块排行图
- [x] 模块推导区间图
- [x] 热力图与 Bump Chart
- [x] 进度条与采样切换
- [ ] 独立的 `added/deleted` 柱状图
- [ ] Web 多语言支持
- [ ] Web 明暗模式切换
- [ ] 图表主题令牌同步
- [ ] 语义审查问题尚未全部修正

## 当前重点

### P0

- [ ] 修正图表语义与文案不一致问题
- [ ] 建立 i18n message key 与 locale 层
- [ ] 建立 theme token 与 `data-theme` 机制

### P1

- [ ] 让 ECharts 消费同一套主题令牌
- [ ] 补独立 `added/deleted` 视图
- [ ] 收敛 badge、summary、tooltip 与当前指标的一致性

## 依赖文档

- [可视化视图设计](/home/zxr/work/github/code-dance/docs/design/visual/01-views.md)
- [图表语义审查记录](/home/zxr/work/github/code-dance/docs/design/visual/02-semantics-review.md)
- [Web 多语言与明暗模式设计](/home/zxr/work/github/code-dance/docs/design/web/01-i18n-and-theme.md)

## 风险

- 继续在组件里写死文案，会让多语言接入失控
- 页面主题和图表主题不同步，会产生明显半成品体验
- 图表语义不闭合会直接损害展示可信度

## 完成标准

- [ ] 核心工作流支持 `zh-CN` 与 `en`
- [ ] 页面支持 `light`、`dark`、`system`
- [ ] 页面与图表在不同主题下保持一致可读性
- [ ] 语义审查中的高优先级问题完成修正
