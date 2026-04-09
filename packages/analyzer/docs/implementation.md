# Analyzer 实现说明

## 目标

- 每种语言的 analyzer 都放在独立目录下，统一位于 `src/languages/<language>/`。
- 仓库模块探测与历史分析分离，避免职责混杂。
- 通过 `src/index.ts` 对外暴露稳定的包级 API，内部结构调整不影响调用方。

## 当前目录结构

- `src/languages/rust/`
  - `history-analyzer.ts`：Rust 历史分析实现。
  - `index.ts`：Rust analyzer 对外导出入口。
- `src/modules/`
  - `detect-repository-modules.ts`：模块探测总入口。
  - `providers/`：按生态拆分的模块探测 provider。

## 设计约束

1. `packages/git` 负责 Git 和文件系统原语。
   这一层只提供底层能力，例如按 revision 读取文件、列出文件、读取 diff stat 等。

2. `packages/analyzer` 负责分析策略。
   每个语言 analyzer 负责组织 commit 采样、模块识别、LOC 统计、diff 归因以及指标输出。

3. `apps/api` 只负责 HTTP 接线。
   API 层不应承载任何语言专属的分析逻辑。

## 新增语言 Analyzer 的方式

1. 新建目录 `src/languages/<language>/`。
2. 在目录内添加该语言的历史分析入口，例如 `history-analyzer.ts`。
3. 在该目录内添加 `index.ts`，只导出对外公开的类型和函数。
4. 如果该语言需要独立的模块探测逻辑，则在 `src/modules/providers/` 下增加对应 provider。
5. 最后在 `src/index.ts` 中统一重新导出。

## Node/Web 支持的建议拆分

### 模块探测

- 优先从 `package.json`、workspace package、`apps/*`、`packages/*` 这类约定目录中识别模块。
- 模块 key 应保持稳定，例如 `node:package:web`。

### 文件覆盖范围

- 建议统计以下扩展名：
  - `.ts`
  - `.tsx`
  - `.js`
  - `.jsx`
  - `.mjs`
  - `.cjs`
  - `.html`
  - `.css`

### 指标生成

- 尽量复用 Rust analyzer 已验证过的 commit 采样和 diff stat 流程。
- 按文件路径前缀将 diff 行归因到对应模块。
- 输出结构保持与当前 storage 和图表使用的 `snapshots`、`points` 一致。

## 当前采样维度

当前 analyzer 已支持以下采样粒度：

- `weekly`
- `daily`
- `per-commit`

约束说明：

- `weekly`、`daily` 仍按时间桶做采样。
- `per-commit` 不再做时间桶折叠，而是保留主线历史上的每一个 commit。
- 不同采样粒度会生成不同的 analysis job，需要分别分析、分别保存。
- 统一入口、API 与前端都以 `sampling` 作为分析结果的重要维度，而不是默认只有 `weekly` 一种模式。

## 性能优化文档

- 并发分析与性能优化的设计说明已拆分到独立文档：[performance-and-concurrency.md](./performance-and-concurrency.md)。
- 实现文档只保留总体结构与职责边界，避免混入过多专项优化细节。

## 下一步建议的重构

- `analyzeRepositoryHistory` 已作为包级统一入口存在，负责协调多个语言 analyzer。
- API 层已经依赖统一入口，而不是直接绑定某一种语言 analyzer。
- 当前统一入口已支持在单个 analysis job 中聚合 `rust` 与 `node` analyzer 结果。
- 混合仓库默认合并为一份 `snapshots + points` 结果，而不是拆分为多个 job。
- 若任一语言 analyzer 失败，整个 analysis job 失败，避免部分结果落库后产生解释歧义。
- 聚合阶段会严格校验各 analyzer 的 snapshot 时间线是否一致；若 commit 或时间戳不一致，会直接报错。
- 后续新增语言时，优先接入统一入口的聚合链路，而不是回退到单语言分发逻辑。

## 前端体现

- 工作台顶部提供采样维度切换按钮，当前支持 `Weekly`、`Daily`、`Per Commit`。
- 仓库卡片只展示当前所选采样维度下的分析任务状态与结果摘要。
- 详情页会显示当前 analysis 的采样维度，并允许在同仓库已有的不同采样维度结果之间切换。
