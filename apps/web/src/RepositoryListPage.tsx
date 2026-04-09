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
  analysesByRepository: Record<string, AnalysisSummaryDto | undefined>;
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
  onUpdateSampling: (sampling: AnalysisSamplingDto) => void;
  onUpdateLocalPath: (value: string) => void;
  repositories: RepositoryTargetDto[];
  selectedSampling: AnalysisSamplingDto;
  submitting: boolean;
};

export function RepositoryListPage({
  analysesByRepository,
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
  selectedSampling,
  submitting,
}: RepositoryListPageProps) {
  const activeAnalyses = Object.values(analysesByRepository).filter((analysis) => analysis).length;

  return (
    <main className="layout">
      <section className="hero-card dashboard-hero">
        <div className="hero-copy-block">
          <p className="eyebrow">Analysis Workbench</p>
          <h1>仓库工作台</h1>
          <p className="hero-copy">
            监控本地 Git 仓库的历史演化，按不同采样粒度观察模块规模、结构变化与分析进度。
          </p>
        </div>
        <div className="hero-side">
          <div className="hero-filter">
            {samplingOptions.map((sampling) => (
              <button
                className={`hero-filter-button ${selectedSampling === sampling ? "active" : ""}`}
                key={sampling}
                onClick={() => onUpdateSampling(sampling)}
                type="button"
              >
                {getSamplingLabel(sampling)}
              </button>
            ))}
          </div>
          <div className="hero-stats hero-stats-inline">
            <div className="hero-stat">
              <span>已注册</span>
              <strong>{repositories.length}</strong>
            </div>
            <div className="hero-stat">
              <span>分析任务</span>
              <strong>{activeAnalyses}</strong>
            </div>
            <div className="hero-stat">
              <span>当前粒度</span>
              <strong>{getSamplingLabel(selectedSampling)} / module</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="panel intake-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Repository Intake</p>
            <h2>注册待分析仓库</h2>
            <p className="section-copy">输入本地 Git 仓库绝对路径，校验通过后会加入工作台。</p>
          </div>
          <button className="ghost-button" onClick={() => void onRefreshWorkspace()} type="button">
            刷新列表
          </button>
        </div>

        <form className="repository-form repository-form-inline" onSubmit={onSubmit}>
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
          <button disabled={submitting} type="submit">
            {submitting ? "注册中..." : "添加仓库"}
          </button>
        </form>

        {error ? <p className="feedback error">{error}</p> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Registry</p>
            <h2>已注册仓库</h2>
          </div>
          <span className="stat-chip">
            当前查看 {getSamplingLabel(selectedSampling)} 维度，已注册 {repositories.length} 个仓库
          </span>
        </div>

        {loading ? <p className="feedback">加载中...</p> : null}

        {!loading && repositories.length === 0 ? (
          <p className="feedback">还没有注册任何仓库。可以先添加一个本地 Rust 仓库做测试。</p>
        ) : null}

        <div className="repository-grid">
          {repositories.map((repository) => {
            const analysis = analysesByRepository[repository.id];
            const latestSnapshot = analysis?.latestSnapshot ?? null;
            const statusLabel = analysis ? analysis.job.status : "idle";

            return (
              <article className="repository-card" key={repository.id}>
                <div className="repository-card-body">
                  <div className="repository-title-row">
                    <div>
                      <div className="repository-language">
                        {repository.detectedKinds.join(", ")}
                      </div>
                      <h3>{repository.name}</h3>
                      <p className="repository-path" title={repository.localPath ?? undefined}>
                        {repository.localPath}
                      </p>
                    </div>
                    <span className={`status-pill status-${repository.status}`}>
                      {repository.status}
                    </span>
                  </div>

                  <div className="meta-grid">
                    <div className="meta-card">
                      <span className="meta-label">Branch</span>
                      <strong>{repository.defaultBranch ?? "unknown"}</strong>
                    </div>
                    <div className="meta-card">
                      <span className="meta-label">Status</span>
                      <strong>{statusLabel}</strong>
                    </div>
                    <div className="meta-card">
                      <span className="meta-label">Sampling</span>
                      <strong>{getSamplingLabel(selectedSampling)}</strong>
                    </div>
                    <div className="meta-card">
                      <span className="meta-label">Latest sample</span>
                      <strong>{latestSnapshot?.ts.slice(0, 10) ?? "-"}</strong>
                    </div>
                  </div>

                  <div className="hero-filter repository-card-sampling-switch">
                    {samplingOptions.map((sampling) => (
                      <button
                        className={`hero-filter-button ${selectedSampling === sampling ? "active" : ""}`}
                        key={sampling}
                        onClick={() => onUpdateSampling(sampling)}
                        type="button"
                      >
                        {getSamplingLabel(sampling)}
                      </button>
                    ))}
                  </div>

                  <div className="module-actions">
                    <button
                      className="ghost-button"
                      onClick={() => void onLoadModules(repository.id)}
                      type="button"
                    >
                      {moduleLoading[repository.id] ? "探测中..." : "探测模块"}
                    </button>
                    <button
                      className="ghost-button card-primary-action"
                      onClick={() => void onRunAnalysis(repository, selectedSampling)}
                      type="button"
                    >
                      {analysisLoading[`${repository.id}:${selectedSampling}`]
                        ? "分析中..."
                        : `运行 ${getSamplingLabel(selectedSampling)} 分析`}
                    </button>
                    {analysis ? (
                      <Link
                        className="ghost-button detail-link-button"
                        to={`/analyses/${analysis.job.id}`}
                      >
                        查看详情
                      </Link>
                    ) : null}
                    <Link
                      className="ghost-button detail-link-button card-quiet-link"
                      to={`/repositories/${repository.id}/modules`}
                    >
                      模块列表
                    </Link>
                    <button
                      className="ghost-button danger-button"
                      onClick={() => void onDeleteRepository(repository)}
                      type="button"
                    >
                      {deleteLoading[repository.id] ? "删除中..." : "删除"}
                    </button>
                  </div>

                  {moduleResults[repository.id] ? (
                    <div className="repository-module-summary">
                      <span className="mono-badge">
                        已探测 {moduleResults[repository.id]!.length} 个模块
                      </span>
                    </div>
                  ) : null}

                  {analysis ? (
                    <div className="repository-analysis-summary">
                      <div className="summary-row">
                        <span>{analysis.snapshotCount} 个采样点</span>
                        <span>{getSamplingLabel(analysis.job.sampling)}</span>
                        <span>任务 {analysis.job.id.slice(0, 8)}</span>
                        <span>{latestSnapshot?.ts.slice(0, 10) ?? "-"}</span>
                      </div>
                      {analysis.job.status === "pending" || analysis.job.status === "running" ? (
                        <ProgressBar analysis={analysis} />
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {analysis ? (
                  <Link
                    className="repository-card-footer repository-card-footer-link-wrap"
                    to={`/analyses/${analysis.job.id}`}
                  >
                    <div className="repository-card-footer-meta">本地仓库演化分析</div>
                    <div className="repository-card-footer-link">查看演化趋势</div>
                  </Link>
                ) : (
                  <div className="repository-card-footer">
                    <div className="repository-card-footer-meta">本地仓库演化分析</div>
                    <div className="repository-card-footer-link">开始分析</div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
