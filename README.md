# CodeDance

Analyze how a Git repository evolves over time.

Languages: **English** | [简体中文](./README.zh-CN.md)

CodeDance is a local-first repository history analysis toolkit. It scans Git history, detects modules, computes time-series metrics such as LOC, added, deleted, and churn, persists the results, and exposes them through a local API and web UI.

> Joke of the day🤣: which module just hit limit-down? Check the module candlestick chart.

![](/public/imgs/image.png)

## What CodeDance Does

CodeDance is built to answer questions like:

- How does each module grow or shrink over time?
- Which modules accumulate the most churn?
- When did a module split, disappear, or get reorganized?
- How does repository scale change across weeks, days, or commits?

Current focus:

- Analyze Git repository history from a local path
- Detect modules for Rust, Node/Web, and Go repositories
- Compute module-level `loc`, `added`, `deleted`, and `churn`
- Support `weekly`, `daily`, and `per-commit` sampling
- Persist analysis results into local SQLite
- Explore results in a React-based web UI with locale and theme preferences

## Supported Languages

Repository analysis currently supports:

- Rust: workspace / crate structure
- Node.js / Web: workspace / package structure plus fallback heuristics
- Go: module / package structure

Web UI locale currently supports:

- English (`en`)
- Simplified Chinese (`zh-CN`)

## Architecture

The repository is organized as a pnpm monorepo:

```text
apps/
  api/          Local HTTP API for analysis jobs and query endpoints
  web/          Web UI for repository registration, analysis, and charts

packages/
  analyzer/     History analyzers, module detection, sampling logic
  git/          Git access primitives and repository inspection
  storage/      SQLite persistence and query layer
  domain/       Core domain models
  contracts/    Shared API DTOs and schemas
  config/       Analysis configuration helpers
```

Dependency direction:

```text
web -> api -> analyzer -> git
          -> storage
contracts <-> api/web
domain    <-> analyzer/storage
```

## Current Capabilities

- Register a local Git repository from the web UI
- Detect repository kind and modules
- Run Rust, Node/Web, and Go analyzers in one analysis pipeline when applicable
- Run asynchronous history analysis jobs with progress reporting
- Store analysis snapshots and module metrics in SQLite
- Query summaries, modules, series, distributions, and rankings
- Switch the web UI between English and Simplified Chinese
- Switch between `light`, `dark`, and `system` theme modes
- Render repository scale, trend, ranking, stacked/share area, lifecycle, heatmap, bump, scatter, and candlestick views

Module detection currently supports:

- Rust workspace / crate structure
- Node workspace / package structure
- Go module / package structure
- Node/Web fallback heuristics for repositories without workspace config

## Quick Start

Requirements:

- Node.js
- pnpm
- Git available in PATH

Install dependencies:

```bash
pnpm install
```

Start the API:

```bash
pnpm dev:api
```

Start the web app:

```bash
pnpm dev:web
```

Default endpoints:

- API: `http://127.0.0.1:3001`
- Web: `http://127.0.0.1:5173`

Override the API port if needed:

```bash
PORT=3100 pnpm dev:api
```

## Typical Workflow

1. Open the web app.
2. Register a local Git repository by absolute path.
3. Choose a sampling mode such as `weekly`, `daily`, or `per-commit`.
4. Start an analysis job.
5. Inspect module trends, rankings, distribution, and candlestick views.

Results are stored locally in:

```text
.code-dance/code-dance.sqlite
```

## Development

Useful commands:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm dev:api
pnpm dev:web
```

This project analyzes other repositories. The CodeDance repository itself is the implementation of the analyzer, storage, API, and UI layers.

## Documentation

Core docs:

- [Architecture](./docs/design/0.architecture.md)
- [Visualization Views](./docs/design/visual/01-views.md)
- [Web I18n and Theme Design](./docs/design/web/01-i18n-and-theme.md)
- [SQLite Schema](./docs/design/storage/01-sqlite-schema.md)
- [Analyzer Implementation](./packages/analyzer/docs/implementation.md)
- [Analyzer Performance and Concurrency](./packages/analyzer/docs/performance-and-concurrency.md)
- [Initial Roadmap](./docs/roadmap/1.initial-plan.md)
- [Implementation Plan](./docs/roadmap/2.implementation-plan.md)

## Roadmap

Completed:

- Monorepo workspace
- Local API and web UI
- SQLite persistence
- Rust, Node/Web, and Go module detection
- History analysis with sampling-aware result storage
- Progress reporting for asynchronous analysis jobs
- Web locale switch for `en` and `zh-CN`
- Light/dark/system theme preference plumbing

Planned:

- Configurable manual module rules and fallback providers
- Better duplicate-run detection and caching
- More event-oriented history views and semantic polish
- TUI support built on top of the same data interfaces

## License

Apache License 2.0. See [LICENSE](./LICENSE).
