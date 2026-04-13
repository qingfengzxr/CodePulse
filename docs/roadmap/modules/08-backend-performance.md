# 08. 后端性能优化实施规划

## 对应设计

- 设计文档：[2.backend-performance-optimization.md](/home/zxr/work/github/code-dance/docs/design/2.backend-performance-optimization.md)

## 模块目标

本分册负责把后端性能优化从“问题识别”推进到“可执行改造”。

目标不是一次性重写整套后端，而是按收益排序，优先解决当前最影响体感的问题：

- 运行中分析的错误轮询路径
- 大结果接口的不可控返回
- 详情页首屏请求风暴
- 查询层的全量读取与重复计算
- SQLite 同步读写争用

## 范围

本规划覆盖以下模块的协同改造：

- `apps/api`
- `packages/storage`
- `apps/web`
- 少量涉及 `packages/analyzer` 的进度写入优化

## 非范围

本规划当前不覆盖：

- 更换数据库类型
- 多进程或分布式执行
- 大规模重写 analyzer 指标计算逻辑
- 图表语义层面的调整

## 当前进展

截至 2026-04-13，本模块已经完成第一阶段止血，并完成第二、三、四阶段中的高收益改造项，当前状态为“进行中”。

### 已完成

- 轻量轮询接口已上线：
  - `GET /api/analysis-summaries/:id`
- 首页运行中分析已切到轻量 summary 轮询
- 详情页已改为按需加载，不再首屏请求整套图表数据
- 页面级查询缓存已落地，避免详情页重复请求相同 query
- `ModuleRankingChart` 已改为页面统一驱动，不再组件内自行请求
- `listAnalysisSummaries()` 已去掉 latest snapshot 的 N+1
- 新建分析前的重复完成分析检查已改为定向查询
- `ranking` 已把 `limit` 下推到 SQL
- K 线图已改为按单模块懒加载：
  - `/api/candles` 默认调用要求显式 scope
  - 详情页切换模块时再按 `moduleKey` 请求
  - 页面级缓存按 `analysisId + sampling + moduleKey` 命中
- 失败收尾路径已移除对整份 `getAnalysisResult()` 的依赖
- 模块探测已增加基于仓库 `HEAD` 的进程内缓存
- 热点索引已补齐，覆盖 `analysis_id + snapshot_seq/module_key` 等主要读取路径
- `analysis_jobs` 在状态未变化时不再重复落库更新

### 已验证

- `pnpm --filter @code-dance/contracts typecheck`
- `pnpm --filter @code-dance/web typecheck`
- `pnpm --filter @code-dance/api typecheck`
- `pnpm --filter @code-dance/storage test`
- `pnpm --filter @code-dance/api test`

### 仍在进行中

- `series` / `candles` 的结果体积和查询策略还没有彻底收口
- `candles` 已收紧为单模块优先，但批量 `moduleKeys` / `all=true` 仍保留为兼容过渡路径
- 分析运行过程中的 SQLite 读写争用还没有系统性压低
- 还没基于真实大仓库数据完成 profiling 前后对照

### 下一步

- 继续收紧 `series` / `candles` 的读取范围和默认行为
- 继续把 `series` 的默认查询路径向更显式的模块范围收口
- 进一步压低分析运行过程的高频写入干扰
- 在真实大仓库上完成 profiling、慢查询定位和索引复核

## 当前判断

当前性能问题可以拆成两类：

### 1. 立即止血类

- 停止用重接口做高频轮询
- 避免 `/api/analyses/:id` 在大结果上继续卡 20 多秒后 500
- 降低详情页首次打开时的并发压力

### 2. 结构收口类

- 去掉 N+1
- 减少全量查询
- 把 `ranking`、`series`、`candles` 的读取策略收紧
- 降低分析过程的同步写库成本
- 为模块探测和热点查询增加缓存或索引

## 实施原则

### 1. 先拆职责，再谈提速

当前最严重的问题不是“算法太慢”，而是：

- 轻量进度读取和重结果读取混用了同一接口

因此第一步必须先拆职责，而不是先补索引。

### 2. 先止住错误流量，再优化查询

只要前端还在每秒打 `/api/analyses/:id`，后面很多优化都会被浪费。

### 3. 优先减少工作量，而不是盲目提并发

当前系统瓶颈更像：

- 全量读太多
- 重复读太多
- 同步 SQLite 争用太多

不是“线程不够多”。

### 4. 每一阶段都要能单独上线

每一批改造都应满足：

- 行为兼容
- 风险可控
- 可独立验证
- 即使后续阶段延期，也已经带来明显收益

## 分阶段实施

## Phase 1：轮询止血

状态：已完成

### 目标

- 停止运行中分析对 `/api/analyses/:id` 的高频轮询
- 建立轻量 progress/summary 接口
- 让首页在分析运行期间恢复可用

### 改造项

#### API

- 新增轻量接口，例如：
  - `GET /api/analysis-summaries/:id`
  - 或 `GET /api/analysis-progress/:id`
- 返回内容限定为：
  - `job`
  - `progress`
  - `snapshotCount`
  - `latestSnapshot`

#### Storage

- 提供轻量查询函数
- 不读取 `points`
- 不读取 `candles`
- 不读取完整 `snapshots` 列表

#### Web

- 把运行中任务轮询切到新轻量接口
- 保留现有 UI 行为
- 停止对运行中任务调用 `/api/analyses/:id`

### 完成标准

- 运行中分析时，日志里不再每秒出现 `/api/analyses/:id`
- 首页不会因分析运行而持续 pending
- 大分析结果不再在轮询场景触发 `Invalid string length`

### 风险

- 前端状态模型当前复用了完整 analysis 结果，需要梳理 summary 和 detail 的边界

## Phase 2：详情页按需加载

状态：已完成

### 目标

- 降低详情页首屏请求数
- 避免首屏拉全套图表数据

### 改造项

#### Web

- 详情页拆成“首屏基础数据”和“图表按需数据”
- 首屏只加载：
  - 当前 analysis 的轻量 summary
  - 默认展示图所需的数据
- 切换图表 tab 时再按需加载：
  - `series`
  - `candles`
  - `distribution`
  - `ranking`

#### 状态管理

- 为详情页增加页面级查询缓存
- 避免同一 analysis 同一 metric 重复请求

#### 图表组件

- `ModuleRankingChart` 不再自行重复请求
- 优先复用上层已加载的数据

### 完成标准

- 详情页首次打开时，请求数量明显下降
- 默认图可优先展示
- 切换图表时才触发对应查询

### 风险

- 需要重新梳理 `AnalysisDetailPage` 的状态组织，避免出现加载态混乱

## Phase 3：查询层收口

状态：部分完成

### 目标

- 减少“全量读 + JS 裁剪”
- 去掉最明显的重复计算

### 改造项

#### Ranking

- 把 `limit` 下推到 SQL
- 避免先构建完整 distribution 再 `slice`

#### Series / Candles

- 收紧默认查询策略
- `series` 继续优先支持明确 `moduleKeys`
- `candles` 默认查询改为显式单 `moduleKey`
- K 线图切换模块时再加载对应 `candles`
- 页面级查询缓存按 `analysisId + sampling + moduleKey` 生效
- 为后续 Top N 或聚合视图留接口空间

#### Summary

- 重写 `listAnalysisSummaries()`
- 去掉逐条 `resolveSnapshot()` 的 N+1

#### Duplicate Check

- 新建分析前改为定向查询
- 避免全量拉 summary 列表再 `.find()`

### 完成标准

- `ranking` 不再依赖完整 distribution
- `analysis-summaries` 在分析数量增加后仍能稳定响应
- 新建分析前的判重不再随历史记录线性恶化
- `series` / `candles` 的查询路径进一步收紧

### 风险

- 查询接口行为会更明确，但部分前端假设可能要同步调整

## Phase 4：写入压力与缓存

状态：部分完成

### 目标

- 降低分析运行时对 API 查询的干扰
- 避免模块探测反复全盘扫描

### 改造项

#### Progress Writes

- 减少 `analysis_jobs` 重复写入
- 仅在 `status` 发生变化时更新 job
- 保留 `analysis_progress` 为主要高频写路径

#### Module Detection Cache

- 对模块探测增加缓存
- 建议缓存维度：
  - `repositoryId`
  - `HEAD commit`
  - `detectedKinds`

#### 失败收尾

- 清理失败路径中不必要的整份结果重读

#### 当前结果

- 模块探测缓存已完成
- 失败收尾路径已完成收口
- `analysis_jobs` 无效更新已减少
- analyzer 侧高频进度写入尚未专门治理

### 完成标准

- 分析运行时首页和详情页的抖动下降
- 打开模块页不会反复触发完整仓库扫描

### 风险

- 缓存失效策略需要明确，否则容易出现“HEAD 已变化但结果未刷新”

## Phase 5：索引与验证

状态：未完成

### 目标

- 用真实慢查询来收口索引设计
- 把优化从“静态推断”推进到“有数据支撑”

### 改造项

#### Profiling

- 对以下端点做本地采样和耗时记录：
  - `/api/analysis-summaries`
  - `/api/analyses/:id`
  - `/api/series`
  - `/api/candles`
  - `/api/distribution`
  - `/api/ranking`

#### SQL Plan

- 基于真实数据运行 `EXPLAIN QUERY PLAN`
- 识别热点扫描与排序

#### Indexes

- 按真实读路径补索引，例如：
  - `(analysis_id, snapshot_seq, module_key)`
  - `(analysis_id, module_key, snapshot_seq)`
  - 围绕 ranking/distribution 的 snapshot 定位索引

### 完成标准

- 热点接口具备实际耗时基线
- 索引设计不再只靠源码猜测

### 风险

- 如果没有真实大数据库样本，索引优化很容易偏离实际热点

## 任务拆分

### A. API 服务

- 新增轻量 progress/summary 接口
- 收紧 `/api/analyses/:id` 的职责
- 调整失败路径与查重路径

### B. 存储层

- 增加轻量 summary 查询函数
- 去掉 `listAnalysisSummaries()` N+1
- 改写 ranking 查询
- 配合后续 profiling 补索引

### C. Web 工作台

- 切换首页轮询接口
- 拆分 summary 与 detail 的状态边界

### D. Web 详情页

- 改成按需加载
- 去掉首屏全套请求
- 去掉排行图重复请求

### E. Analyzer / 进度写入

- 降低重复写库
- 校正高频进度持久化路径

## 推荐提交顺序

建议按以下 PR 顺序推进：

1. 轻量 progress/summary 接口 + 首页轮询切换
2. 详情页按需加载 + 排行图去重请求
3. `ranking` / `analysis-summaries` / 查重查询优化
4. 写库频率优化 + 模块探测缓存
5. profiling + 索引调整

这样做的好处是：

- 第一批就能明显止血
- 中间每一批都能单独验收
- 后面的索引优化能建立在更合理的流量形状之上

## 验收指标

建议至少记录以下指标作为阶段验收：

### 用户体感指标

- 打开首页时是否还出现长时间无响应
- 分析运行中首页是否仍持续卡顿
- 打开详情页首屏是否明显比之前更快

### 接口指标

- `/api/analyses/:id` 是否还被高频轮询
- `/api/analysis-summaries` 耗时是否保持稳定
- 详情页首屏请求数是否下降

### 稳定性指标

- 是否还出现 `Invalid string length`
- 是否还出现长时间 pending 后 500

## 当前待办

- [x] 定义轻量 progress/summary DTO
- [x] 在 `packages/storage` 增加轻量查询
- [x] 在 `apps/api` 暴露轻量接口
- [x] 在 `apps/web` 切换首页轮询
- [x] 拆分详情页首屏与按需数据加载
- [x] 移除排行图重复请求
- [x] 重写 `listAnalysisSummaries()` 避免 N+1
- [x] 把 `ranking` 的 `limit` 下推到 SQL
- [ ] 继续减少进度写库频率
- [x] 设计模块探测缓存
- [ ] 准备真实数据样本做 profiling
- [ ] 继续收紧 `series` 查询范围
- [ ] 基于 profiling 结果复核索引和慢查询

## 完成定义

以下条件全部满足，才视为本轮后端性能优化阶段完成：

- [x] 运行中分析不再高频请求 `/api/analyses/:id`
- [x] 大分析结果不会在轮询场景触发 `500`
- [x] 详情页首屏不再并发拉全套图表数据
- [x] `ranking` 不再通过全量 distribution 再裁剪
- [x] `analysis-summaries` 去掉 N+1
- [ ] 至少完成一轮基于真实数据的 profiling 与索引复核

## 当前结论

这轮性能治理已经完成“止血”和“高收益查询治理”，当前剩余工作主要集中在两块：

- 更深层的 `series` 读取收口，以及 `candles` 过渡兼容路径的后续清理
- 基于真实大仓库数据的 profiling 与进一步索引复核

## 本次子任务进展

### 已确认现状

- 详情页此前已经做到“按图表懒加载”，但 K 线仍是 tab 激活后一次请求默认模块集合
- 模块切换此前只是在前端已加载的 `candles.series` 中切换，没有单模块请求边界

### 已锁定方案

- 采用“最小闭环”：
  - 保留 `moduleKeys` / `all=true` 兼容能力
  - 默认 UI 路径改为单 `moduleKey` 请求
  - 服务端对无 `all/moduleKey/moduleKeys` 的 `candles` 请求返回 `400`

### 已完成开发

- `apps/web` 已为 K 线引入独立 `selectedCandlesModuleKey`
- `AnalysisDetailPage` 已改为仅请求当前选中模块的 `candles`
- `ModuleCandlestickChart` 已改成受控组件，模块切换时按需触发单模块加载
- `apps/api` / `packages/storage` 已支持 `moduleKey` 查询，并对单模块路径走更窄的读取分支

### 验证标准

- 首次进入 K 线 tab 只请求当前默认模块的 1 次 `candles`
- 切换模块时只新增当前模块的 1 次请求
- 切回已访问模块时命中页面缓存，不重复请求
- 缺少 `all/moduleKey/moduleKeys` 的 `GET /api/candles` 请求返回 `400`
