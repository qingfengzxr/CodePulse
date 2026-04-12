import type { FormEvent } from "react";
import { Link } from "react-router-dom";

import type {
  AnalysisResultDto,
  AnalysisSamplingDto,
  AnalysisSummaryDto,
  ModuleUnitDto,
  RepositoryTargetDto,
} from "@code-dance/contracts";
import { formatAnalysisStatus, formatRepositoryKind, formatRepositoryStatus } from "./display";
import { useI18n } from "./i18n";
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
  const { t, formatNumber, formatDate } = useI18n();
  const allAnalyses = Object.values(analysesByRepositoryAndSampling).filter(
    (analysis): analysis is AnalysisSummaryDto => Boolean(analysis),
  );
  const analysisCount = allAnalyses.length;
  const activeAnalyses = allAnalyses.filter(
    (analysis) => analysis.job.status === "pending" || analysis.job.status === "running",
  ).length;
  const completedAnalyses = allAnalyses.filter((analysis) => analysis.job.status === "done").length;
  const latestActivity = allAnalyses
    .map((analysis) => analysis.latestSnapshot?.ts)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <main className="page-grid">
      <section className="surface-section workspace-summary">
        <div className="section-heading">
          <div>
            <h2>{t("page.repositories.overviewTitle")}</h2>
            <p className="section-description">{t("page.repositories.description")}</p>
          </div>
        </div>

        <div className="summary-grid">
          <article className="summary-card">
            <span>{t("page.repositories.summary.repositories")}</span>
            <strong>{formatNumber(repositories.length)}</strong>
            <p>{t("page.repositories.summary.repositoriesBody")}</p>
          </article>
          <article className="summary-card">
            <span>{t("page.repositories.summary.active")}</span>
            <strong>{formatNumber(activeAnalyses)}</strong>
            <p>{t("page.repositories.summary.activeBody")}</p>
          </article>
          <article className="summary-card">
            <span>{t("page.repositories.summary.completed")}</span>
            <strong>{formatNumber(completedAnalyses)}</strong>
            <p>{t("page.repositories.summary.completedBody")}</p>
          </article>
          <article className="summary-card">
            <span>{t("page.repositories.summary.latest")}</span>
            <strong>{latestActivity ? formatDate(latestActivity) : "-"}</strong>
            <p>{t("page.repositories.summary.latestBody")}</p>
          </article>
        </div>
      </section>

      <section className="surface-section intake-strip">
        <div className="intake-strip-main">
          <div className="intake-strip-copy">
            <h2>{t("page.repositories.intakeTitle")}</h2>
            <p className="section-description">{t("page.repositories.intakeBody")}</p>
          </div>

          <div className="intake-panel">
            <span className="control-label">Local Git Path</span>
            <form className="intake-form intake-form-inline" onSubmit={onSubmit}>
              <label className="sr-only" htmlFor="localPath">
                {t("page.repositories.intakeTitle")}
              </label>
              <input
                id="localPath"
                onChange={(event) => onUpdateLocalPath(event.target.value)}
                placeholder="Absolute path..."
                required
                type="text"
                value={localPath}
              />
              <div className="intake-panel-actions">
                <button className="primary-button" disabled={submitting} type="submit">
                  {submitting ? `${t("action.addRepository")}...` : t("action.addRepository")}
                </button>
                <button
                  className="secondary-button intake-refresh"
                  onClick={() => void onRefreshWorkspace()}
                  type="button"
                >
                  {t("action.refresh")}
                </button>
              </div>
            </form>

            {error ? <p className="feedback error">{error}</p> : null}
          </div>
        </div>
      </section>

      <section className="surface-section repository-section">
        <div className="section-heading section-heading-inline">
          <div>
            <h2>{t("page.repositories.listTitle")}</h2>
          </div>
          <div className="meta-chip-row">
            <span className="meta-chip">
              {t("shell.meta.running", { count: formatNumber(activeAnalyses) })}
            </span>
            <span className="meta-chip">
              {t("page.analysis.metaPoints", { count: formatNumber(analysisCount) })}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">
            <strong>{t("feedback.loadingWorkspace")}</strong>
            <p>{t("feedback.loadingWorkspaceBody")}</p>
          </div>
        ) : null}

        {!loading && repositories.length === 0 ? (
          <div className="empty-state">
            <strong>{t("feedback.emptyWorkspace")}</strong>
            <p>{t("feedback.emptyWorkspaceBody")}</p>
          </div>
        ) : null}

        {!loading && repositories.length > 0 ? (
          <div className="repository-grid">
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
              const primaryActionLabel = hasDetailResult && analysis
                ? t("action.viewEvolution")
                : t("action.startAnalysis");
              const visualStatus = analysis?.job.status === "done"
                ? "analyzed"
                : analysis?.job.status ?? repository.status;
              const visualStatusLabel = analysis?.job.status === "done"
                ? formatRepositoryStatus("analyzed")
                : analysis?.job.status
                  ? formatAnalysisStatus(analysis.job.status)
                  : formatRepositoryStatus(repository.status);

              return (
                <article className="repository-tile" key={repository.id}>
                  <div className="repository-tile-head">
                    <div>
                      <p className="repository-kind">
                        {repository.detectedKinds.map(formatRepositoryKind).join(", ")}
                      </p>
                      <h3>{repository.name}</h3>
                    </div>
                    <span className={`status-pill status-${visualStatus}`}>
                      {visualStatusLabel}
                    </span>
                  </div>

                  <p className="repository-path repository-path-compact" title={repository.localPath ?? undefined}>
                    {repository.localPath}
                  </p>

                  <div className="repository-metrics">
                    <div className="repository-metric">
                      <span>{t("label.branch")}</span>
                      <strong>{repository.defaultBranch ?? t("status.unknown")}</strong>
                    </div>
                    <div className="repository-metric">
                      <span>{t("label.lastActivity")}</span>
                      <strong>{latestSnapshot?.ts ? formatDate(latestSnapshot.ts) : "N/A"}</strong>
                    </div>
                  </div>

                  <div className="repository-metrics repository-metrics-secondary">
                    <div className="repository-metric">
                      <span>{t("label.modules")}</span>
                      <strong>{moduleCount === null ? "-" : formatNumber(moduleCount)}</strong>
                    </div>
                    <div className="repository-metric">
                      <span>{t("label.snapshots")}</span>
                      <strong>{formatNumber(analysis?.snapshotCount ?? 0)}</strong>
                    </div>
                  </div>

                  {analysis?.job.status === "pending" || analysis?.job.status === "running" ? (
                    <div className="repository-status-inline">
                      <ProgressBar analysis={analysis} />
                    </div>
                  ) : null}

                  <div className="repository-tile-footer">
                    <div className={`repository-tile-footer-meta repository-tile-footer-meta-${visualStatus}`}>
                      <span>
                        {analysis ? formatAnalysisStatus(analysis.job.status) : formatRepositoryStatus(repository.status)}
                      </span>
                    </div>
                    <div className="repository-tile-footer-actions">
                      <div className="segmented-control segmented-control-compact">
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
                      {hasDetailResult && analysis ? (
                        <Link className="repository-inline-link" to={`/analyses/${analysis.job.id}`}>
                          {primaryActionLabel}
                        </Link>
                      ) : (
                        <button
                          className="repository-inline-link repository-inline-link-button"
                          disabled={Boolean(analysisLoading[loadingKey])}
                          onClick={() => void onRunAnalysis(repository, selectedSampling)}
                          type="button"
                        >
                          {analysisLoading[loadingKey] ? `${t("action.runAnalysis")}...` : primaryActionLabel}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="repository-card-aux-actions">
                    <button
                      className="secondary-button"
                      onClick={() => void onLoadModules(repository.id)}
                      type="button"
                    >
                      {moduleLoading[repository.id] ? `${t("action.detectModules")}...` : t("action.detectModules")}
                    </button>
                    <Link className="secondary-button" to={`/repositories/${repository.id}/modules`}>
                      {t("nav.modules")}
                    </Link>
                    <button
                      className="danger-button"
                      onClick={() => void onDeleteRepository(repository)}
                      type="button"
                    >
                      {deleteLoading[repository.id] ? `${t("action.delete")}...` : t("action.delete")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}
