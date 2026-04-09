import type { AnalysisResultDto, AnalysisSummaryDto } from "@code-dance/contracts";

type ProgressBarProps = {
  analysis: Pick<AnalysisResultDto, "job" | "progress"> | AnalysisSummaryDto;
};

function formatRemainingTime(etaSeconds: number | null) {
  if (etaSeconds === null || !Number.isFinite(etaSeconds) || etaSeconds < 0) {
    return "-";
  }

  if (etaSeconds < 60) {
    return `${Math.round(etaSeconds)} 秒`;
  }

  if (etaSeconds < 3600) {
    const minutes = Math.floor(etaSeconds / 60);
    const seconds = Math.round(etaSeconds % 60);
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  }

  const hours = Math.floor(etaSeconds / 3600);
  const minutes = Math.floor((etaSeconds % 3600) / 60);
  return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

export function ProgressBar({ analysis }: ProgressBarProps) {
  return (
    <div className="progress-block">
      <div className="progress-meta">
        <span>
          {analysis.progress.phase} · {analysis.progress.percent.toFixed(1)}%
        </span>
        <span>
          {analysis.progress.completedSnapshots}/{analysis.progress.sampledCommits || 0} 快照
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
          当前提交：
          {analysis.progress.currentCommit ? analysis.progress.currentCommit.slice(0, 8) : "-"}
        </span>
        <span>当前模块：{analysis.progress.currentModule ?? "-"}</span>
        <span>
          文件：{analysis.progress.processedFiles ?? 0}/{analysis.progress.currentFiles ?? 0}
        </span>
        <span>剩余时间：{formatRemainingTime(analysis.progress.etaSeconds)}</span>
      </div>
    </div>
  );
}
