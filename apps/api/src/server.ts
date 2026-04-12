import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import {
  analysisDetailSummarySchema,
  analysisSummarySchema,
  analysisSummaryLookupParamsSchema,
  analysisResultSchema,
  candlesQuerySchema,
  candlesResponseSchema,
  createAnalysisRequestSchema,
  createLocalRepositoryRequestSchema,
  distributionQuerySchema,
  distributionResponseSchema,
  rankingQuerySchema,
  rankingResponseSchema,
  repositoryModulesResponseSchema,
  repositoryTargetSchema,
  seriesQuerySchema,
  seriesResponseSchema,
  analysisModuleSummarySchema,
  type RepositoryModulesResponseDto,
} from "@code-dance/contracts";
import {
  AnalysisAbortedError,
  analyzeRepositoryHistory,
  detectRepositoryModules,
} from "@code-dance/analyzer";
import { probeLocalRepository } from "@code-dance/git";
import { createSqliteStorage, defaultDatabasePath, type SqliteStorage } from "@code-dance/storage";

const execFileAsync = promisify(execFile);

type CreateServerDeps = {
  storage?: SqliteStorage;
  analyzeRepositoryHistoryImpl?: typeof analyzeRepositoryHistory;
  detectRepositoryModulesImpl?: typeof detectRepositoryModules;
  probeLocalRepositoryImpl?: typeof probeLocalRepository;
  readRepositoryHeadImpl?: typeof readRepositoryHead;
  analysisSchedulerConfig?: Partial<AnalysisSchedulerConfig>;
  analysisPerformanceConfig?: Partial<AnalysisPerformanceConfig>;
};

type AnalysisSchedulerConfig = {
  maxConcurrentAnalyses: number;
  maxConcurrentAnalysesPerRepository: number;
};

type AnalysisPerformanceConfig = {
  fileReadConcurrency: number;
  analyzerConcurrency: number;
  snapshotConcurrency: number;
  progressThrottleMs: number;
};

const DEFAULT_ANALYSIS_PERFORMANCE_CONFIG: AnalysisPerformanceConfig = {
  fileReadConcurrency: 8,
  analyzerConcurrency: 1,
  snapshotConcurrency: 2,
  progressThrottleMs: 1000,
};

const DEFAULT_DETAIL_MODULE_LIMIT = 12;

type AnalysisSchedulerTask = {
  analysisId: string;
  repositoryId: string;
  controller: AbortController;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  state: "queued" | "running";
  input: Omit<Parameters<typeof runAnalysisTask>[0], "abortSignal">;
};

export function createServer(deps: CreateServerDeps = {}) {
  const storage = deps.storage ?? createSqliteStorage({ dbPath: process.env.CODE_DANCE_DB_PATH });
  const analyzeRepositoryHistoryImpl =
    deps.analyzeRepositoryHistoryImpl ?? analyzeRepositoryHistory;
  const detectRepositoryModulesImpl = deps.detectRepositoryModulesImpl ?? detectRepositoryModules;
  const probeLocalRepositoryImpl = deps.probeLocalRepositoryImpl ?? probeLocalRepository;
  const readRepositoryHeadImpl = deps.readRepositoryHeadImpl ?? readRepositoryHead;
  const analysisPerformanceConfig = normalizeAnalysisPerformanceConfig(
    deps.analysisPerformanceConfig ?? readAnalysisPerformanceConfigFromEnv(process.env),
  );
  const analysisScheduler = createAnalysisScheduler({
    config: normalizeAnalysisSchedulerConfig(deps.analysisSchedulerConfig),
  });
  const repositoryModulesCache = new Map<string, Promise<RepositoryModulesResponseDto>>();
  const pendingRepositoryDeletions = new Set<string>();
  const repositoryDeletionTasks = new Map<string, Promise<void>>();

  const app = Fastify({
    logger: true,
  });

  app.register(cors, {
    origin: true,
  });

  app.addHook("onReady", async () => {
    await resumeInterruptedAnalyses({
      app,
      analysisScheduler,
      storage,
      analyzeRepositoryHistoryImpl,
      analysisPerformanceConfig,
    });
  });

  app.addHook("onClose", async () => {
    await Promise.allSettled(repositoryDeletionTasks.values());
    await analysisScheduler.close();
    storage.close();
  });

  function isRepositoryPendingDeletion(repositoryId: string) {
    return pendingRepositoryDeletions.has(repositoryId);
  }

  function enqueueRepositoryDeletion(repositoryId: string) {
    if (repositoryDeletionTasks.has(repositoryId)) {
      return;
    }

    pendingRepositoryDeletions.add(repositoryId);
    const task = (async () => {
      try {
        await analysisScheduler.cancelRepository(repositoryId);
        await storage.repositories.deleteById(repositoryId);
      } catch (error) {
        app.log.error({ err: error, repositoryId }, "repository deletion failed");
      } finally {
        pendingRepositoryDeletions.delete(repositoryId);
        repositoryDeletionTasks.delete(repositoryId);
      }
    })();

    repositoryDeletionTasks.set(repositoryId, task);
  }

  app.get("/api/health", async () => {
    return {
      ok: true,
      service: "code-dance-api",
      dbPath: storage.dbPath ?? defaultDatabasePath(),
    };
  });

  app.get("/api/repositories", async () => {
    const repositories = await storage.repositories.list();
    return repositories
      .filter((repository) => !isRepositoryPendingDeletion(repository.id))
      .map((repository) => repositoryTargetSchema.parse(repository));
  });

  app.post("/api/repositories", async (request, reply) => {
    const payload = createLocalRepositoryRequestSchema.parse(request.body);

    try {
      const normalizedLocalPath = await realpath(payload.localPath);
      const existing = await storage.repositories.getByLocalPath(normalizedLocalPath);
      if (existing) {
        return sendApiError(
          reply,
          409,
          "repository_already_registered",
          `repository path already registered: ${normalizedLocalPath}`,
        );
      }

      const probe = await probeLocalRepositoryImpl(normalizedLocalPath);
      const repository = repositoryTargetSchema.parse({
        id: crypto.randomUUID(),
        name: probe.name,
        sourceType: "local-path",
        localPath: normalizedLocalPath,
        remoteUrl: null,
        defaultBranch: probe.defaultBranch,
        detectedKinds: probe.detectedKinds,
        status: "ready",
        createdAt: new Date().toISOString(),
      });

      return reply.code(201).send(await storage.repositories.create(repository));
    } catch (error) {
      return sendApiError(reply, 400, "repository_registration_failed", error);
    }
  });

  app.delete("/api/repositories/:id", async (request, reply) => {
    const params = request.params as { id?: string };
    if (!params.id) {
      return sendApiError(reply, 400, "invalid_repository_id", "repository id is required");
    }

    const repository = await storage.repositories.getById(params.id);
    if (!repository) {
      return sendApiError(reply, 404, "repository_not_found", "repository was not found");
    }

    if (isRepositoryPendingDeletion(params.id)) {
      return reply.code(202).send();
    }

    enqueueRepositoryDeletion(params.id);
    return reply.code(202).send();
  });

  app.get("/api/repositories/:id/modules", async (request, reply) => {
    const params = request.params as { id?: string };
    if (!params.id) {
      return sendApiError(reply, 400, "invalid_repository_id", "repository id is required");
    }

    const repository = await storage.repositories.getById(params.id);
    if (!repository) {
      return sendApiError(reply, 404, "repository_not_found", "repository was not found");
    }
    if (isRepositoryPendingDeletion(params.id)) {
      return sendApiError(
        reply,
        409,
        "repository_deletion_in_progress",
        "repository deletion is already in progress",
      );
    }

    if (!repository.localPath) {
      return sendApiError(
        reply,
        400,
        "repository_source_unsupported",
        "only local repositories are supported right now",
      );
    }

    try {
      const localPath = repository.localPath;
      const cacheKey = await createRepositoryModulesCacheKey(
        localPath,
        repository.detectedKinds,
        readRepositoryHeadImpl,
      );
      const cached = repositoryModulesCache.get(cacheKey);
      if (cached) {
        return await cached;
      }

      const loadPromise = (async () => {
        const modules = await detectRepositoryModulesImpl({
          localPath,
          detectedKinds: repository.detectedKinds,
        });

        return repositoryModulesResponseSchema.parse({
          repositoryId: repository.id,
          modules,
        });
      })();

      repositoryModulesCache.set(cacheKey, loadPromise);
      try {
        return await loadPromise;
      } catch (error) {
        repositoryModulesCache.delete(cacheKey);
        throw error;
      }
    } catch (error) {
      return sendApiError(reply, 400, "module_detection_failed", error);
    }
  });

  app.get("/api/analyses", async () => {
    const analyses = await storage.query.listAnalysisResults();
    return analyses
      .filter((analysis) => !isRepositoryPendingDeletion(analysis.job.repositoryId))
      .map((analysis) => analysisResultSchema.parse(analysis));
  });

  app.get("/api/analysis-summaries", async () => {
    const summaries = await storage.query.listAnalysisSummaries();
    return summaries
      .filter((summary) => !isRepositoryPendingDeletion(summary.job.repositoryId))
      .map((summary) => analysisSummarySchema.parse(summary));
  });

  app.get("/api/analysis-summaries/:id", async (request, reply) => {
    const params = analysisSummaryLookupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendApiError(reply, 400, "invalid_analysis_id", "analysis id is required");
    }

    const summary = await storage.query.getAnalysisSummary(params.data.id);
    if (!summary) {
      return sendApiError(reply, 404, "analysis_not_found", "analysis was not found");
    }

    return analysisSummarySchema.parse(summary);
  });

  app.get("/api/analysis-details/:id", async (request, reply) => {
    const params = analysisSummaryLookupParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendApiError(reply, 400, "invalid_analysis_id", "analysis id is required");
    }

    const detail = await storage.query.getAnalysisDetailSummary(params.data.id, {
      defaultModuleLimit: DEFAULT_DETAIL_MODULE_LIMIT,
    });
    if (!detail) {
      return sendApiError(reply, 404, "analysis_not_found", "analysis was not found");
    }

    return analysisDetailSummarySchema.parse(detail);
  });

  app.get("/api/analyses/:id", async (request, reply) => {
    const params = request.params as { id?: string };
    if (!params.id) {
      return sendApiError(reply, 400, "invalid_analysis_id", "analysis id is required");
    }

    const analysis = await storage.query.getAnalysisResult(params.id);
    if (!analysis) {
      return sendApiError(reply, 404, "analysis_not_found", "analysis was not found");
    }

    return analysisResultSchema.parse(analysis);
  });

  app.get("/api/modules", async (request, reply) => {
    const query = request.query as { analysisId?: string };
    if (!query.analysisId) {
      return sendApiError(reply, 400, "invalid_analysis_id", "analysisId is required");
    }

    const analysis = await storage.analysisJobs.getById(query.analysisId);
    if (!analysis) {
      return sendApiError(reply, 404, "analysis_not_found", "analysis was not found");
    }

    const modules = await storage.query.listModulesByAnalysis(query.analysisId);
    return modules.map((module) => analysisModuleSummarySchema.parse(module));
  });

  app.get("/api/series", async (request, reply) => {
    try {
      const raw = request.query as {
        analysisId?: string;
        metric?: string;
        all?: string;
        moduleKeys?: string;
        limit?: string;
      };
      const parsed = seriesQuerySchema.parse({
        analysisId: raw.analysisId,
        metric: raw.metric,
        all: raw.all,
        moduleKeys: raw.moduleKeys
          ? raw.moduleKeys
              .split(",")
              .map((moduleKey) => moduleKey.trim())
              .filter(Boolean)
          : [],
        limit: raw.limit,
      });

      const result = await storage.query.querySeries(parsed);
      if (!result) {
        return sendApiError(reply, 404, "analysis_not_found", "analysis was not found");
      }

      return seriesResponseSchema.parse(result);
    } catch (error) {
      return sendApiError(reply, 400, "invalid_series_query", error);
    }
  });

  app.get("/api/candles", async (request, reply) => {
    try {
      const raw = request.query as {
        analysisId?: string;
        sampling?: string;
        all?: string;
        moduleKeys?: string;
        limit?: string;
      };
      const parsed = candlesQuerySchema.parse({
        analysisId: raw.analysisId,
        sampling: raw.sampling,
        all: raw.all,
        moduleKeys: raw.moduleKeys
          ? raw.moduleKeys
              .split(",")
              .map((moduleKey) => moduleKey.trim())
              .filter(Boolean)
          : [],
        limit: raw.limit,
      });

      const result = await storage.query.queryCandles(parsed);
      if (!result) {
        return sendApiError(reply, 404, "analysis_not_found", "analysis was not found");
      }

      return candlesResponseSchema.parse(result);
    } catch (error) {
      return sendApiError(reply, 400, "invalid_candles_query", error);
    }
  });

  app.get("/api/distribution", async (request, reply) => {
    try {
      const parsed = distributionQuerySchema.parse(request.query);
      const result = await storage.query.queryDistribution(parsed);
      if (!result) {
        const analysis = await storage.analysisJobs.getById(parsed.analysisId);
        return analysis
          ? sendApiError(reply, 404, "snapshot_not_found", "snapshot was not found")
          : sendApiError(reply, 404, "analysis_not_found", "analysis was not found");
      }

      return distributionResponseSchema.parse(result);
    } catch (error) {
      return sendApiError(reply, 400, "invalid_distribution_query", error);
    }
  });

  app.get("/api/ranking", async (request, reply) => {
    try {
      const parsed = rankingQuerySchema.parse(request.query);
      const result = await storage.query.queryRanking(parsed);
      if (!result) {
        const analysis = await storage.analysisJobs.getById(parsed.analysisId);
        return analysis
          ? sendApiError(reply, 404, "snapshot_not_found", "snapshot was not found")
          : sendApiError(reply, 404, "analysis_not_found", "analysis was not found");
      }

      return rankingResponseSchema.parse(result);
    } catch (error) {
      return sendApiError(reply, 400, "invalid_ranking_query", error);
    }
  });

  app.post("/api/analyses", async (request, reply) => {
    const payload = createAnalysisRequestSchema.parse(request.body);
    const repository = await storage.repositories.getById(payload.repositoryId);

    if (!repository) {
      return sendApiError(reply, 404, "repository_not_found", "repository was not found");
    }
    if (isRepositoryPendingDeletion(payload.repositoryId)) {
      return sendApiError(
        reply,
        409,
        "repository_deletion_in_progress",
        "repository deletion is already in progress",
      );
    }

    if (!repository.localPath) {
      return sendApiError(
        reply,
        400,
        "repository_source_unsupported",
        "only local repositories are supported right now",
      );
    }

    const existingDoneAnalysis = await storage.query.getLatestCompletedAnalysis(
      repository.id,
      payload.sampling,
    );
    if (existingDoneAnalysis) {
      return sendApiError(
        reply,
        409,
        "analysis_already_completed",
        `repository already has a completed ${payload.sampling} analysis: ${existingDoneAnalysis.id}`,
      );
    }

    const branch = payload.branch ?? repository.defaultBranch ?? "HEAD";
    const createdAt = new Date().toISOString();
    const analysisId = crypto.randomUUID();
    const initialRecord = analysisResultSchema.parse({
      job: {
        id: analysisId,
        repositoryId: repository.id,
        branch,
        sampling: payload.sampling,
        status: "pending",
        createdAt,
        finishedAt: null,
        errorMessage: null,
      },
      progress: {
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
        startedAt: createdAt,
        updatedAt: createdAt,
      },
      snapshots: [],
      points: [],
      candles: [],
    });

    await storage.analysisJobs.create(initialRecord.job);
    await storage.analysisJobs.upsertProgress(analysisId, initialRecord.progress);

    analysisScheduler.schedule({
      storage,
      analyzeRepositoryHistoryImpl,
      analysisPerformanceConfig,
      analysisId,
      repositoryId: repository.id,
      localPath: repository.localPath,
      branch,
      sampling: payload.sampling,
      detectedKinds: repository.detectedKinds,
      startedAt: createdAt,
    });

    return reply.code(202).send(initialRecord);
  });

  return app;
}

async function runAnalysisTask(input: {
  storage: SqliteStorage;
  analyzeRepositoryHistoryImpl: typeof analyzeRepositoryHistory;
  analysisPerformanceConfig?: AnalysisPerformanceConfig;
  abortSignal: AbortSignal;
  analysisId: string;
  repositoryId: string;
  localPath: string;
  branch: string;
  sampling: "daily" | "weekly" | "monthly" | "tag-based" | "per-commit";
  detectedKinds: Array<"rust" | "node" | "go" | "python" | "unknown">;
  startedAt: string;
}) {
  throwIfTaskAborted(input.abortSignal);
  await updateAnalysisJobStatusIfChanged(input.storage, input.analysisId, "running");
  await input.storage.analysisJobs.upsertProgress(input.analysisId, {
    phase: "validating",
    percent: 0,
    totalCommits: 0,
    sampledCommits: 0,
    completedSnapshots: 0,
    currentCommit: null,
    currentModule: null,
    currentFiles: null,
    processedFiles: null,
    etaSeconds: null,
    startedAt: input.startedAt,
    updatedAt: new Date().toISOString(),
  });

  try {
    const result = await input.analyzeRepositoryHistoryImpl({
      analysisId: input.analysisId,
      localPath: input.localPath,
      branch: input.branch,
      sampling: input.sampling,
      detectedKinds: input.detectedKinds,
      startedAt: input.startedAt,
      abortSignal: input.abortSignal,
      performance: input.analysisPerformanceConfig,
      onProgress: async (progress) => {
        throwIfTaskAborted(input.abortSignal);
        const nextStatus =
          progress.phase === "failed" ? "failed" : progress.phase === "done" ? "done" : "running";
        await updateAnalysisJobStatusIfChanged(input.storage, input.analysisId, nextStatus);
        await input.storage.analysisJobs.upsertProgress(input.analysisId, progress);
        throwIfTaskAborted(input.abortSignal);
      },
    });

    throwIfTaskAborted(input.abortSignal);
    await input.storage.persistence.replaceAnalysisResult({
      analysisId: input.analysisId,
      snapshots: result.snapshots,
      points: result.points,
      candles: result.candles,
    });

    const finishedAt = new Date().toISOString();
    await input.storage.analysisJobs.updateJob(input.analysisId, (current) =>
      current.status === "done" && current.finishedAt === finishedAt && current.errorMessage === null
        ? current
        : {
            ...current,
            status: "done",
            finishedAt,
            errorMessage: null,
          },
    );
    await input.storage.analysisJobs.upsertProgress(input.analysisId, {
      phase: "done",
      percent: 100,
      totalCommits: 0,
      sampledCommits: result.snapshots.length,
      completedSnapshots: result.snapshots.length,
      currentCommit: null,
      currentModule: null,
      currentFiles: null,
      processedFiles: null,
      etaSeconds: 0,
      startedAt: input.startedAt,
      updatedAt: finishedAt,
    });
  } catch (error) {
    if (isTaskAbortError(error)) {
      return;
    }

    const finishedAt = new Date().toISOString();
    await input.storage.analysisJobs.updateJob(input.analysisId, (current) => ({
      ...current,
      status: "failed",
      finishedAt,
      errorMessage: error instanceof Error ? error.message : "unknown error",
    }));

    const current = await input.storage.query.getAnalysisResult(input.analysisId);
    await input.storage.analysisJobs.upsertProgress(input.analysisId, {
      phase: "failed",
      percent: current?.progress.percent ?? 0,
      totalCommits: current?.progress.totalCommits ?? 0,
      sampledCommits: current?.progress.sampledCommits ?? 0,
      completedSnapshots: current?.progress.completedSnapshots ?? 0,
      currentCommit: null,
      currentModule: null,
      currentFiles: null,
      processedFiles: null,
      etaSeconds: null,
      startedAt: input.startedAt,
      updatedAt: finishedAt,
    });
  }
}

function createAnalysisScheduler(input: {
  config: AnalysisSchedulerConfig;
}) {
  const tasksById = new Map<string, AnalysisSchedulerTask>();
  const queuedTaskIds: string[] = [];
  const activeByRepository = new Map<string, number>();
  let activeCount = 0;
  let closed = false;
  let draining = false;
  let drainRequested = false;

  function schedule(taskInput: Omit<Parameters<typeof runAnalysisTask>[0], "abortSignal">) {
    if (closed) {
      return;
    }

    const controller = new AbortController();
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });

    const task: AnalysisSchedulerTask = {
      analysisId: taskInput.analysisId,
      repositoryId: taskInput.repositoryId,
      controller,
      promise,
      resolve,
      reject,
      state: "queued",
      input: taskInput,
    };

    tasksById.set(task.analysisId, task);
    queuedTaskIds.push(task.analysisId);
    void drainQueue();
  }

  async function cancelRepository(repositoryId: string) {
    const tasks = Array.from(tasksById.values()).filter(
      (task) => task.repositoryId === repositoryId,
    );

    for (const task of tasks) {
      task.controller.abort();
      if (task.state === "queued") {
        removeQueuedTask(task.analysisId);
        settleTaskAsAborted(task);
        tasksById.delete(task.analysisId);
      }
    }

    await Promise.all(tasks.map((task) => task.promise.catch(() => undefined)));
    void drainQueue();
  }

  async function close() {
    if (closed) {
      return;
    }

    closed = true;

    const tasks = Array.from(tasksById.values());
    for (const task of tasks) {
      task.controller.abort();
      if (task.state === "queued") {
        removeQueuedTask(task.analysisId);
        settleTaskAsAborted(task);
        tasksById.delete(task.analysisId);
      }
    }

    await Promise.all(tasks.map((task) => task.promise.catch(() => undefined)));
  }

  async function drainQueue() {
    if (closed) {
      return;
    }

    if (draining) {
      drainRequested = true;
      return;
    }

    draining = true;
    try {
      while (!closed) {
        const nextTask = pickNextRunnableTask();
        if (!nextTask) {
          break;
        }

        startTask(nextTask);
      }
    } finally {
      draining = false;
      if (drainRequested) {
        drainRequested = false;
        void drainQueue();
      }
    }
  }

  function pickNextRunnableTask() {
    for (let index = 0; index < queuedTaskIds.length; index += 1) {
      const taskId = queuedTaskIds[index];
      if (!taskId) {
        continue;
      }

      const task = tasksById.get(taskId);
      if (!task) {
        queuedTaskIds.splice(index, 1);
        index -= 1;
        continue;
      }

      const repositoryActiveCount = activeByRepository.get(task.repositoryId) ?? 0;
      if (activeCount >= input.config.maxConcurrentAnalyses) {
        return null;
      }
      if (repositoryActiveCount >= input.config.maxConcurrentAnalysesPerRepository) {
        continue;
      }

      queuedTaskIds.splice(index, 1);
      return task;
    }

    return null;
  }

  function startTask(task: AnalysisSchedulerTask) {
    if (closed) {
      settleTaskAsAborted(task);
      tasksById.delete(task.analysisId);
      return;
    }

    task.state = "running";
    activeCount += 1;
    activeByRepository.set(task.repositoryId, (activeByRepository.get(task.repositoryId) ?? 0) + 1);

    void runTask(task);
  }

  async function runTask(task: AnalysisSchedulerTask) {
    try {
      await runAnalysisTask({
        ...task.input,
        abortSignal: task.controller.signal,
      });
      task.resolve();
    } catch (error) {
      if (isTaskAbortError(error)) {
        task.resolve();
      } else {
        task.reject(error);
      }
    } finally {
      activeCount -= 1;
      const repositoryActiveCount = (activeByRepository.get(task.repositoryId) ?? 1) - 1;
      if (repositoryActiveCount > 0) {
        activeByRepository.set(task.repositoryId, repositoryActiveCount);
      } else {
        activeByRepository.delete(task.repositoryId);
      }
      tasksById.delete(task.analysisId);
      void drainQueue();
    }
  }

  function removeQueuedTask(analysisId: string) {
    const index = queuedTaskIds.indexOf(analysisId);
    if (index >= 0) {
      queuedTaskIds.splice(index, 1);
    }
  }

  function settleTaskAsAborted(task: AnalysisSchedulerTask) {
    task.reject(new AnalysisAbortedError());
  }

  return {
    schedule,
    cancelRepository,
    close,
  };
}

async function resumeInterruptedAnalyses(input: {
  app: FastifyInstance;
  analysisScheduler: ReturnType<typeof createAnalysisScheduler>;
  storage: SqliteStorage;
  analyzeRepositoryHistoryImpl: typeof analyzeRepositoryHistory;
  analysisPerformanceConfig?: AnalysisPerformanceConfig;
}) {
  const summaries = await input.storage.query.listAnalysisSummaries();
  const interrupted = summaries.filter(
    (summary) => summary.job.status === "pending" || summary.job.status === "running",
  );

  for (const summary of interrupted) {
    const repository = await input.storage.repositories.getById(summary.job.repositoryId);

    if (!repository) {
      await markAnalysisAsFailed(
        input.storage,
        summary.job.id,
        summary.progress.startedAt,
        "repository was not found during recovery",
      );
      input.app.log.warn(
        { analysisId: summary.job.id, repositoryId: summary.job.repositoryId },
        "failed to recover analysis because repository is missing",
      );
      continue;
    }

    if (!repository.localPath) {
      await markAnalysisAsFailed(
        input.storage,
        summary.job.id,
        summary.progress.startedAt,
        "only local repositories are supported right now",
      );
      input.app.log.warn(
        { analysisId: summary.job.id, repositoryId: summary.job.repositoryId },
        "failed to recover analysis because repository source is unsupported",
      );
      continue;
    }

    input.app.log.info(
      { analysisId: summary.job.id, repositoryId: summary.job.repositoryId },
      "resuming interrupted analysis after server restart",
    );

    input.analysisScheduler.schedule({
      storage: input.storage,
      analyzeRepositoryHistoryImpl: input.analyzeRepositoryHistoryImpl,
      analysisPerformanceConfig: input.analysisPerformanceConfig,
      analysisId: summary.job.id,
      repositoryId: summary.job.repositoryId,
      localPath: repository.localPath,
      branch: summary.job.branch,
      sampling: summary.job.sampling,
      detectedKinds: repository.detectedKinds,
      startedAt: summary.progress.startedAt,
    });
  }
}

function throwIfTaskAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new AnalysisAbortedError();
  }
}

function isTaskAbortError(error: unknown) {
  return error instanceof AnalysisAbortedError;
}

async function markAnalysisAsFailed(
  storage: SqliteStorage,
  analysisId: string,
  startedAt: string,
  message: string,
) {
  const finishedAt = new Date().toISOString();
  const current = await storage.query.getAnalysisSummary(analysisId);

  await storage.analysisJobs.updateJob(analysisId, (job) => ({
    ...job,
    status: "failed",
    finishedAt,
    errorMessage: message,
  }));
  await storage.analysisJobs.upsertProgress(analysisId, {
    phase: "failed",
    percent: current?.progress.percent ?? 0,
    totalCommits: current?.progress.totalCommits ?? 0,
    sampledCommits: current?.progress.sampledCommits ?? 0,
    completedSnapshots: current?.progress.completedSnapshots ?? 0,
    currentCommit: null,
    currentModule: null,
    currentFiles: null,
    processedFiles: null,
    etaSeconds: null,
    startedAt,
    updatedAt: finishedAt,
  });
}

async function updateAnalysisJobStatusIfChanged(
  storage: SqliteStorage,
  analysisId: string,
  status: "pending" | "running" | "done" | "failed",
) {
  await storage.analysisJobs.updateJob(analysisId, (current) =>
    current.status === status
      ? current
      : {
          ...current,
          status,
        },
  );
}

async function readRepositoryHead(localPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      localPath,
      "rev-parse",
      "HEAD",
    ]);
    const head = stdout.trim();
    return head.length > 0 ? head : null;
  } catch {
    return null;
  }
}

async function createRepositoryModulesCacheKey(
  localPath: string,
  detectedKinds: Array<"rust" | "node" | "go" | "python" | "unknown">,
  readRepositoryHeadImpl: typeof readRepositoryHead,
) {
  const head = await readRepositoryHeadImpl(localPath);
  return [localPath, head ?? "no-head", detectedKinds.join(","), "modules"].join("\u0000");
}

function normalizeAnalysisSchedulerConfig(
  config: Partial<AnalysisSchedulerConfig> | undefined,
): AnalysisSchedulerConfig {
  const maxConcurrentAnalyses = normalizePositiveInteger(config?.maxConcurrentAnalyses, 2);
  const maxConcurrentAnalysesPerRepository = Math.min(
    normalizePositiveInteger(config?.maxConcurrentAnalysesPerRepository, 1),
    maxConcurrentAnalyses,
  );

  return {
    maxConcurrentAnalyses,
    maxConcurrentAnalysesPerRepository,
  };
}

function readAnalysisPerformanceConfigFromEnv(
  env: NodeJS.ProcessEnv,
): Partial<AnalysisPerformanceConfig> | undefined {
  const config = {
    fileReadConcurrency: readIntegerEnv(env.CODE_DANCE_ANALYZER_FILE_READ_CONCURRENCY),
    analyzerConcurrency: readIntegerEnv(env.CODE_DANCE_ANALYZER_CONCURRENCY),
    snapshotConcurrency: readIntegerEnv(env.CODE_DANCE_ANALYZER_SNAPSHOT_CONCURRENCY),
    progressThrottleMs: readIntegerEnv(env.CODE_DANCE_ANALYZER_PROGRESS_THROTTLE_MS),
  };

  return Object.values(config).some((value) => value !== undefined) ? config : undefined;
}

function normalizeAnalysisPerformanceConfig(
  config: Partial<AnalysisPerformanceConfig> | undefined,
): AnalysisPerformanceConfig {
  return {
    fileReadConcurrency: normalizePositiveInteger(
      config?.fileReadConcurrency,
      DEFAULT_ANALYSIS_PERFORMANCE_CONFIG.fileReadConcurrency,
    ),
    analyzerConcurrency: normalizePositiveInteger(
      config?.analyzerConcurrency,
      DEFAULT_ANALYSIS_PERFORMANCE_CONFIG.analyzerConcurrency,
    ),
    snapshotConcurrency: normalizePositiveInteger(
      config?.snapshotConcurrency,
      DEFAULT_ANALYSIS_PERFORMANCE_CONFIG.snapshotConcurrency,
    ),
    progressThrottleMs: normalizeNonNegativeInteger(
      config?.progressThrottleMs,
      DEFAULT_ANALYSIS_PERFORMANCE_CONFIG.progressThrottleMs,
    ),
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}

function readIntegerEnv(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sendApiError(
  reply: {
    code: (statusCode: number) => {
      send: (payload: { error: string; message: string }) => unknown;
    };
  },
  statusCode: number,
  error: string,
  message: unknown,
) {
  return reply.code(statusCode).send({
    error,
    message: message instanceof Error ? message.message : String(message),
  });
}
