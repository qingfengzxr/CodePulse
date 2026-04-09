export type RepositorySourceType = "local-path" | "git-url";

export type RepositoryKind = "rust" | "node" | "go" | "python" | "unknown";

export type RepositoryStatus = "ready" | "invalid" | "syncing";

export type RepositoryTarget = {
  id: string;
  name: string;
  sourceType: RepositorySourceType;
  localPath: string | null;
  remoteUrl: string | null;
  defaultBranch: string | null;
  detectedKinds: RepositoryKind[];
  status: RepositoryStatus;
  createdAt: string;
};

export type AnalysisSampling = "daily" | "weekly" | "monthly" | "tag-based" | "per-commit";

export type AnalysisJobStatus = "pending" | "running" | "done" | "failed";

export type AnalysisPhase =
  | "pending"
  | "validating"
  | "scanning-history"
  | "sampling"
  | "analyzing-snapshots"
  | "persisting"
  | "done"
  | "failed";

export type AnalysisJob = {
  id: string;
  repositoryId: string;
  branch: string;
  sampling: AnalysisSampling;
  status: AnalysisJobStatus;
  createdAt: string;
  finishedAt?: string | null;
  errorMessage?: string | null;
};

export type AnalysisProgress = {
  phase: AnalysisPhase;
  percent: number;
  totalCommits: number;
  sampledCommits: number;
  completedSnapshots: number;
  currentCommit: string | null;
  currentModule: string | null;
  currentFiles: number | null;
  processedFiles: number | null;
  etaSeconds: number | null;
  startedAt: string;
  updatedAt: string;
};

export type Snapshot = {
  analysisId: string;
  commit: string;
  ts: string;
};

export type ModuleUnit = {
  key: string;
  name: string;
  kind: string;
  rootPath: string;
  files: string[];
  source: "auto" | "manual";
};

export type ModuleDetectionResult = {
  repositoryId: string;
  modules: ModuleUnit[];
};

export type MetricPoint = {
  analysisId: string;
  ts: string;
  commit: string;
  moduleKey: string;
  moduleName: string;
  moduleKind: string;
  loc: number;
  added: number;
  deleted: number;
  churn: number;
};

export type ModuleCandlePoint = {
  analysisId: string;
  ts: string;
  commit: string;
  moduleKey: string;
  moduleName: string;
  moduleKind: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type AnalysisResult = {
  job: AnalysisJob;
  progress: AnalysisProgress;
  snapshots: Snapshot[];
  points: MetricPoint[];
  candles: ModuleCandlePoint[];
};
