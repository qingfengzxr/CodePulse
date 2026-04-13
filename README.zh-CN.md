# CodeDance

分析 Git 仓库如何随时间演化。

语言版本：[English](./README.md) | **简体中文**

CodeDance 是一个本地优先的仓库历史分析工具。它会扫描 Git 历史、识别模块、计算 `LOC`、`added`、`deleted`、`churn` 等时间序列指标，把结果持久化到本地，再通过本地 API 和 Web UI 展示出来。

> 讲个笑话🤣：你的哪个模块跌停了？看看模块K线图吧！

![](/public/imgs/image.png)

## 项目目标

CodeDance 主要回答这类问题：

- 某个模块是如何逐步增长或收缩的？
- 哪些模块长期 churn 最高？
- 某个模块是什么时候拆分、消失或重组的？
- 仓库规模在按周、按日、按 commit 维度上如何变化？

当前重点能力：

- 从本地路径分析 Git 仓库历史
- 识别 Rust、Node/Web、Go 仓库的模块
- 生成模块级 `loc`、`added`、`deleted`、`churn`
- 支持 `weekly`、`daily`、`per-commit` 三种采样方式
- 将分析结果持久化到本地 SQLite
- 在 React Web 页面中查看结果，并支持语言与主题偏好

## 支持语言

当前仓库分析能力支持：

- Rust：workspace / crate 结构
- Node.js / Web：workspace / package 结构，以及无 workspace 时的 fallback 启发式识别
- Go：module / package 结构

当前 Web 界面语言支持：

- English (`en`)
- 简体中文 (`zh-CN`)

## 架构概览

当前仓库是一个 pnpm monorepo：

```text
apps/
  api/          本地 HTTP API，负责分析任务与查询接口
  web/          Web UI，负责仓库注册、分析发起和图表展示

packages/
  analyzer/     历史分析器、模块探测、采样逻辑
  git/          Git 读取原语与仓库探测
  storage/      SQLite 持久化与查询层
  domain/       核心领域模型
  contracts/    API DTO 与共享 schema
  config/       分析配置辅助
```

依赖方向：

```text
web -> api -> analyzer -> git
          -> storage
contracts <-> api/web
domain    <-> analyzer/storage
```

## 当前能力

- 在 Web 页面中注册本地 Git 仓库
- 探测仓库类型和模块结构
- 在同一条分析链路中按需组合运行 Rust、Node/Web、Go 分析器
- 异步执行历史分析任务，并实时显示进度
- 将分析结果写入 SQLite
- 查询分析摘要、模块列表、趋势序列、分布和排行
- 支持中英文界面切换
- 支持 `light`、`dark`、`system` 主题模式
- 展示仓库规模、趋势、排行、堆叠/占比面积、生命周期、热力、Bump、风险散点与 K 线等视图

当前模块识别支持：

- Rust workspace / crate
- Node workspace / package
- Go module / package
- 对没有 workspace 配置的 Node/Web 仓库使用启发式 fallback 规则

## 快速启动

环境要求：

- Node.js
- pnpm
- Git 可执行文件在 PATH 中

安装依赖：

```bash
pnpm install
```

启动 API：

```bash
pnpm dev:api
```

启动 Web：

```bash
pnpm dev:web
```

默认地址：

- API: `http://127.0.0.1:3001`
- Web: `http://127.0.0.1:5173`

如需修改 API 端口：

```bash
PORT=3100 pnpm dev:api
```

## 使用流程

1. 打开 Web 页面。
2. 输入本地 Git 仓库绝对路径并注册仓库。
3. 选择采样方式，例如 `weekly`、`daily`、`per-commit`。
4. 发起分析任务。
5. 查看模块趋势、排行、分布和 K 线图等结果。

分析结果默认保存在：

```text
.code-dance/code-dance.sqlite
```

## 开发命令

常用命令：

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm dev:api
pnpm dev:web
```

这个仓库本身不是被分析对象，而是分析器、存储层、API 和前端展示层的实现仓库。

## 文档

核心文档：

- [总体架构](./docs/design/0.architecture.md)
- [可视化视图设计](./docs/design/visual/01-views.md)
- [Web 多语言与主题设计](./docs/design/web/01-i18n-and-theme.md)
- [SQLite Schema](./docs/design/storage/01-sqlite-schema.md)
- [Analyzer 实现说明](./packages/analyzer/docs/implementation.md)
- [Analyzer 性能与并发设计](./packages/analyzer/docs/performance-and-concurrency.md)
- [初始路线图](./docs/roadmap/1.initial-plan.md)
- [详细实现规划](./docs/roadmap/2.implementation-plan.md)

## 路线图

已完成：

- monorepo 工作区骨架
- 本地 API 与 Web UI
- SQLite 持久化
- Rust、Node/Web、Go 模块探测
- 支持多种采样维度的历史分析
- 异步分析任务与进度展示
- `en` / `zh-CN` Web 多语言切换
- `light` / `dark` / `system` 主题偏好基础能力

计划中：

- 可配置的手工模块规则与 fallback provider
- 更好的重复分析检测与缓存
- 更丰富的事件型历史视图与图表语义打磨
- 基于同一套数据接口的 TUI

## 许可证

Apache License 2.0，见 [LICENSE](./LICENSE)。
