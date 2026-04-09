# Code Dance

`code-dance` 是一个用于分析其他 Git 代码仓库历史演化的工具。本仓库本身不是被分析对象，而是分析器、查询服务和展示层的实现仓库。

当前目标是围绕“模块代码量如何随时间变化”构建一套可扩展的分析系统，重点支持：

- 按模块统计历史 `LOC`
- 统计新增、删除、`churn`
- 通过 Web 页面展示折线图、柱状图等视图
- 后续复用同一套数据层与服务层支持 TUI

## 目录导航

```text
code-dance/
  README.md
  docs/
    design/
    roadmap/
    discuss/
  vibe/
```

各目录职责如下：

- `README.md`
  - 全局导航
  - 说明项目目标
  - 说明目录规则
  - 记录快速启动方式
- `docs/design/`
  - 存放设计文档
  - 顶层文件用于总体设计或跨模块设计
  - 子目录用于按主题拆分设计文档，例如 `visual/`、`storage/`
  - 各主题目录内使用简单序号命名，例如 `01-views.md`、`01-sqlite-schema.md`
  - 重要总设计文档建议在文档头部维护版本号、更新时间和变更摘要
- `docs/roadmap/`
  - 存放实现路径、阶段计划、开发推进文档
  - 使用序号编排编号
  - 推荐命名格式：`1.xxx-plan.md`、`2.xxx-plan.md`
  - 开发进度统一使用 Markdown checkbox 表示：`- [ ]`、`- [x]`
- `docs/discuss/`
  - 存放重要讨论的沉淀文档
  - 使用序号编排编号
  - 适合记录方案取舍、设计争议、阶段性结论
- `vibe/`
  - 存放 vibe-coding 相关规范、协作约定、工作流规则

## 文档管理规则

### 设计文档

- 总体设计优先放在 `docs/design/` 顶层，例如 `0.architecture.md`
- 专题设计按主题拆到 `docs/design/<topic>/`，例如 `docs/design/storage/`、`docs/design/visual/`
- 主题目录内优先使用简单文件名规则，例如 `01-views.md`、`02-query-api.md`
- 设计文档应尽量描述目标、边界、结构、数据模型、接口与风险

### 路线图文档

- 路线图与计划统一放在 `docs/roadmap/`
- 每份计划文档都应可跟踪进度
- 任务状态统一使用：
  - `- [ ]` 未完成
  - `- [x]` 已完成

### 讨论文档

- 重要讨论不要散落在聊天记录中
- 形成结论后应沉淀到 `docs/discuss/`
- 讨论文档应重点记录背景、分歧点、结论与后续动作

## 当前已整理文档

- [总体架构设计](/home/zxr/work/github/code-dance/docs/design/0.architecture.md)
- [可视化视图设计](/home/zxr/work/github/code-dance/docs/design/visual/01-views.md)
- [SQLite 存储结构设计](/home/zxr/work/github/code-dance/docs/design/storage/01-sqlite-schema.md)
- [初始实现路线图](/home/zxr/work/github/code-dance/docs/roadmap/1.initial-plan.md)
- [详细实现规划](/home/zxr/work/github/code-dance/docs/roadmap/2.implementation-plan.md)

## 快速启动

当前仓库已经有第一轮工程骨架，可以启动最小 API 与 Web 开发环境。

1. 阅读 [总体架构设计](/home/zxr/work/github/code-dance/docs/design/0.architecture.md)
2. 阅读 [初始实现路线图](/home/zxr/work/github/code-dance/docs/roadmap/1.initial-plan.md)
3. 阅读 [详细实现规划](/home/zxr/work/github/code-dance/docs/roadmap/2.implementation-plan.md)
4. 安装依赖：`pnpm install`
5. 启动 API：`pnpm dev:api`
6. 启动 Web：`pnpm dev:web`

默认端口：

- API: `http://127.0.0.1:3001`
- Web: `http://127.0.0.1:5173`

如需修改 API 端口，可在启动时覆盖：

- `PORT=3100 pnpm dev:api`

当前最小可用能力：

- Web 页面可输入本地 Git 仓库绝对路径
- API 会校验目录是否存在、是否为 Git 仓库
- API 会返回仓库名、默认分支以及基础语言探测结果
- 当前已接通仓库注册与仓库列表查询
- 对 Rust 仓库可探测 workspace / crate 模块
- 可对 Rust 仓库按周采样并生成 crate LOC 时间序列
- 分析结果会持久化到本地 SQLite：`.code-dance/code-dance.sqlite`
- API 已提供 `analysis-summaries`、`modules`、`series`、`distribution`、`ranking` 等查询接口
- Web 页面可展示总量趋势、堆叠面积图、模块排行、模块趋势图和 crate/LOC K 线图
- 分析任务采用异步执行，前端可显示基于采样点和文件处理进度的真实进度条

当前前端技术约定：

- 页面框架使用 React + Vite
- 图表统一使用 ECharts

## 当前阶段重点

当前优先级是：

- 建立 monorepo 基础结构
- 先实现 Rust 仓库的模块识别
- 打通分析层、存储层和 Web 展示链路

## 当前实现状态

已完成：

- monorepo 工作区骨架
- `apps/api` 最小 Fastify 服务
- `apps/web` React + Vite 页面
- `packages/domain`、`packages/contracts`、`packages/config`
- `packages/git` 中本地 Git 仓库校验、采样与历史读取
- `packages/analyzer` 中 Rust workspace / crate 模块探测与历史分析
- SQLite 持久化与 DAO 层
- 本地路径注册仓库接口
- 仓库模块探测接口
- 查询型 API：`analysis-summaries`、`modules`、`series`、`distribution`、`ranking`
- 基于 ECharts 的 crate LOC 折线图
- 基于 ECharts 的模块堆叠面积图、排行图
- 基于 ECharts 的 crate/LOC K 线图
- 异步分析任务与进度轮询

待完成：

- 默认 `first-parent` 主线采样
- 手工模块配置与 fallback provider
- 结果缓存 / 重复执行检测
- 独立的 `added / deleted` 柱状图与事件流接口
- TUI 首版能力

## 约定

- 设计、路线图、讨论文档默认使用中文
- 目录规则以本文件为准
- 后续如新增顶层目录，应先在本文件补充说明
