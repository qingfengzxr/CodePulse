# 模块规划：API 服务

## 模块范围

覆盖以下代码：

- `apps/api`

目标是为分析任务和查询能力提供统一入口，并保持展示层无关。

## 当前状态

- [x] `POST /api/analyses`
- [x] `GET /api/analyses`
- [x] `GET /api/analyses/:id`
- [x] `GET /api/analysis-summaries`
- [x] `GET /api/modules`
- [x] `GET /api/series`
- [x] `GET /api/distribution`
- [x] `GET /api/ranking`
- [x] `POST /api/repositories`
- [x] `GET /api/repositories`
- [x] `GET /api/repositories/:id/modules`
- [x] `DELETE /api/repositories/:id`
- [ ] `GET /api/events/:analysisId`
- [ ] 错误码体系不完整

## 当前重点

### P0

- [ ] 明确错误结构中的稳定 `code`
- [ ] 设计事件流接口或替代进度推送机制

### P1

- [ ] 为 Web 多语言与主题扩展补更稳定的元数据支持
- [ ] 评估 TUI 所需最小查询集

## 风险

- 错误结构不稳定会拖累 Web 本地化
- 只有轮询会限制更好的任务体验

## 完成标准

- [ ] API 契约保持展示层无关
- [ ] 常见失败场景具备稳定错误码
- [ ] 长任务除轮询外具备可扩展的事件流方案
