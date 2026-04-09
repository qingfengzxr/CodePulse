import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { realpath } from "node:fs/promises";

import {
  analysisSummarySchema,
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
} from "@code-dance/contracts";
import {
  AnalysisAbortedError,
  analyzeRepositoryHistory,
  detectRepositoryModules,
} from "@code-dance/analyzer";
import { probeLocalRepository } from "@code-dance/git";
import { createSqliteStorage, defaultDatabasePath, type SqliteStorage } from "@code-dance/storage";

type CreateServerDeps = {
  storage?: SqliteStorage;
  analyzeRepositoryHistoryImpl?: typeof analyzeRepositoryHistory;
  detectRepositoryModulesImpl?: typeof detectRepositoryModules;
  probeLocalRepositoryImpl?: typeof probeLocalRepository;
};

export function createServer(deps: CreateServerDeps = {}) {
  const storage = deps.storage ?? createSqliteStorage({ dbPath: process.env.CODE_DANCE_DB_PATH });
  const analyzeRepositoryHistoryImpl =
    deps.analyzeRepositoryHistoryImpl ?? analyzeRepositoryHistory;
  const detectRepositoryModulesImpl = deps.detectRepositoryModulesImpl ?? detectRepositoryModules;
  const probeLocalRepositoryImpl = deps.probeLocalRepositoryImpl ?? probeLocalRepository;
  const activeAnalysisTasks = new Map<
    string,
    { controller: AbortController; repositoryId: string; promise: Promise<void> }
  >();

  const app = Fastify({
    logger: true,
  });

  app.register(cors, {
    origin: true,
  });

  app.addHook("onReady", async () => {
    await resumeInterruptedAnalyses({
      app,
      activeAnalysisTasks,
      storage,
      analyzeRepositoryHistoryImpl,
    });
  });

  app.addHook("onClose", async () => {
    await Promise.all(
      Array.from(activeAnalysisTasks.values(), (task) => {
        task.controller.abort();
        return task.promise.catch(() => undefined);
      }),
    );
    storage.close();
  });

  app.get("/api/health", async () => {
    return {
      ok: true,
      service: "code-dance-api",
      dbPath: storage.dbPath ?? defaultDatabasePath(),
    };
  });

  app.get("/api/repositories", async () => {
    const repositories = await storage.repositories.list();
    return repositories.map((repository) => repositoryTargetSchema.parse(repository));
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

    await cancelAnalysesForRepository(activeAnalysisTasks, params.id);

    await storage.repositories.deleteById(params.id);
    return reply.code(204).send();
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

    if (!repository.localPath) {
      return sendApiError(
        reply,
        400,
        "repository_source_unsupported",
        "only local repositories are supported right now",
      );
    }

    try {
      const modules = await detectRepositoryModulesImpl({
        localPath: repository.localPath,
        detectedKinds: repository.detectedKinds,
      });

      return repositoryModulesResponseSchema.parse({
        repositoryId: repository.id,
        modules,
      });
    } catch (error) {
      return sendApiError(reply, 400, "module_detection_failed", error);
    }
  });

  app.get("/api/analyses", async () => {
    const analyses = await storage.query.listAnalysisResults();
    return analyses.map((analysis) => analysisResultSchema.parse(analysis));
  });

  app.get("/api/analysis-summaries", async () => {
    const summaries = await storage.query.listAnalysisSummaries();
    return summaries.map((summary) => analysisSummarySchema.parse(summary));
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
        moduleKeys?: string;
      };
      const parsed = seriesQuerySchema.parse({
        analysisId: raw.analysisId,
        metric: raw.metric,
        moduleKeys: raw.moduleKeys
          ? raw.moduleKeys
              .split(",")
              .map((moduleKey) => moduleKey.trim())
              .filter(Boolean)
          : [],
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
        moduleKeys?: string;
      };
      const parsed = candlesQuerySchema.parse({
        analysisId: raw.analysisId,
        moduleKeys: raw.moduleKeys
          ? raw.moduleKeys
              .split(",")
              .map((moduleKey) => moduleKey.trim())
              .filter(Boolean)
          : [],
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

    if (!repository.localPath) {
      return sendApiError(
        reply,
        400,
        "repository_source_unsupported",
        "only local repositories are supported right now",
      );
    }

    const existingDoneAnalysis = (await storage.query.listAnalysisSummaries()).find(
      (summary) =>
        summary.job.repositoryId === repository.id &&
        summary.job.sampling === payload.sampling &&
        summary.job.status === "done",
    );
    if (existingDoneAnalysis) {
      return sendApiError(
        reply,
        409,
        "analysis_already_completed",
        `repository already has a completed ${payload.sampling} analysis: ${existingDoneAnalysis.job.id}`,
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

    registerAnalysisTask(activeAnalysisTasks, {
      storage,
      analyzeRepositoryHistoryImpl,
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
  await input.storage.analysisJobs.updateJob(input.analysisId, (current) => ({
    ...current,
    status: "running",
  }));
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
      onProgress: async (progress) => {
        throwIfTaskAborted(input.abortSignal);
        await input.storage.analysisJobs.updateJob(input.analysisId, (current) => ({
          ...current,
          status:
            progress.phase === "failed" ? "failed" : progress.phase === "done" ? "done" : "running",
        }));
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
    await input.storage.analysisJobs.updateJob(input.analysisId, (current) => ({
      ...current,
      status: "done",
      finishedAt,
      errorMessage: null,
    }));
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

async function resumeInterruptedAnalyses(input: {
  app: FastifyInstance;
  activeAnalysisTasks: Map<
    string,
    { controller: AbortController; repositoryId: string; promise: Promise<void> }
  >;
  storage: SqliteStorage;
  analyzeRepositoryHistoryImpl: typeof analyzeRepositoryHistory;
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

    registerAnalysisTask(input.activeAnalysisTasks, {
      storage: input.storage,
      analyzeRepositoryHistoryImpl: input.analyzeRepositoryHistoryImpl,
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

function registerAnalysisTask(
  activeAnalysisTasks: Map<
    string,
    { controller: AbortController; repositoryId: string; promise: Promise<void> }
  >,
  input: Omit<Parameters<typeof runAnalysisTask>[0], "abortSignal">,
) {
  const controller = new AbortController();
  const promise = runAnalysisTask({
    ...input,
    abortSignal: controller.signal,
  }).finally(() => {
    activeAnalysisTasks.delete(input.analysisId);
  });

  activeAnalysisTasks.set(input.analysisId, {
    controller,
    repositoryId: input.repositoryId,
    promise,
  });
}

async function cancelAnalysesForRepository(
  activeAnalysisTasks: Map<
    string,
    { controller: AbortController; repositoryId: string; promise: Promise<void> }
  >,
  repositoryId: string,
) {
  const tasks = Array.from(activeAnalysisTasks.values()).filter(
    (task) => task.repositoryId === repositoryId,
  );

  for (const task of tasks) {
    task.controller.abort();
  }

  await Promise.all(tasks.map((task) => task.promise.catch(() => undefined)));
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
  const current = await storage.query.getAnalysisResult(analysisId);

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
