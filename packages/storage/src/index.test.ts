import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type {
  AnalysisJob,
  AnalysisProgress,
  MetricPoint,
  ModuleCandlePoint,
  RepositoryTarget,
  Snapshot,
} from "@code-dance/domain";

import { createSqliteStorage } from "./index.js";

async function withStorage(fn: (input: ReturnType<typeof createSqliteStorage>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-storage-test-"));
  const storage = createSqliteStorage({ dbPath: join(dir, "test.sqlite") });

  try {
    await fn(storage);
  } finally {
    storage.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function createRepository(overrides: Partial<RepositoryTarget> = {}): RepositoryTarget {
  return {
    id: "repo-1",
    name: "demo",
    sourceType: "local-path",
    localPath: "/tmp/demo",
    remoteUrl: null,
    defaultBranch: "main",
    detectedKinds: ["rust"],
    status: "ready",
    createdAt: "2026-04-09T10:00:00.000Z",
    ...overrides,
  };
}

function createJob(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    id: "analysis-1",
    repositoryId: "repo-1",
    branch: "main",
    sampling: "weekly",
    status: "pending",
    createdAt: "2026-04-09T10:05:00.000Z",
    finishedAt: null,
    errorMessage: null,
    ...overrides,
  };
}

function createProgress(overrides: Partial<AnalysisProgress> = {}): AnalysisProgress {
  return {
    phase: "pending",
    percent: 0,
    totalCommits: 0,
    sampledCommits: 0,
    completedSnapshots: 0,
    currentCommit: null,
    currentModule: null,
    currentFiles: null,
    processedFiles: null,
    etaSeconds: null,
    startedAt: "2026-04-09T10:05:00.000Z",
    updatedAt: "2026-04-09T10:05:00.000Z",
    ...overrides,
  };
}

function createSnapshots(analysisId = "analysis-1"): Snapshot[] {
  return [
    { analysisId, commit: "aaa111", ts: "2026-04-01T00:00:00.000Z" },
    { analysisId, commit: "bbb222", ts: "2026-04-08T00:00:00.000Z" },
  ];
}

function createPoints(analysisId = "analysis-1"): MetricPoint[] {
  return [
    {
      analysisId,
      ts: "2026-04-01T00:00:00.000Z",
      commit: "aaa111",
      moduleKey: "rust:crate:core",
      moduleName: "core",
      moduleKind: "rust-crate",
      loc: 10,
      added: 10,
      deleted: 0,
      churn: 10,
    },
    {
      analysisId,
      ts: "2026-04-01T00:00:00.000Z",
      commit: "aaa111",
      moduleKey: "rust:crate:web",
      moduleName: "web",
      moduleKind: "rust-crate",
      loc: 4,
      added: 4,
      deleted: 0,
      churn: 4,
    },
    {
      analysisId,
      ts: "2026-04-08T00:00:00.000Z",
      commit: "bbb222",
      moduleKey: "rust:crate:core",
      moduleName: "core",
      moduleKind: "rust-crate",
      loc: 14,
      added: 5,
      deleted: 1,
      churn: 6,
    },
    {
      analysisId,
      ts: "2026-04-08T00:00:00.000Z",
      commit: "bbb222",
      moduleKey: "rust:crate:web",
      moduleName: "web",
      moduleKind: "rust-crate",
      loc: 6,
      added: 3,
      deleted: 1,
      churn: 4,
    },
  ];
}

function createCandles(analysisId = "analysis-1"): ModuleCandlePoint[] {
  return [
    {
      analysisId,
      ts: "2026-04-01T00:00:00.000Z",
      commit: "aaa111",
      moduleKey: "rust:crate:core",
      moduleName: "core",
      moduleKind: "rust-crate",
      open: 8,
      high: 10,
      low: 8,
      close: 10,
    },
    {
      analysisId,
      ts: "2026-04-01T00:00:00.000Z",
      commit: "aaa111",
      moduleKey: "rust:crate:web",
      moduleName: "web",
      moduleKind: "rust-crate",
      open: 0,
      high: 4,
      low: 0,
      close: 4,
    },
    {
      analysisId,
      ts: "2026-04-08T00:00:00.000Z",
      commit: "bbb222",
      moduleKey: "rust:crate:core",
      moduleName: "core",
      moduleKind: "rust-crate",
      open: 10,
      high: 14,
      low: 9,
      close: 14,
    },
    {
      analysisId,
      ts: "2026-04-08T00:00:00.000Z",
      commit: "bbb222",
      moduleKey: "rust:crate:web",
      moduleName: "web",
      moduleKind: "rust-crate",
      open: 4,
      high: 7,
      low: 4,
      close: 6,
    },
  ];
}

function createPerCommitSnapshots(analysisId = "analysis-per-commit-1"): Snapshot[] {
  return [
    { analysisId, commit: "aaa111", ts: "2026-04-06T00:00:00.000Z" },
    { analysisId, commit: "bbb222", ts: "2026-04-07T00:00:00.000Z" },
    { analysisId, commit: "ccc333", ts: "2026-04-08T00:00:00.000Z" },
  ];
}

function createPerCommitPoints(analysisId = "analysis-per-commit-1"): MetricPoint[] {
  return [
    {
      analysisId,
      ts: "2026-04-06T00:00:00.000Z",
      commit: "aaa111",
      moduleKey: "rust:crate:core",
      moduleName: "core",
      moduleKind: "rust-crate",
      loc: 10,
      added: 10,
      deleted: 0,
      churn: 10,
    },
    {
      analysisId,
      ts: "2026-04-07T00:00:00.000Z",
      commit: "bbb222",
      moduleKey: "rust:crate:core",
      moduleName: "core",
      moduleKind: "rust-crate",
      loc: 18,
      added: 8,
      deleted: 0,
      churn: 8,
    },
    {
      analysisId,
      ts: "2026-04-08T00:00:00.000Z",
      commit: "ccc333",
      moduleKey: "rust:crate:core",
      moduleName: "core",
      moduleKind: "rust-crate",
      loc: 14,
      added: 1,
      deleted: 5,
      churn: 6,
    },
  ];
}

function createPerCommitCandles(analysisId = "analysis-per-commit-1"): ModuleCandlePoint[] {
  return [
    {
      analysisId,
      ts: "2026-04-06T00:00:00.000Z",
      commit: "aaa111",
      moduleKey: "rust:crate:core",
      moduleName: "core",
      moduleKind: "rust-crate",
      open: 10,
      high: 10,
      low: 10,
      close: 10,
    },
    {
      analysisId,
      ts: "2026-04-07T00:00:00.000Z",
      commit: "bbb222",
      moduleKey: "rust:crate:core",
      moduleName: "core",
      moduleKind: "rust-crate",
      open: 10,
      high: 18,
      low: 10,
      close: 18,
    },
    {
      analysisId,
      ts: "2026-04-08T00:00:00.000Z",
      commit: "ccc333",
      moduleKey: "rust:crate:core",
      moduleName: "core",
      moduleKind: "rust-crate",
      open: 18,
      high: 18,
      low: 14,
      close: 14,
    },
  ];
}

test("sqlite storage initializes schema and supports writes plus queries", async () => {
  await withStorage(async (storage) => {
    await storage.repositories.create(createRepository());
    await storage.analysisJobs.create(createJob());
    await storage.analysisJobs.upsertProgress(
      "analysis-1",
      createProgress({ phase: "analyzing-snapshots", percent: 50, sampledCommits: 2 }),
    );
    await storage.persistence.replaceAnalysisResult({
      analysisId: "analysis-1",
      snapshots: createSnapshots(),
      points: createPoints(),
      candles: createCandles(),
    });

    const repositories = await storage.repositories.list();
    assert.equal(repositories.length, 1);

    const result = await storage.query.getAnalysisResult("analysis-1");
    assert.ok(result);
    assert.equal(result.snapshots.length, 2);
    assert.equal(result.points.length, 4);
    assert.equal(result.candles.length, 4);
    assert.equal(result.progress.phase, "analyzing-snapshots");

    const summary = await storage.query.getAnalysisSummary("analysis-1");
    assert.ok(summary);
    assert.equal(summary.snapshotCount, 2);
    assert.equal(summary.latestSnapshot?.seq, 2);
    assert.equal(summary.latestSnapshot?.commit, "bbb222");

    const detailSummary = await storage.query.getAnalysisDetailSummary("analysis-1");
    assert.ok(detailSummary);
    assert.equal(detailSummary.repository?.id, "repo-1");
    assert.deepEqual(detailSummary.defaultModuleKeys, ["rust:crate:core", "rust:crate:web"]);
    assert.equal(detailSummary.modules.length, 2);

    const modules = await storage.query.listModulesByAnalysis("analysis-1");
    assert.deepEqual(
      modules.map((module) => module.key),
      ["rust:crate:core", "rust:crate:web"],
    );

    const series = await storage.query.querySeries({
      analysisId: "analysis-1",
      metric: "loc",
    });
    assert.ok(series);
    assert.equal(series.timeline.length, 2);
    assert.deepEqual(series.series[0]?.values, [10, 14]);

    const limitedSeries = await storage.query.querySeries({
      analysisId: "analysis-1",
      metric: "loc",
      limit: 1,
    });
    assert.ok(limitedSeries);
    assert.deepEqual(
      limitedSeries.series.map((item) => item.moduleKey),
      ["rust:crate:core"],
    );

    const candles = await storage.query.queryCandles({
      analysisId: "analysis-1",
      moduleKey: "rust:crate:core",
    });
    assert.ok(candles);
    assert.equal(candles.series.length, 1);
    assert.deepEqual(candles.series[0]?.values[1], {
      open: 10,
      high: 14,
      low: 9,
      close: 14,
    });

    const allCandles = await storage.query.queryCandles({
      analysisId: "analysis-1",
      all: true,
      limit: 1,
    });
    assert.ok(allCandles);
    assert.deepEqual(
      allCandles.series.map((item) => item.moduleKey),
      ["rust:crate:core", "rust:crate:web"],
    );

    const distribution = await storage.query.queryDistribution({
      analysisId: "analysis-1",
      metric: "churn",
      snapshot: "latest",
    });
    assert.ok(distribution);
    assert.equal(distribution.snapshot.seq, 2);
    assert.equal(distribution.items[0]?.moduleKey, "rust:crate:core");

    const ranking = await storage.query.queryRanking({
      analysisId: "analysis-1",
      metric: "loc",
      snapshot: 2,
      limit: 1,
    });
    assert.ok(ranking);
    assert.equal(ranking.items.length, 1);
    assert.equal(ranking.items[0]?.value, 14);

    await storage.analysisJobs.create(
      createJob({
        id: "analysis-2",
        repositoryId: "repo-1",
        sampling: "weekly",
        status: "done",
        createdAt: "2026-04-10T10:05:00.000Z",
        finishedAt: "2026-04-10T10:15:00.000Z",
      }),
    );
    await storage.analysisJobs.upsertProgress(
      "analysis-2",
      createProgress({
        phase: "done",
        percent: 100,
        sampledCommits: 2,
        completedSnapshots: 2,
        startedAt: "2026-04-10T10:05:00.000Z",
        updatedAt: "2026-04-10T10:15:00.000Z",
      }),
    );

    const latestDone = await storage.query.getLatestCompletedAnalysis("repo-1", "weekly");
    assert.ok(latestDone);
    assert.equal(latestDone.id, "analysis-2");
  });
});

test("replaceAnalysisResult overwrites prior data without duplicates", async () => {
  await withStorage(async (storage) => {
    await storage.repositories.create(createRepository());
    await storage.analysisJobs.create(createJob());
    await storage.analysisJobs.upsertProgress("analysis-1", createProgress());

    await storage.persistence.replaceAnalysisResult({
      analysisId: "analysis-1",
      snapshots: createSnapshots(),
      points: createPoints(),
      candles: createCandles(),
    });

    await storage.persistence.replaceAnalysisResult({
      analysisId: "analysis-1",
      snapshots: createSnapshots(),
      points: createPoints().filter((point) => point.moduleKey === "rust:crate:core"),
      candles: createCandles().filter((candle) => candle.moduleKey === "rust:crate:core"),
    });

    const result = await storage.query.getAnalysisResult("analysis-1");
    assert.ok(result);
    assert.equal(result.points.length, 2);
    assert.equal(result.candles.length, 2);
    assert.deepEqual(
      result.points.map((point) => point.moduleKey),
      ["rust:crate:core", "rust:crate:core"],
    );
  });
});

test("queryCandles aggregates from latest per-commit analysis when requesting weekly candles", async () => {
  await withStorage(async (storage) => {
    await storage.repositories.create(createRepository());

    await storage.analysisJobs.create(
      createJob({
        id: "analysis-weekly-1",
        sampling: "weekly",
        status: "done",
        createdAt: "2026-04-09T10:05:00.000Z",
        finishedAt: "2026-04-09T10:15:00.000Z",
      }),
    );
    await storage.analysisJobs.upsertProgress(
      "analysis-weekly-1",
      createProgress({
        phase: "done",
        percent: 100,
        sampledCommits: 1,
        completedSnapshots: 1,
      }),
    );
    await storage.persistence.replaceAnalysisResult({
      analysisId: "analysis-weekly-1",
      snapshots: [{ analysisId: "analysis-weekly-1", commit: "ccc333", ts: "2026-04-08T00:00:00.000Z" }],
      points: [
        {
          analysisId: "analysis-weekly-1",
          ts: "2026-04-08T00:00:00.000Z",
          commit: "ccc333",
          moduleKey: "rust:crate:core",
          moduleName: "core",
          moduleKind: "rust-crate",
          loc: 14,
          added: 9,
          deleted: 5,
          churn: 14,
        },
      ],
      candles: [
        {
          analysisId: "analysis-weekly-1",
          ts: "2026-04-08T00:00:00.000Z",
          commit: "ccc333",
          moduleKey: "rust:crate:core",
          moduleName: "core",
          moduleKind: "rust-crate",
          open: 10,
          high: 14,
          low: 10,
          close: 14,
        },
      ],
    });

    await storage.analysisJobs.create(
      createJob({
        id: "analysis-per-commit-1",
        sampling: "per-commit",
        status: "done",
        createdAt: "2026-04-10T10:05:00.000Z",
        finishedAt: "2026-04-10T10:25:00.000Z",
      }),
    );
    await storage.analysisJobs.upsertProgress(
      "analysis-per-commit-1",
      createProgress({
        phase: "done",
        percent: 100,
        sampledCommits: 3,
        completedSnapshots: 3,
      }),
    );
    await storage.persistence.replaceAnalysisResult({
      analysisId: "analysis-per-commit-1",
      snapshots: createPerCommitSnapshots(),
      points: createPerCommitPoints(),
      candles: createPerCommitCandles(),
    });

    const candles = await storage.query.queryCandles({
      analysisId: "analysis-weekly-1",
      sampling: "weekly",
      moduleKeys: ["rust:crate:core"],
    });

    assert.ok(candles);
    assert.equal(candles.timeline.length, 1);
    assert.deepEqual(candles.series[0]?.values[0], {
      open: 10,
      high: 18,
      low: 10,
      close: 14,
    });
  });
});

test("repository store supports local path lookup and cascading delete", async () => {
  await withStorage(async (storage) => {
    await storage.repositories.create(createRepository());
    await storage.analysisJobs.create(createJob({ status: "done" }));
    await storage.analysisJobs.upsertProgress(
      "analysis-1",
      createProgress({ phase: "done", percent: 100 }),
    );
    await storage.persistence.replaceAnalysisResult({
      analysisId: "analysis-1",
      snapshots: createSnapshots(),
      points: createPoints(),
      candles: createCandles(),
    });

    const found = await storage.repositories.getByLocalPath("/tmp/demo");
    assert.ok(found);
    assert.equal(found.id, "repo-1");

    const deleted = await storage.repositories.deleteById("repo-1");
    assert.equal(deleted, true);

    const repository = await storage.repositories.getById("repo-1");
    assert.equal(repository, null);

    const result = await storage.query.getAnalysisResult("analysis-1");
    assert.equal(result, null);
  });
});
