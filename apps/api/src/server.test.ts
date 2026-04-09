import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AnalysisAbortedError, type AnalyzeRepositoryHistoryOutput } from "@code-dance/analyzer";

import { createSqliteStorage } from "@code-dance/storage";

import { createServer } from "./server.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function createAnalysisOutput(analysisId: string): AnalyzeRepositoryHistoryOutput {
  return {
    snapshots: [
      { analysisId, commit: "aaa111", ts: "2026-04-01T00:00:00.000Z" },
      { analysisId, commit: "bbb222", ts: "2026-04-08T00:00:00.000Z" },
    ],
    candles: [
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
        open: 0,
        high: 6,
        low: 0,
        close: 6,
      },
    ],
    points: [
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
    ],
  };
}

function createEmptyAnalysisOutput(_analysisId: string): AnalyzeRepositoryHistoryOutput {
  return {
    snapshots: [],
    points: [],
    candles: [],
  };
}

function createMixedAnalysisOutput(analysisId: string): AnalyzeRepositoryHistoryOutput {
  return {
    snapshots: [
      { analysisId, commit: "aaa111", ts: "2026-04-01T00:00:00.000Z" },
      { analysisId, commit: "bbb222", ts: "2026-04-08T00:00:00.000Z" },
    ],
    candles: [
      {
        analysisId,
        ts: "2026-04-01T00:00:00.000Z",
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
        ts: "2026-04-08T00:00:00.000Z",
        commit: "bbb222",
        moduleKey: "rust:crate:core",
        moduleName: "core",
        moduleKind: "rust-crate",
        open: 10,
        high: 15,
        low: 10,
        close: 15,
      },
      {
        analysisId,
        ts: "2026-04-01T00:00:00.000Z",
        commit: "aaa111",
        moduleKey: "node:package:web",
        moduleName: "web",
        moduleKind: "node-package",
        open: 3,
        high: 3,
        low: 3,
        close: 3,
      },
      {
        analysisId,
        ts: "2026-04-08T00:00:00.000Z",
        commit: "bbb222",
        moduleKey: "node:package:web",
        moduleName: "web",
        moduleKind: "node-package",
        open: 3,
        high: 6,
        low: 3,
        close: 6,
      },
    ],
    points: [
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
        ts: "2026-04-08T00:00:00.000Z",
        commit: "bbb222",
        moduleKey: "rust:crate:core",
        moduleName: "core",
        moduleKind: "rust-crate",
        loc: 15,
        added: 5,
        deleted: 0,
        churn: 5,
      },
      {
        analysisId,
        ts: "2026-04-01T00:00:00.000Z",
        commit: "aaa111",
        moduleKey: "node:package:web",
        moduleName: "web",
        moduleKind: "node-package",
        loc: 3,
        added: 3,
        deleted: 0,
        churn: 3,
      },
      {
        analysisId,
        ts: "2026-04-08T00:00:00.000Z",
        commit: "bbb222",
        moduleKey: "node:package:web",
        moduleName: "web",
        moduleKind: "node-package",
        loc: 6,
        added: 4,
        deleted: 1,
        churn: 5,
      },
    ],
  };
}

async function waitFor<T>(fn: () => Promise<T>, predicate: (value: T) => boolean) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const value = await fn();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition not met in time");
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve,
    reject,
  } satisfies Deferred<T>;
}

test("api persists analyses and serves query endpoints from sqlite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-api-test-"));
  const storage = createSqliteStorage({ dbPath: join(dir, "api.sqlite") });
  const repositoryPath = join(dir, "fixture");
  await mkdir(repositoryPath);
  const app = createServer({
    storage,
    probeLocalRepositoryImpl: async (localPath) => ({
      name: "fixture",
      localPath,
      defaultBranch: "main",
      detectedKinds: ["rust"],
    }),
    detectRepositoryModulesImpl: async () => [
      {
        key: "rust:crate:core",
        name: "core",
        kind: "rust-crate",
        rootPath: "crates/core",
        files: ["crates/core/src/lib.rs"],
        source: "auto",
      },
    ],
    analyzeRepositoryHistoryImpl: async (input) => {
      await input.onProgress?.({
        phase: "analyzing-snapshots",
        percent: 80,
        totalCommits: 4,
        sampledCommits: 2,
        completedSnapshots: 1,
        currentCommit: "bbb222",
        currentModule: "core",
        currentFiles: 2,
        processedFiles: 1,
        etaSeconds: 1,
        startedAt: input.startedAt,
        updatedAt: input.startedAt,
      });
      return createAnalysisOutput(input.analysisId);
    },
  });

  try {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        sourceType: "local-path",
        localPath: repositoryPath,
      },
    });
    assert.equal(registerResponse.statusCode, 201);
    const repository = registerResponse.json();
    assert.equal(repository.localPath, repositoryPath);

    const analysisResponse = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: {
        repositoryId: repository.id,
        sampling: "weekly",
      },
    });
    assert.equal(analysisResponse.statusCode, 202);
    const initial = analysisResponse.json();
    assert.equal(initial.job.status, "pending");

    const finalAnalysis = await waitFor(
      async () =>
        app.inject({
          method: "GET",
          url: `/api/analyses/${initial.job.id}`,
        }),
      (response) => response.json().job.status === "done",
    );
    assert.equal(finalAnalysis.statusCode, 200);
    assert.equal(finalAnalysis.json().points.length, 3);
    assert.equal(finalAnalysis.json().candles.length, 3);

    const modulesResponse = await app.inject({
      method: "GET",
      url: `/api/modules?analysisId=${initial.job.id}`,
    });
    assert.equal(modulesResponse.statusCode, 200);
    assert.equal(modulesResponse.json().length, 2);

    const summariesResponse = await app.inject({
      method: "GET",
      url: "/api/analysis-summaries",
    });
    assert.equal(summariesResponse.statusCode, 200);
    assert.equal(summariesResponse.json()[0].job.id, initial.job.id);
    assert.equal(summariesResponse.json()[0].snapshotCount, 2);

    const seriesResponse = await app.inject({
      method: "GET",
      url: `/api/series?analysisId=${initial.job.id}&metric=loc&moduleKeys=rust:crate:core`,
    });
    assert.equal(seriesResponse.statusCode, 200);
    assert.deepEqual(seriesResponse.json().series[0].values, [10, 14]);

    const distributionResponse = await app.inject({
      method: "GET",
      url: `/api/distribution?analysisId=${initial.job.id}&metric=loc&snapshot=latest`,
    });
    assert.equal(distributionResponse.statusCode, 200);
    assert.equal(distributionResponse.json().snapshot.seq, 2);

    const candlesResponse = await app.inject({
      method: "GET",
      url: `/api/candles?analysisId=${initial.job.id}&moduleKeys=rust:crate:core`,
    });
    assert.equal(candlesResponse.statusCode, 200);
    assert.equal(candlesResponse.json().series[0].values[1].high, 14);

    const rankingResponse = await app.inject({
      method: "GET",
      url: `/api/ranking?analysisId=${initial.job.id}&metric=churn&snapshot=2&limit=1`,
    });
    assert.equal(rankingResponse.statusCode, 200);
    assert.equal(rankingResponse.json().items.length, 1);

    const invalidMetricResponse = await app.inject({
      method: "GET",
      url: `/api/series?analysisId=${initial.job.id}&metric=oops`,
    });
    assert.equal(invalidMetricResponse.statusCode, 400);

    const missingAnalysisResponse = await app.inject({
      method: "GET",
      url: "/api/modules?analysisId=missing",
    });
    assert.equal(missingAnalysisResponse.statusCode, 404);

    const rerunResponse = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: {
        repositoryId: repository.id,
        sampling: "weekly",
      },
    });
    assert.equal(rerunResponse.statusCode, 409);
    assert.equal(rerunResponse.json().error, "analysis_already_completed");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/repositories/${repository.id}`,
    });
    assert.equal(deleteResponse.statusCode, 204);

    const getDeletedRepositoryResponse = await app.inject({
      method: "GET",
      url: `/api/repositories/${repository.id}/modules`,
    });
    assert.equal(getDeletedRepositoryResponse.statusCode, 404);

    const reRegisterResponse = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        sourceType: "local-path",
        localPath: repositoryPath,
      },
    });
    assert.equal(reRegisterResponse.statusCode, 201);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("api queues analyses from the same repository until the active one finishes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-api-queue-test-"));
  const storage = createSqliteStorage({ dbPath: join(dir, "api.sqlite") });
  const repositoryPath = join(dir, "fixture");
  await mkdir(repositoryPath);

  const startedAnalysisIds: string[] = [];
  const gates = new Map<string, Deferred<AnalyzeRepositoryHistoryOutput>>();
  const app = createServer({
    storage,
    probeLocalRepositoryImpl: async (localPath) => ({
      name: "fixture",
      localPath,
      defaultBranch: "main",
      detectedKinds: ["rust"],
    }),
    analysisSchedulerConfig: {
      maxConcurrentAnalyses: 2,
      maxConcurrentAnalysesPerRepository: 1,
    },
    analyzeRepositoryHistoryImpl: async (input) => {
      startedAnalysisIds.push(input.analysisId);
      const gate =
        gates.get(input.analysisId) ??
        (() => {
          const created = createDeferred<AnalyzeRepositoryHistoryOutput>();
          gates.set(input.analysisId, created);
          return created;
        })();
      return gate.promise;
    },
  });

  try {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        sourceType: "local-path",
        localPath: repositoryPath,
      },
    });
    assert.equal(registerResponse.statusCode, 201);
    const repository = registerResponse.json();

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: {
        repositoryId: repository.id,
        sampling: "weekly",
      },
    });
    assert.equal(firstResponse.statusCode, 202);
    const first = firstResponse.json();
    const firstGate = gates.get(first.job.id) ?? createDeferred<AnalyzeRepositoryHistoryOutput>();
    gates.set(first.job.id, firstGate);

    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: {
        repositoryId: repository.id,
        sampling: "daily",
      },
    });
    assert.equal(secondResponse.statusCode, 202);
    const second = secondResponse.json();
    const secondGate =
      gates.get(second.job.id) ?? createDeferred<AnalyzeRepositoryHistoryOutput>();
    gates.set(second.job.id, secondGate);

    await waitFor(
      async () =>
        app.inject({
          method: "GET",
          url: `/api/analyses/${second.job.id}`,
        }),
      (response) => response.json().job.status === "pending",
    );
    assert.deepEqual(startedAnalysisIds, [first.job.id]);

    firstGate.resolve(createEmptyAnalysisOutput(first.job.id));

    await waitFor(
      async () =>
        app.inject({
          method: "GET",
          url: `/api/analyses/${first.job.id}`,
        }),
      (response) => response.json().job.status === "done",
    );

    await waitFor(
      async () =>
        app.inject({
          method: "GET",
          url: `/api/analyses/${second.job.id}`,
        }),
      (response) => response.json().job.status === "running",
    );
    assert.deepEqual(startedAnalysisIds, [first.job.id, second.job.id]);

    secondGate.resolve(createEmptyAnalysisOutput(second.job.id));

    const finishedSecond = await waitFor(
      async () =>
        app.inject({
          method: "GET",
          url: `/api/analyses/${second.job.id}`,
        }),
      (response) => response.json().job.status === "done",
    );
    assert.equal(finishedSecond.statusCode, 200);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("api rejects duplicate repository registration for the same path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-api-dup-repo-test-"));
  const storage = createSqliteStorage({ dbPath: join(dir, "api.sqlite") });
  const repositoryPath = join(dir, "fixture");
  await mkdir(repositoryPath);
  const app = createServer({
    storage,
    probeLocalRepositoryImpl: async () => ({
      name: "fixture",
      defaultBranch: "main",
      detectedKinds: ["rust"],
    }),
  });

  try {
    const first = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        sourceType: "local-path",
        localPath: repositoryPath,
      },
    });
    assert.equal(first.statusCode, 201);

    const second = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        sourceType: "local-path",
        localPath: repositoryPath,
      },
    });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error, "repository_already_registered");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("api allows different sampling analyses for the same repository", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-api-sampling-test-"));
  const storage = createSqliteStorage({ dbPath: join(dir, "api.sqlite") });
  const repositoryPath = join(dir, "fixture");
  await mkdir(repositoryPath);
  const app = createServer({
    storage,
    probeLocalRepositoryImpl: async (localPath) => ({
      name: "fixture",
      localPath,
      defaultBranch: "main",
      detectedKinds: ["rust"],
    }),
    analyzeRepositoryHistoryImpl: async (input) => createAnalysisOutput(input.analysisId),
  });

  try {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        sourceType: "local-path",
        localPath: repositoryPath,
      },
    });
    assert.equal(registerResponse.statusCode, 201);
    const repository = registerResponse.json();

    const weeklyResponse = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: {
        repositoryId: repository.id,
        sampling: "weekly",
      },
    });
    assert.equal(weeklyResponse.statusCode, 202);

    await waitFor(
      async () =>
        app.inject({
          method: "GET",
          url: `/api/analyses/${weeklyResponse.json().job.id}`,
        }),
      (response) => response.json().job.status === "done",
    );

    const dailyResponse = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: {
        repositoryId: repository.id,
        sampling: "daily",
      },
    });
    assert.equal(dailyResponse.statusCode, 202);

    const perCommitResponse = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: {
        repositoryId: repository.id,
        sampling: "per-commit",
      },
    });
    assert.equal(perCommitResponse.statusCode, 202);

    const duplicateWeeklyResponse = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: {
        repositoryId: repository.id,
        sampling: "weekly",
      },
    });
    assert.equal(duplicateWeeklyResponse.statusCode, 409);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("api deletes repository with active analysis by aborting the task and cleaning data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-api-delete-active-test-"));
  const storage = createSqliteStorage({ dbPath: join(dir, "api.sqlite") });
  const repositoryPath = join(dir, "fixture");
  await mkdir(repositoryPath);

  let abortedAnalysisId: string | null = null;
  const app = createServer({
    storage,
    probeLocalRepositoryImpl: async (localPath) => ({
      name: "fixture",
      localPath,
      defaultBranch: "main",
      detectedKinds: ["rust"],
    }),
    analyzeRepositoryHistoryImpl: async (input) =>
      await new Promise<AnalyzeRepositoryHistoryOutput>((resolve, reject) => {
        input.abortSignal?.addEventListener(
          "abort",
          () => {
            abortedAnalysisId = input.analysisId;
            reject(new AnalysisAbortedError());
          },
          { once: true },
        );
      }),
  });

  try {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        sourceType: "local-path",
        localPath: repositoryPath,
      },
    });
    assert.equal(registerResponse.statusCode, 201);
    const repository = registerResponse.json();

    const analysisResponse = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: {
        repositoryId: repository.id,
        sampling: "weekly",
      },
    });
    assert.equal(analysisResponse.statusCode, 202);
    const analysisId = analysisResponse.json().job.id;

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/repositories/${repository.id}`,
    });
    assert.equal(deleteResponse.statusCode, 204);
    assert.equal(abortedAnalysisId, analysisId);

    const repositoryListResponse = await app.inject({
      method: "GET",
      url: "/api/repositories",
    });
    assert.equal(repositoryListResponse.statusCode, 200);
    assert.equal(repositoryListResponse.json().length, 0);

    const analysisResponseAfterDelete = await app.inject({
      method: "GET",
      url: `/api/analyses/${analysisId}`,
    });
    assert.equal(analysisResponseAfterDelete.statusCode, 404);

    const summariesResponse = await app.inject({
      method: "GET",
      url: "/api/analysis-summaries",
    });
    assert.equal(summariesResponse.statusCode, 200);
    assert.equal(summariesResponse.json().length, 0);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("api exposes mixed rust and node analysis results in one job", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-api-mixed-test-"));
  const storage = createSqliteStorage({ dbPath: join(dir, "api.sqlite") });
  const repositoryPath = join(dir, "fixture");
  await mkdir(repositoryPath);
  const app = createServer({
    storage,
    probeLocalRepositoryImpl: async (localPath) => ({
      name: "fixture-mixed",
      localPath,
      defaultBranch: "main",
      detectedKinds: ["rust", "node"],
    }),
    detectRepositoryModulesImpl: async () => [
      {
        key: "rust:crate:core",
        name: "core",
        kind: "rust-crate",
        rootPath: "crates/core",
        files: ["crates/core/src/lib.rs"],
        source: "auto",
      },
      {
        key: "node:package:web",
        name: "web",
        kind: "node-package",
        rootPath: "apps/web",
        files: ["apps/web/src/app.tsx", "apps/web/src/index.html"],
        source: "auto",
      },
    ],
    analyzeRepositoryHistoryImpl: async (input) => {
      await input.onProgress?.({
        phase: "analyzing-snapshots",
        percent: 90,
        totalCommits: 4,
        sampledCommits: 2,
        completedSnapshots: 1,
        currentCommit: "bbb222",
        currentModule: "web",
        currentFiles: 4,
        processedFiles: 3,
        etaSeconds: 1,
        startedAt: input.startedAt,
        updatedAt: input.startedAt,
      });
      return createMixedAnalysisOutput(input.analysisId);
    },
  });

  try {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        sourceType: "local-path",
        localPath: repositoryPath,
      },
    });
    assert.equal(registerResponse.statusCode, 201);
    const repository = registerResponse.json();

    const analysisResponse = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: {
        repositoryId: repository.id,
        sampling: "weekly",
      },
    });
    assert.equal(analysisResponse.statusCode, 202);
    const initial = analysisResponse.json();

    const finalAnalysis = await waitFor(
      async () =>
        app.inject({
          method: "GET",
          url: `/api/analyses/${initial.job.id}`,
        }),
      (response) => response.json().job.status === "done",
    );
    assert.equal(finalAnalysis.statusCode, 200);
    assert.ok(
      finalAnalysis
        .json()
        .points.some((point: { moduleKey: string }) => point.moduleKey.startsWith("rust:crate:")),
    );
    assert.ok(
      finalAnalysis
        .json()
        .points.some((point: { moduleKey: string }) => point.moduleKey.startsWith("node:package:")),
    );

    const modulesResponse = await app.inject({
      method: "GET",
      url: `/api/modules?analysisId=${initial.job.id}`,
    });
    assert.equal(modulesResponse.statusCode, 200);
    assert.deepEqual(
      modulesResponse
        .json()
        .map((module: { key: string }) => module.key)
        .sort(),
      ["node:package:web", "rust:crate:core"],
    );

    const nodeSeriesResponse = await app.inject({
      method: "GET",
      url: `/api/series?analysisId=${initial.job.id}&metric=loc&moduleKeys=node:package:web`,
    });
    assert.equal(nodeSeriesResponse.statusCode, 200);
    assert.deepEqual(nodeSeriesResponse.json().series[0].values, [3, 6]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("api passes static analyzer performance config into analysis tasks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-api-performance-test-"));
  const storage = createSqliteStorage({ dbPath: join(dir, "api.sqlite") });
  const repositoryPath = join(dir, "fixture");
  await mkdir(repositoryPath);

  let receivedPerformance:
    | {
        fileReadConcurrency?: number;
        analyzerConcurrency?: number;
        snapshotConcurrency?: number;
        progressThrottleMs?: number;
      }
    | undefined;

  const app = createServer({
    storage,
    analysisPerformanceConfig: {
      fileReadConcurrency: 9,
      analyzerConcurrency: 2,
      snapshotConcurrency: 3,
      progressThrottleMs: 750,
    },
    probeLocalRepositoryImpl: async (localPath) => ({
      name: "fixture",
      localPath,
      defaultBranch: "main",
      detectedKinds: ["rust"],
    }),
    analyzeRepositoryHistoryImpl: async (input) => {
      receivedPerformance = input.performance;
      return createAnalysisOutput(input.analysisId);
    },
  });

  try {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        sourceType: "local-path",
        localPath: repositoryPath,
      },
    });
    assert.equal(registerResponse.statusCode, 201);
    const repository = registerResponse.json();

    const analysisResponse = await app.inject({
      method: "POST",
      url: "/api/analyses",
      payload: {
        repositoryId: repository.id,
        sampling: "weekly",
      },
    });
    assert.equal(analysisResponse.statusCode, 202);

    await waitFor(
      async () => receivedPerformance,
      (performance) => performance !== undefined,
    );
    assert.deepEqual(receivedPerformance, {
      fileReadConcurrency: 9,
      analyzerConcurrency: 2,
      snapshotConcurrency: 3,
      progressThrottleMs: 750,
    });
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("api resumes interrupted analyses on server startup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-api-resume-test-"));
  const dbPath = join(dir, "api.sqlite");
  const seededStorage = createSqliteStorage({ dbPath });
  const repositoryPath = join(dir, "fixture");
  await mkdir(repositoryPath);

  try {
    await seededStorage.repositories.create({
      id: "repo-resume",
      name: "fixture",
      sourceType: "local-path",
      localPath: repositoryPath,
      remoteUrl: null,
      defaultBranch: "main",
      detectedKinds: ["rust"],
      status: "ready",
      createdAt: "2026-04-09T10:00:00.000Z",
    });
    await seededStorage.analysisJobs.create({
      id: "analysis-resume",
      repositoryId: "repo-resume",
      branch: "main",
      sampling: "weekly",
      status: "running",
      createdAt: "2026-04-09T10:05:00.000Z",
      finishedAt: null,
      errorMessage: null,
    });
    await seededStorage.analysisJobs.upsertProgress("analysis-resume", {
      phase: "analyzing-snapshots",
      percent: 83.3,
      totalCommits: 200,
      sampledCommits: 186,
      completedSnapshots: 160,
      currentCommit: "2f9281b6",
      currentModule: "reth-ipc",
      currentFiles: 1929,
      processedFiles: 893,
      etaSeconds: 107,
      startedAt: "2026-04-09T10:05:00.000Z",
      updatedAt: "2026-04-09T10:15:00.000Z",
    });
  } finally {
    seededStorage.close();
  }

  let resumedRuns = 0;
  let resumedPerformance:
    | {
        fileReadConcurrency?: number;
        analyzerConcurrency?: number;
        snapshotConcurrency?: number;
        progressThrottleMs?: number;
      }
    | undefined;
  const app = createServer({
    storage: createSqliteStorage({ dbPath }),
    analysisPerformanceConfig: {
      fileReadConcurrency: 5,
      analyzerConcurrency: 2,
      snapshotConcurrency: 4,
      progressThrottleMs: 600,
    },
    analyzeRepositoryHistoryImpl: async (input) => {
      resumedRuns += 1;
      resumedPerformance = input.performance;
      await input.onProgress?.({
        phase: "analyzing-snapshots",
        percent: 90,
        totalCommits: 200,
        sampledCommits: 186,
        completedSnapshots: 180,
        currentCommit: "bbb222",
        currentModule: "reth-ipc",
        currentFiles: 10,
        processedFiles: 9,
        etaSeconds: 1,
        startedAt: input.startedAt,
        updatedAt: input.startedAt,
      });
      return createAnalysisOutput(input.analysisId);
    },
  });

  try {
    await app.ready();
    assert.equal(resumedRuns, 1);
    assert.deepEqual(resumedPerformance, {
      fileReadConcurrency: 5,
      analyzerConcurrency: 2,
      snapshotConcurrency: 4,
      progressThrottleMs: 600,
    });

    const resumed = await waitFor(
      async () =>
        app.inject({
          method: "GET",
          url: "/api/analyses/analysis-resume",
        }),
      (response) => response.json().job.status === "done",
    );

    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.json().snapshots.length, 2);
    assert.equal(resumed.json().job.status, "done");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("api respects the global analysis concurrency limit during interrupted recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-dance-api-recovery-limit-test-"));
  const dbPath = join(dir, "api.sqlite");
  const seededStorage = createSqliteStorage({ dbPath });
  const repoOnePath = join(dir, "fixture-one");
  const repoTwoPath = join(dir, "fixture-two");
  await mkdir(repoOnePath);
  await mkdir(repoTwoPath);

  try {
    await seededStorage.repositories.create({
      id: "repo-one",
      name: "fixture-one",
      sourceType: "local-path",
      localPath: repoOnePath,
      remoteUrl: null,
      defaultBranch: "main",
      detectedKinds: ["rust"],
      status: "ready",
      createdAt: "2026-04-09T10:00:00.000Z",
    });
    await seededStorage.repositories.create({
      id: "repo-two",
      name: "fixture-two",
      sourceType: "local-path",
      localPath: repoTwoPath,
      remoteUrl: null,
      defaultBranch: "main",
      detectedKinds: ["rust"],
      status: "ready",
      createdAt: "2026-04-09T10:01:00.000Z",
    });
    await seededStorage.analysisJobs.create({
      id: "analysis-one",
      repositoryId: "repo-one",
      branch: "main",
      sampling: "weekly",
      status: "running",
      createdAt: "2026-04-09T10:05:00.000Z",
      finishedAt: null,
      errorMessage: null,
    });
    await seededStorage.analysisJobs.upsertProgress("analysis-one", {
      phase: "analyzing-snapshots",
      percent: 45,
      totalCommits: 200,
      sampledCommits: 90,
      completedSnapshots: 40,
      currentCommit: "aaa111",
      currentModule: "core",
      currentFiles: 10,
      processedFiles: 4,
      etaSeconds: 12,
      startedAt: "2026-04-09T10:05:00.000Z",
      updatedAt: "2026-04-09T10:10:00.000Z",
    });
    await seededStorage.analysisJobs.create({
      id: "analysis-two",
      repositoryId: "repo-two",
      branch: "main",
      sampling: "weekly",
      status: "pending",
      createdAt: "2026-04-09T10:06:00.000Z",
      finishedAt: null,
      errorMessage: null,
    });
    await seededStorage.analysisJobs.upsertProgress("analysis-two", {
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
      startedAt: "2026-04-09T10:06:00.000Z",
      updatedAt: "2026-04-09T10:06:00.000Z",
    });
  } finally {
    seededStorage.close();
  }

  const startedAnalysisIds: string[] = [];
  const gates = new Map<string, Deferred<AnalyzeRepositoryHistoryOutput>>();
  const app = createServer({
    storage: createSqliteStorage({ dbPath }),
    analysisSchedulerConfig: {
      maxConcurrentAnalyses: 1,
      maxConcurrentAnalysesPerRepository: 1,
    },
    analyzeRepositoryHistoryImpl: async (input) => {
      startedAnalysisIds.push(input.analysisId);
      const gate =
        gates.get(input.analysisId) ??
        (() => {
          const created = createDeferred<AnalyzeRepositoryHistoryOutput>();
          gates.set(input.analysisId, created);
          return created;
        })();
      return gate.promise;
    },
  });

  try {
    gates.set("analysis-one", createDeferred<AnalyzeRepositoryHistoryOutput>());
    gates.set("analysis-two", createDeferred<AnalyzeRepositoryHistoryOutput>());

    await app.ready();

    await waitFor(
      async () => startedAnalysisIds,
      (ids) => ids.length === 1,
    );
    const firstStartedId = startedAnalysisIds[0]!;
    const secondStartedId = firstStartedId === "analysis-one" ? "analysis-two" : "analysis-one";

    await waitFor(
      async () =>
        app.inject({
          method: "GET",
          url: `/api/analyses/${firstStartedId}`,
        }),
      (response) => response.json().job.status === "running",
    );
    gates.get(firstStartedId)!.resolve(createEmptyAnalysisOutput(firstStartedId));

    await waitFor(
      async () =>
        app.inject({
          method: "GET",
          url: `/api/analyses/${firstStartedId}`,
        }),
      (response) => response.json().job.status === "done",
    );

    await waitFor(
      async () => startedAnalysisIds,
      (ids) => ids.length === 2,
    );
    assert.deepEqual(startedAnalysisIds, [firstStartedId, secondStartedId]);

    await waitFor(
      async () =>
        app.inject({
          method: "GET",
          url: `/api/analyses/${secondStartedId}`,
        }),
      (response) => response.json().job.status === "running",
    );

    gates.get(secondStartedId)!.resolve(createEmptyAnalysisOutput(secondStartedId));

    const finishedSecond = await waitFor(
      async () =>
        app.inject({
          method: "GET",
          url: `/api/analyses/${secondStartedId}`,
        }),
      (response) => response.json().job.status === "done",
    );
    assert.equal(finishedSecond.statusCode, 200);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
