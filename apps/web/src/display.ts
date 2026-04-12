import type {
  AnalysisProgressDto,
  AnalysisSamplingDto,
  ModuleUnitDto,
  RepositoryTargetDto,
} from "@code-dance/contracts";

import { formatNumberValue, translate } from "./i18n";

export function formatMetricLabel(metric: "loc" | "added" | "deleted" | "churn") {
  return translate(`metric.${metric}`);
}

export function formatSamplingLabel(sampling: AnalysisSamplingDto) {
  return translate(`sampling.${sampling}`);
}

export function formatRepositoryStatus(status: RepositoryTargetDto["status"] | "analyzed") {
  return translate(`status.${status}`);
}

export function formatAnalysisStatus(
  status: "pending" | "running" | "done" | "failed",
) {
  return translate(`status.${status}`);
}

export function formatProgressPhase(phase: AnalysisProgressDto["phase"]) {
  return translate(`progress.phase.${phase}`);
}

export function formatModuleSource(source: ModuleUnitDto["source"]) {
  return translate(`status.${source}`);
}

export function formatRepositoryKind(kind: RepositoryTargetDto["detectedKinds"][number]) {
  return kind;
}

export function formatRemainingTime(etaSeconds: number | null) {
  if (etaSeconds === null || !Number.isFinite(etaSeconds) || etaSeconds < 0) {
    return "-";
  }

  if (etaSeconds < 60) {
    return `${formatNumberValue(Math.round(etaSeconds))}s`;
  }

  if (etaSeconds < 3600) {
    const minutes = Math.floor(etaSeconds / 60);
    const seconds = Math.round(etaSeconds % 60);
    return seconds > 0 ? `${formatNumberValue(minutes)}m ${formatNumberValue(seconds)}s` : `${formatNumberValue(minutes)}m`;
  }

  const hours = Math.floor(etaSeconds / 3600);
  const minutes = Math.floor((etaSeconds % 3600) / 60);
  return minutes > 0 ? `${formatNumberValue(hours)}h ${formatNumberValue(minutes)}m` : `${formatNumberValue(hours)}h`;
}
