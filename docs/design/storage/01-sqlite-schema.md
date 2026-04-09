# 2. 存储设计：SQLite Schema

> 版本：v0.1
> 更新时间：2026-04-09
> 变更摘要：根据当前 `packages/storage` 实现补充第一阶段实际落地表结构

## 1. 文档目标

本文档记录 `code-dance` 第一阶段当前已经落地的 SQLite schema，用于回答以下问题：

- 当前有哪些表
- 每张表保存什么信息
- 主键和索引如何设计
- 查询接口主要依赖哪些表

本文档描述的是“当前实现”，而不是早期草案。

代码准确信源位于 [packages/storage/src/index.ts](/home/zxr/work/github/code-dance/packages/storage/src/index.ts)。

## 2. 设计背景

第一阶段采用 SQLite 作为本地持久化层，原因是：

- 本地单机工具部署成本低
- 足以支撑当前查询型 API
- 同一份存储可被 Web 和未来 TUI 复用

当前分析模型不是按文件或 commit 明细直接查询，而是先把分析结果汇总后落库，再由 API 做查询拼装。

当前核心统计粒度是：

- 时间粒度：按周采样
- 模块粒度：Rust crate 级技术模块
- 指标粒度：每个采样点、每个模块一条指标记录

## 3. 表一览

当前实际落地 6 张表：

1. `repository_targets`
2. `analysis_jobs`
3. `analysis_progress`
4. `snapshots`
5. `analysis_modules`
6. `module_metrics`

可以把它们分成三层：

- 仓库层：`repository_targets`
- 任务层：`analysis_jobs`、`analysis_progress`
- 结果层：`snapshots`、`analysis_modules`、`module_metrics`

## 4. 详细表结构

### 4.1 `repository_targets`

用途：记录用户注册的待分析仓库。

字段：

- `id text primary key`
- `name text not null`
- `source_type text not null`
- `local_path text`
- `remote_url text`
- `default_branch text`
- `detected_kinds text not null`
- `status text not null`
- `created_at text not null`

说明：

- 当前主要使用 `local-path` 类型仓库
- `detected_kinds` 使用 JSON 字符串保存，例如 `["rust"]`
- `status` 表示仓库注册后的当前状态，例如 `ready`

### 4.2 `analysis_jobs`

用途：记录一次分析任务的元数据和生命周期状态。

字段：

- `id text primary key`
- `repository_id text not null`
- `branch text not null`
- `sampling text not null`
- `status text not null`
- `created_at text not null`
- `finished_at text`
- `error_message text`

说明：

- 一条记录对应一次分析任务
- `repository_id` 对应 `repository_targets.id`
- 当前默认采样策略是 `weekly`
- `status` 用于表达 `pending`、`running`、`done`、`failed`

### 4.3 `analysis_progress`

用途：记录长任务的运行态进度信息。

字段：

- `analysis_id text primary key`
- `phase text not null`
- `percent real not null`
- `total_commits integer not null`
- `sampled_commits integer not null`
- `completed_snapshots integer not null`
- `current_commit text`
- `current_module text`
- `current_files integer`
- `processed_files integer`
- `eta_seconds integer`
- `started_at text not null`
- `updated_at text not null`

说明：

- 当前前端进度条主要依赖这张表
- 设计目标不是只存一个百分比，而是尽量保存可解释的运行上下文
- 当进度记录不存在时，服务层会根据任务状态构造兜底进度对象

### 4.4 `snapshots`

用途：记录某次分析的采样时间轴。

字段：

- `analysis_id text not null`
- `seq integer not null`
- `commit_hash text not null`
- `ts text not null`

主键：

- `(analysis_id, seq)`

说明：

- 一次分析有多个采样点
- `seq` 是同一次分析内部的顺序编号，从早到晚递增
- `ts` 是采样点对应的提交时间

### 4.5 `analysis_modules`

用途：记录某次分析识别出的模块集合。

字段：

- `analysis_id text not null`
- `module_key text not null`
- `module_name text not null`
- `module_kind text not null`

主键：

- `(analysis_id, module_key)`

说明：

- 它是分析结果范围内的模块维表
- 当前主要保存 Rust crate 模块
- `module_key` 是稳定标识，例如 `rust:crate:core`

### 4.6 `module_metrics`

用途：记录每个采样点、每个模块的汇总指标，是当前最核心的事实表。

字段：

- `analysis_id text not null`
- `snapshot_seq integer not null`
- `ts text not null`
- `commit_hash text not null`
- `module_key text not null`
- `module_name text not null`
- `module_kind text not null`
- `loc integer not null`
- `added integer not null`
- `deleted integer not null`
- `churn integer not null`

主键：

- `(analysis_id, snapshot_seq, module_key)`

说明：

- 每条记录对应“某次分析 + 某个采样点 + 某个模块”
- `loc` 是当前采样点的模块总代码行数
- `added`、`deleted`、`churn` 是相邻采样点之间的变化量
- 这里冗余保存了 `ts`、`commit_hash`、`module_name`、`module_kind`
  目的是减少查询拼接复杂度，提升读路径简单性

## 5. 索引设计

当前实现包含 3 个索引：

- `idx_analysis_jobs_created_at on analysis_jobs (created_at desc)`
- `idx_snapshots_analysis_seq on snapshots (analysis_id, seq)`
- `idx_module_metrics_analysis_ts on module_metrics (analysis_id, ts, module_key)`

用途：

- `analysis_jobs` 按创建时间倒序查询任务列表
- `snapshots` 支持按分析任务读取时间轴和最新采样点
- `module_metrics` 支持按分析任务和时间序列读取模块指标

## 6. 表关系与读写路径

逻辑关系如下：

```text
repository_targets (1) -> (n) analysis_jobs
analysis_jobs (1) -> (1) analysis_progress
analysis_jobs (1) -> (n) snapshots
analysis_jobs (1) -> (n) analysis_modules
analysis_jobs (1) -> (n) module_metrics
snapshots (1) -> (n) module_metrics   # 通过 analysis_id + snapshot_seq 逻辑关联
analysis_modules (1) -> (n) module_metrics   # 通过 analysis_id + module_key 逻辑关联
```

当前实现没有在 SQLite 层显式声明外键约束，而是由应用层控制写入顺序和一致性。

主要写路径：

1. 注册仓库时写入 `repository_targets`
2. 创建分析任务时写入 `analysis_jobs`
3. 任务执行过程中持续 upsert `analysis_progress`
4. 分析完成后批量替换该任务的 `snapshots`、`analysis_modules`、`module_metrics`
5. 任务完成或失败后更新 `analysis_jobs.status` 和 `finished_at`

## 7. 查询接口如何使用这些表

当前查询型 API 主要依赖以下读法：

- `GET /api/analyses`
  - 主要读 `analysis_jobs`
- `GET /api/analyses/:id`
  - 读 `analysis_jobs`、`analysis_progress`、`snapshots`、`module_metrics`
- `GET /api/analysis-summaries`
  - 基于 `analysis_jobs`、`snapshots`、`module_metrics` 聚合摘要
- `GET /api/modules`
  - 读 `analysis_modules`
- `GET /api/series`
  - 读 `snapshots` 和 `module_metrics`
- `GET /api/distribution`
  - 基于指定采样点读 `module_metrics`
- `GET /api/ranking`
  - 基于指定采样点读 `module_metrics` 并排序截断

这也是为什么当前 schema 更偏“查询友好型汇总表”，而不是严格三范式建模。

## 8. 与早期设计稿的差异

总体架构文档的早期版本中，曾使用过更粗粒度的逻辑命名，例如：

- `analysis_targets`
- `module_definitions`

当前实现已经演化为：

- `repository_targets`
- `analysis_modules`
- 新增 `analysis_progress`

此外，当前 `module_metrics` 也比早期草案多保存了：

- `ts`
- `commit_hash`
- `module_name`
- `module_kind`

这些冗余字段是有意的，目的是让查询接口和图表装配更简单。

## 9. 当前限制

当前 schema 仍然有几个明确限制：

- 主要围绕 Rust crate 级模块构建
- 没有文件级明细事实表
- 没有 commit 级事件流表
- 没有结果缓存命中表或重复执行检测表
- 没有显式的展示模块分组映射表

这与当前第一阶段范围一致，不属于实现缺陷。

## 10. 后续演进建议

后续如果要扩大能力，优先考虑以下扩展方向：

1. 增加事件流或 commit 明细表，支持更细粒度变更分析
2. 增加模块分组映射表，区分技术模块与展示模块
3. 增加缓存键与结果复用表，避免重复分析
4. 视需要补充外键约束和迁移机制

在没有这些需求前，保持当前 schema 简单直接更合适。
