import type {
  AnalysisProgress,
  AnalysisSampling,
  MetricPoint,
  RepositoryKind,
  Snapshot,
} from "@code-dance/domain";

export type AnalyzeRepositoryHistoryInput = {
  analysisId: string;
  localPath: string;
  branch: string;
  sampling: AnalysisSampling;
  detectedKinds: RepositoryKind[];
  startedAt: string;
  onProgress?: (progress: AnalysisProgress) => void | Promise<void>;
  // Test-only hook for forcing analyzer outputs without touching the filesystem.
  __testOverrides?: Partial<Record<
    "rust" | "node",
    (input: AnalyzeRepositoryHistoryInput) => Promise<AnalyzeRepositoryHistoryOutput>
  >>;
};

export type AnalyzeRepositoryHistoryOutput = {
  snapshots: Snapshot[];
  points: MetricPoint[];
};
