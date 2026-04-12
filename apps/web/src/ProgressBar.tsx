import type { AnalysisResultDto, AnalysisSummaryDto } from "@code-dance/contracts";

import { formatProgressPhase, formatRemainingTime } from "./display";
import { useI18n } from "./i18n";

type ProgressBarProps = {
  analysis: Pick<AnalysisResultDto, "job" | "progress"> | AnalysisSummaryDto;
};

export function ProgressBar({ analysis }: ProgressBarProps) {
  const { t, formatNumber } = useI18n();

  return (
    <div className="progress-block">
      <div className="progress-meta">
        <span>
          {formatProgressPhase(analysis.progress.phase)} · {analysis.progress.percent.toFixed(1)}%
        </span>
        <span>
          {formatNumber(analysis.progress.completedSnapshots)}/
          {formatNumber(analysis.progress.sampledCommits || 0)} {t("label.snapshots")}
        </span>
      </div>
      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{
            width: `${analysis.progress.percent}%`,
          }}
        />
      </div>
      <div className="progress-detail">
        <span>
          {t("label.currentCommit")}:
          {analysis.progress.currentCommit ? analysis.progress.currentCommit.slice(0, 8) : "-"}
        </span>
        <span>
          {t("label.currentModule")}:
          {analysis.progress.currentModule ?? "-"}
        </span>
        <span>
          {t("label.files")}:
          {formatNumber(analysis.progress.processedFiles ?? 0)}/
          {formatNumber(analysis.progress.currentFiles ?? 0)}
        </span>
        <span>
          {t("label.remainingTime")}:
          {formatRemainingTime(analysis.progress.etaSeconds)}
        </span>
      </div>
    </div>
  );
}
