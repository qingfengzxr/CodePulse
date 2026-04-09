import { z } from "zod";

export const repositoryKindSchema = z.enum([
  "rust",
  "node",
  "go",
  "python",
  "unknown",
]);

export const repositoryStatusSchema = z.enum(["ready", "invalid", "syncing"]);

export const repositorySourceTypeSchema = z.enum(["local-path", "git-url"]);
export const analysisSamplingSchema = z.enum([
  "daily",
  "weekly",
  "monthly",
  "tag-based",
  "per-commit",
]);
export const analysisMetricSchema = z.enum(["loc", "added", "deleted", "churn"]);

export const repositoryTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  sourceType: repositorySourceTypeSchema,
  localPath: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  detectedKinds: z.array(repositoryKindSchema),
  status: repositoryStatusSchema,
  createdAt: z.string(),
});

export const createLocalRepositoryRequestSchema = z.object({
  sourceType: z.literal("local-path"),
  localPath: z.string().min(1, "localPath is required"),
});

export const moduleUnitSchema = z.object({
  key: z.string(),
  name: z.string(),
  kind: z.string(),
  rootPath: z.string(),
  files: z.array(z.string()),
  source: z.enum(["auto", "manual"]),
});

export const repositoryModulesResponseSchema = z.object({
  repositoryId: z.string(),
  modules: z.array(moduleUnitSchema),
});

export const analysisJobSchema = z.object({
  id: z.string(),
  repositoryId: z.string(),
  branch: z.string(),
  sampling: analysisSamplingSchema,
  status: z.enum(["pending", "running", "done", "failed"]),
  createdAt: z.string(),
  finishedAt: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
});

export const analysisProgressSchema = z.object({
  phase: z.enum([
    "pending",
    "validating",
    "scanning-history",
    "sampling",
    "analyzing-snapshots",
    "persisting",
    "done",
    "failed",
  ]),
  percent: z.number(),
  totalCommits: z.number(),
  sampledCommits: z.number(),
  completedSnapshots: z.number(),
  currentCommit: z.string().nullable(),
  currentModule: z.string().nullable(),
  currentFiles: z.number().nullable(),
  processedFiles: z.number().nullable(),
  etaSeconds: z.number().nullable(),
  startedAt: z.string(),
  updatedAt: z.string(),
});

export const snapshotSchema = z.object({
  analysisId: z.string(),
  commit: z.string(),
  ts: z.string(),
});

export const snapshotSummarySchema = z.object({
  seq: z.number().int().positive(),
  commit: z.string(),
  ts: z.string(),
});

export const metricPointSchema = z.object({
  analysisId: z.string(),
  ts: z.string(),
  commit: z.string(),
  moduleKey: z.string(),
  moduleName: z.string(),
  moduleKind: z.string(),
  loc: z.number(),
  added: z.number(),
  deleted: z.number(),
  churn: z.number(),
});

export const createAnalysisRequestSchema = z.object({
  repositoryId: z.string().min(1),
  branch: z.string().min(1).optional(),
  sampling: analysisSamplingSchema.default("weekly"),
});

export const analysisModuleSummarySchema = z.object({
  key: z.string(),
  name: z.string(),
  kind: z.string(),
});

export const seriesQuerySchema = z.object({
  analysisId: z.string().min(1),
  metric: analysisMetricSchema,
  moduleKeys: z.array(z.string().min(1)).default([]),
});

export const seriesModuleSchema = z.object({
  moduleKey: z.string(),
  moduleName: z.string(),
  moduleKind: z.string(),
  values: z.array(z.number()),
});

export const seriesResponseSchema = z.object({
  analysisId: z.string(),
  metric: analysisMetricSchema,
  timeline: z.array(snapshotSummarySchema),
  series: z.array(seriesModuleSchema),
});

export const distributionQuerySchema = z.object({
  analysisId: z.string().min(1),
  metric: analysisMetricSchema,
  snapshot: z.union([z.literal("latest"), z.coerce.number().int().positive()]),
});

export const distributionItemSchema = z.object({
  moduleKey: z.string(),
  moduleName: z.string(),
  moduleKind: z.string(),
  value: z.number(),
});

export const distributionResponseSchema = z.object({
  analysisId: z.string(),
  metric: analysisMetricSchema,
  snapshot: snapshotSummarySchema,
  items: z.array(distributionItemSchema),
});

export const rankingQuerySchema = z.object({
  analysisId: z.string().min(1),
  metric: analysisMetricSchema,
  snapshot: z.union([z.literal("latest"), z.coerce.number().int().positive()]),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const rankingItemSchema = distributionItemSchema;

export const rankingResponseSchema = z.object({
  analysisId: z.string(),
  metric: analysisMetricSchema,
  snapshot: snapshotSummarySchema,
  limit: z.number().int().positive(),
  items: z.array(rankingItemSchema),
});

export const analysisResultSchema = z.object({
  job: analysisJobSchema,
  progress: analysisProgressSchema,
  snapshots: z.array(snapshotSchema),
  points: z.array(metricPointSchema),
});

export const analysisSummarySchema = z.object({
  job: analysisJobSchema,
  progress: analysisProgressSchema,
  snapshotCount: z.number().int().nonnegative(),
  latestSnapshot: snapshotSummarySchema.nullable(),
});

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

export type RepositoryTargetDto = z.infer<typeof repositoryTargetSchema>;
export type CreateLocalRepositoryRequest = z.infer<
  typeof createLocalRepositoryRequestSchema
>;
export type ModuleUnitDto = z.infer<typeof moduleUnitSchema>;
export type RepositoryModulesResponseDto = z.infer<
  typeof repositoryModulesResponseSchema
>;
export type AnalysisJobDto = z.infer<typeof analysisJobSchema>;
export type SnapshotDto = z.infer<typeof snapshotSchema>;
export type SnapshotSummaryDto = z.infer<typeof snapshotSummarySchema>;
export type MetricPointDto = z.infer<typeof metricPointSchema>;
export type AnalysisProgressDto = z.infer<typeof analysisProgressSchema>;
export type AnalysisSamplingDto = z.infer<typeof analysisSamplingSchema>;
export type CreateAnalysisRequestDto = z.infer<
  typeof createAnalysisRequestSchema
>;
export type AnalysisMetricDto = z.infer<typeof analysisMetricSchema>;
export type AnalysisModuleSummaryDto = z.infer<
  typeof analysisModuleSummarySchema
>;
export type SeriesQueryDto = z.infer<typeof seriesQuerySchema>;
export type SeriesModuleDto = z.infer<typeof seriesModuleSchema>;
export type SeriesResponseDto = z.infer<typeof seriesResponseSchema>;
export type DistributionQueryDto = z.infer<typeof distributionQuerySchema>;
export type DistributionItemDto = z.infer<typeof distributionItemSchema>;
export type DistributionResponseDto = z.infer<
  typeof distributionResponseSchema
>;
export type RankingQueryDto = z.infer<typeof rankingQuerySchema>;
export type RankingItemDto = z.infer<typeof rankingItemSchema>;
export type RankingResponseDto = z.infer<typeof rankingResponseSchema>;
export type AnalysisResultDto = z.infer<typeof analysisResultSchema>;
export type AnalysisSummaryDto = z.infer<typeof analysisSummarySchema>;
export type ApiErrorDto = z.infer<typeof apiErrorSchema>;
