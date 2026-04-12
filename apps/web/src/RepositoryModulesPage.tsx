import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { ModuleUnitDto, RepositoryTargetDto } from "@code-dance/contracts";
import { ModuleTreemapChart } from "./charts/ModuleTreemapChart";
import { formatModuleSource, formatRepositoryKind } from "./display";
import { useI18n } from "./i18n";

type RepositoryModulesPageProps = {
  moduleLoading: Record<string, boolean>;
  moduleResults: Record<string, ModuleUnitDto[] | undefined>;
  onLoadModules: (repositoryId: string) => Promise<void> | void;
  repositories: RepositoryTargetDto[];
};

export function RepositoryModulesPage({
  moduleLoading,
  moduleResults,
  onLoadModules,
  repositories,
}: RepositoryModulesPageProps) {
  const { t, formatNumber } = useI18n();
  const { repositoryId } = useParams();
  const repository = repositoryId
    ? repositories.find((candidate) => candidate.id === repositoryId)
    : undefined;
  const modules = repositoryId ? moduleResults[repositoryId] : undefined;
  const loading = repositoryId ? moduleLoading[repositoryId] : false;
  const [viewMode, setViewMode] = useState<"list" | "treemap">("list");

  useEffect(() => {
    if (!repositoryId || modules) {
      return;
    }

    void onLoadModules(repositoryId);
  }, [modules, onLoadModules, repositoryId]);

  if (!repositoryId) {
    return (
      <main className="page-grid">
        <section className="surface-section">
          <div className="empty-state">
            <strong>{t("feedback.moduleIdMissing")}</strong>
            <p>{t("feedback.moduleIdMissingBody")}</p>
          </div>
        </section>
      </main>
    );
  }

  if (!repository) {
    return (
      <main className="page-grid">
        <section className="surface-section">
          <div className="section-heading section-heading-inline">
            <div>
              <p className="section-kicker">{t("page.modules.title")}</p>
              <h2>{t("feedback.repositoryMissing")}</h2>
            </div>
            <Link className="secondary-button" to="/">
              {t("action.backToWorkspace")}
            </Link>
          </div>
          <div className="empty-state">
            <strong>{t("feedback.repositoryMissing")}</strong>
            <p>{t("feedback.repositoryMissingBody")}</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-grid">
      <section className="surface-section detail-summary-section">
        <div className="section-heading section-heading-inline">
          <div>
            <p className="section-kicker">{t("page.modules.title")}</p>
            <h2>{repository.name}</h2>
            <p className="section-description">{t("page.modules.description")}</p>
          </div>
          <div className="detail-action-row">
            <Link className="secondary-button" to="/">
              {t("action.backToWorkspace")}
            </Link>
            <button
              className="primary-button"
              onClick={() => void onLoadModules(repository.id)}
              type="button"
            >
              {loading
                ? t("feedback.loadingModules")
                : modules
                  ? t("action.refreshModules")
                  : t("action.detectModules")}
            </button>
          </div>
        </div>

        <div className="summary-grid summary-grid-compact">
          <article className="summary-card">
            <span>{t("label.branch")}</span>
            <strong>{repository.defaultBranch ?? t("status.unknown")}</strong>
            <p>{t("label.branch")}</p>
          </article>
          <article className="summary-card">
            <span>{t("label.languages")}</span>
            <strong>{repository.detectedKinds.map(formatRepositoryKind).join(", ")}</strong>
            <p>{t("label.languages")}</p>
          </article>
          <article className="summary-card">
            <span>{t("label.moduleCount")}</span>
            <strong>{formatNumber(modules?.length ?? 0)}</strong>
            <p>{t("page.modules.structureBody")}</p>
          </article>
        </div>
      </section>

      <section className="surface-section">
        <div className="section-heading section-heading-inline">
          <div>
            <p className="section-kicker">{t("page.modules.structure")}</p>
            <h2>{t("page.modules.title")}</h2>
            <p className="section-description">{t("page.modules.structureBody")}</p>
          </div>
          <div className="module-view-controls">
            <div className="segmented-control segmented-control-compact">
              <button
                className={`segmented-option ${viewMode === "list" ? "active" : ""}`}
                onClick={() => setViewMode("list")}
                type="button"
              >
                {t("page.modules.view.list")}
              </button>
              <button
                className={`segmented-option ${viewMode === "treemap" ? "active" : ""}`}
                onClick={() => setViewMode("treemap")}
                type="button"
              >
                {t("page.modules.view.treemap")}
              </button>
            </div>
            <span className="meta-chip">{t("chart.churn.summary.modules", { count: formatNumber(modules?.length ?? 0) })}</span>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">
            <strong>{t("feedback.loadingModules")}</strong>
            <p>{t("feedback.loadingModulesBody")}</p>
          </div>
        ) : null}

        {!loading && modules && modules.length === 0 ? (
          <div className="empty-state">
            <strong>{t("feedback.noModules")}</strong>
            <p>{t("feedback.noModulesBody")}</p>
          </div>
        ) : null}

        {!loading && modules?.length && viewMode === "list" ? (
          <div className="module-table-wrap">
            <div className="module-table">
              <div className="module-table-header">
                <span>{t("label.module")}</span>
                <span>{t("label.path")}</span>
                <span>{t("label.files")}</span>
                <span>{t("label.source")}</span>
              </div>
              <div className="module-table-body">
                {modules.map((module) => (
                  <article className="module-table-row" key={module.key}>
                    <div className="module-table-cell module-table-main">
                      <span className="repository-kind">{module.kind}</span>
                      <strong>{module.name}</strong>
                    </div>
                    <div className="module-table-cell">
                      <code className="module-table-path">{module.rootPath}</code>
                    </div>
                    <div className="module-table-cell module-table-number">
                      {formatNumber(module.files.length)}
                    </div>
                    <div className="module-table-cell">
                      <span className="meta-chip">{formatModuleSource(module.source)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {!loading && modules?.length && viewMode === "treemap" ? (
          <div className="module-treemap-panel">
            <ModuleTreemapChart modules={modules} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
