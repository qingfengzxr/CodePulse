import type { FormEvent } from "react";
import { Link } from "react-router-dom";

import type {
  AnalysisResultDto,
  AnalysisSamplingDto,
  AnalysisSummaryDto,
  ModuleUnitDto,
  RepositoryTargetDto,
} from "@code-dance/contracts";
import { ProgressBar } from "./ProgressBar";
import { getSamplingLabel, samplingOptions } from "./sampling";

type RepositoryListPageProps = {
  analysesByRepositoryAndSampling: Record<string, AnalysisSummaryDto | undefined>;
  analysisLoading: Record<string, boolean>;
  deleteLoading: Record<string, boolean>;
  error: string | null;
  loading: boolean;
  localPath: string;
  moduleLoading: Record<string, boolean>;
  moduleResults: Record<string, ModuleUnitDto[] | undefined>;
  onDeleteRepository: (repository: RepositoryTargetDto) => Promise<void> | void;
  onLoadModules: (repositoryId: string) => Promise<void> | void;
  onRefreshWorkspace: () => Promise<void> | void;
  onRunAnalysis: (
    repository: RepositoryTargetDto,
    sampling?: AnalysisSamplingDto,
  ) => Promise<AnalysisResultDto | null> | AnalysisResultDto | null | void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
  onUpdateSampling: (repositoryId: string, sampling: AnalysisSamplingDto) => void;
  onUpdateLocalPath: (value: string) => void;
  repositories: RepositoryTargetDto[];
  selectedSamplingByRepository: Record<string, AnalysisSamplingDto | undefined>;
  submitting: boolean;
};

export function RepositoryListPage({
  analysesByRepositoryAndSampling,
  analysisLoading,
  deleteLoading,
  error,
  loading,
  localPath,
  moduleLoading,
  moduleResults,
  onDeleteRepository,
  onLoadModules,
  onRefreshWorkspace,
  onRunAnalysis,
  onSubmit,
  onUpdateSampling,
  onUpdateLocalPath,
  repositories,
  selectedSamplingByRepository,
  submitting,
}: RepositoryListPageProps) {
  const allAnalyses = Object.values(analysesByRepositoryAndSampling).filter(
    (analysis): analysis is AnalysisSummaryDto => Boolean(analysis),
  );
  const analysisCount = allAnalyses.length;
  const activeAnalyses = allAnalyses.filter(
    (analysis) => analysis.job.status === "pending" || analysis.job.status === "running",
  ).length;
  const completedAnalyses = allAnalyses.filter((analysis) => analysis.job.status === "done").length;
  const latestActivity = allAnalyses
    .map((analysis) => analysis.latestSnapshot?.ts?.slice(0, 10))
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <main className="page-grid">
      <section className="surface-section workspace-summary">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Overview</p>
            <h2>今天的工作台状态</h2>
            <p className="section-description">先判断仓库规模、任务进度和最近活动，再进入具体仓库执行操作。</p>
          </div>
        </div>

        <div className="summary-grid">
          <article className="summary-card">
            <span>仓库数</span>
            <strong>{repositories.length}</strong>
            <p>已接入到当前工作区的本地 Git 仓库。</p>
          </article>
          <article className="summary-card">
            <span>运行任务</span>
            <strong>{activeAnalyses}</strong>
            <p>仍在分析中的任务会自动轮询刷新状态。</p>
          </article>
          <article className="summary-card">
            <span>已完成分析</span>
            <strong>{completedAnalyses}</strong>
            <p>完成后可直接进入详情页查看图表。</p>
          </article>
          <article className="summary-card">
            <span>最近活动</span>
            <strong>{latestActivity ?? "-"}</strong>
            <p>最近一次产生采样结果的日期。</p>
          </article>
        </div>
      </section>

      <section className="surface-section intake-section">
        <div className="section-heading section-heading-inline">
          <div>
            <p className="section-kicker">Registry</p>
            <h2>添加本地仓库</h2>
            <p className="section-description">把仓库接入工作台后，就能按采样粒度运行分析并跟踪结果。</p>
          </div>
          <button className="secondary-button" onClick={() => void onRefreshWorkspace()} type="button">
            刷新工作区
          </button>
        </div>

        <form className="intake-form" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="localPath">
            本地仓库绝对路径
          </label>
          <input
            id="localPath"
            onChange={(event) => onUpdateLocalPath(event.target.value)}
            placeholder="/home/zxr/work/github/some-rust-repo"
            required
            type="text"
            value={localPath}
          />
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "添加中..." : "添加仓库"}
          </button>
        </form>

        {error ? <p className="feedback error">{error}</p> : null}
      </section>

      <section className="surface-section repository-section">
        <div className="section-heading section-heading-inline">
          <div>
            <p className="section-kicker">Repositories</p>
            <h2>仓库列表</h2>
            <p className="section-description">每个仓库只保留必要信息，主操作始终固定在右侧操作区。</p>
          </div>
          <div className="meta-chip-row">
            <span className="meta-chip">运行中 {activeAnalyses}</span>
            <span className="meta-chip">总分析 {analysisCount}</span>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">
            <strong>正在加载仓库工作区</strong>
            <p>正在读取仓库和分析摘要。</p>
          </div>
        ) : null}

        {!loading && repositories.length === 0 ? (
          <div className="empty-state">
            <strong>还没有接入任何仓库</strong>
            <p>先添加一个本地仓库，工作台才会出现分析任务和结果入口。</p>
          </div>
        ) : null}

        {!loading && repositories.length > 0 ? (
          <div className="repository-stack">
            {repositories.map((repository) => {
              const selectedSampling = selectedSamplingByRepository[repository.id] ?? "weekly";
              const analysis =
                analysesByRepositoryAndSampling[`${repository.id}:${selectedSampling}`];
              const latestSnapshot = analysis?.latestSnapshot ?? null;
              const hasDetailResult = Boolean(
                analysis &&
                  analysis.job.status === "done" &&
                  analysis.snapshotCount > 0 &&
                  latestSnapshot,
              );
              const loadingKey = `${repository.id}:${selectedSampling}`;
              const moduleCount = moduleResults[repository.id]?.length ?? null;

              return (
                <article className="repository-card" key={repository.id}>
                  <div className="repository-card-main">
                    <div className="repository-card-header">
                      <div>
                        <p className="repository-kind">{repository.detectedKinds.join(", ")}</p>
                        <h3>{repository.name}</h3>
                      </div>
                      <span className={`status-pill status-${repository.status}`}>
                        {repository.status}
                      </span>
                    </div>

                    <p className="repository-path" title={repository.localPath ?? undefined}>
                      {repository.localPath}
                    </p>

                    <div className="meta-chip-row">
                      <span className="meta-chip">默认分支 {repository.defaultBranch ?? "unknown"}</span>
                      <span className="meta-chip">任务状态 {analysis?.job.status ?? "idle"}</span>
                      {moduleCount !== null ? <span className="meta-chip">模块 {moduleCount}</span> : null}
                    </div>

                    <div className="repository-facts">
                      <div className="fact-card">
                        <span>当前采样</span>
                        <strong>{getSamplingLabel(selectedSampling)}</strong>
                      </div>
                      <div className="fact-card">
                        <span>最新采样</span>
                        <strong>{latestSnapshot?.ts.slice(0, 10) ?? "-"}</strong>
                      </div>
                      <div className="fact-card">
                        <span>采样点</span>
                        <strong>{analysis?.snapshotCount ?? 0}</strong>
                      </div>
                      <div className="fact-card">
                        <span>最近提交</span>
                        <strong>{latestSnapshot?.commit.slice(0, 7) ?? "-"}</strong>
                      </div>
                    </div>

                    <div className="repository-status-block">
                      {analysis ? (
                        analysis.job.status === "pending" || analysis.job.status === "running" ? (
                          <ProgressBar analysis={analysis} />
                        ) : (
                          <p className="feedback">当前采样结果已就绪，可以进入详情页继续查看。</p>
                        )
                      ) : (
                        <p className="feedback">当前采样还没有分析结果，右侧可直接发起任务。</p>
                      )}
                    </div>
                  </div>

                  <aside className="repository-card-side">
                    <div className="control-block">
                      <span className="control-label">采样粒度</span>
                      <div className="segmented-control">
                        {samplingOptions.map((sampling) => (
                          <button
                            className={`segmented-option ${selectedSampling === sampling ? "active" : ""}`}
                            key={sampling}
                            onClick={() => onUpdateSampling(repository.id, sampling)}
                            type="button"
                          >
                            {getSamplingLabel(sampling)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="repository-actions">
                      <button
                        className="primary-button card-primary-action"
                        disabled={Boolean(analysisLoading[loadingKey])}
                        onClick={() => void onRunAnalysis(repository, selectedSampling)}
                        type="button"
                      >
                        {analysisLoading[loadingKey]
                          ? "分析中..."
                          : `运行 ${getSamplingLabel(selectedSampling)} 分析`}
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => void onLoadModules(repository.id)}
                        type="button"
                      >
                        {moduleLoading[repository.id] ? "探测中..." : "探测模块"}
                      </button>
                      <Link className="secondary-button" to={`/repositories/${repository.id}/modules`}>
                        模块清单
                      </Link>
                      {hasDetailResult && analysis ? (
                        <Link className="secondary-button" to={`/analyses/${analysis.job.id}`}>
                          查看结果
                        </Link>
                      ) : (
                        <span className="secondary-button is-static">暂无结果</span>
                      )}
                      <button
                        className="danger-button"
                        onClick={() => void onDeleteRepository(repository)}
                        type="button"
                      >
                        {deleteLoading[repository.id] ? "删除中..." : "删除仓库"}
                      </button>
                    </div>
                  </aside>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}
