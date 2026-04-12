import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";

import type {
  AnalysisDetailSummaryDto,
  AnalysisResultDto,
  AnalysisSamplingDto,
  AnalysisSummaryDto,
  CreateAnalysisRequestDto,
  ModuleUnitDto,
  RepositoryModulesResponseDto,
  RepositoryTargetDto,
} from "@code-dance/contracts";
import { AnalysisDetailPage } from "./AnalysisDetailPage";
import { usePreferences, type AppLocale } from "./app/preferences";
import {
  formatAnalysisStatus,
  formatRepositoryStatus,
} from "./display";
import { useI18n } from "./i18n";
import { RepositoryModulesPage } from "./RepositoryModulesPage";
import { RepositoryListPage } from "./RepositoryListPage";
import { type ThemeMode } from "./theme";

type ApiError = {
  error: string;
  message: string;
};

type ShellCopy = {
  eyebrow: string;
  title: string;
  description: string;
};

const localeOptions: AppLocale[] = ["en", "zh-CN"];

function getNextThemeMode(themeMode: ThemeMode, resolvedTheme: "light" | "dark"): ThemeMode {
  if (themeMode === "system") {
    return resolvedTheme === "dark" ? "light" : "dark";
  }

  return themeMode === "dark" ? "light" : "dark";
}

export function App() {
  const location = useLocation();
  const { t, formatNumber } = useI18n();
  const { locale, resolvedTheme, setLocale, themeMode, setThemeMode } = usePreferences();
  const [localPath, setLocalPath] = useState("");
  const [repositories, setRepositories] = useState<RepositoryTargetDto[]>([]);
  const [moduleResults, setModuleResults] = useState<Record<string, ModuleUnitDto[] | undefined>>(
    {},
  );
  const [moduleLoading, setModuleLoading] = useState<Record<string, boolean>>({});
  const [analysisSummaries, setAnalysisSummaries] = useState<Record<string, AnalysisSummaryDto>>(
    {},
  );
  const [analysisLoading, setAnalysisLoading] = useState<Record<string, boolean>>({});
  const [selectedSamplingByRepository, setSelectedSamplingByRepository] = useState<
    Record<string, AnalysisSamplingDto>
  >({});
  const [deleteLoading, setDeleteLoading] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [repositoryResponse, analysisSummaryResponse] = await Promise.all([
        fetch("/api/repositories"),
        fetch("/api/analysis-summaries"),
      ]);

      if (!repositoryResponse.ok) {
        throw new Error(`failed to load repositories: ${repositoryResponse.status}`);
      }

      if (!analysisSummaryResponse.ok) {
        throw new Error(`failed to load analysis summaries: ${analysisSummaryResponse.status}`);
      }

      const repositoryPayload = (await repositoryResponse.json()) as RepositoryTargetDto[];
      const analysisSummaryPayload = (await analysisSummaryResponse.json()) as AnalysisSummaryDto[];

      setRepositories(repositoryPayload);
      setAnalysisSummaries(
        Object.fromEntries(analysisSummaryPayload.map((analysis) => [analysis.job.id, analysis])),
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("feedback.errorFallback"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadModules = useCallback(async (repositoryId: string) => {
    setModuleLoading((current) => ({ ...current, [repositoryId]: true }));
    setError(null);

    try {
      const response = await fetch(`/api/repositories/${repositoryId}/modules`);
      if (!response.ok) {
        const payload = (await response.json()) as ApiError;
        throw new Error(payload.message);
      }

      const payload = (await response.json()) as RepositoryModulesResponseDto;
      setModuleResults((current) => ({
        ...current,
        [repositoryId]: payload.modules,
      }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("feedback.errorFallback"));
    } finally {
      setModuleLoading((current) => ({ ...current, [repositoryId]: false }));
    }
  }, [t]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/repositories", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sourceType: "local-path",
          localPath,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as ApiError;
        throw new Error(payload.message);
      }

      setLocalPath("");
      await loadWorkspace();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("feedback.errorFallback"));
    } finally {
      setSubmitting(false);
    }
  }

  const refreshAnalysisSummary = useCallback(async (analysisId: string): Promise<AnalysisSummaryDto | null> => {
    try {
      const summaryResponse = await fetch(`/api/analysis-summaries/${analysisId}`);
      if (summaryResponse.ok) {
        const summary = (await summaryResponse.json()) as AnalysisSummaryDto;
        setAnalysisSummaries((current) => ({
          ...current,
          [summary.job.id]: summary,
        }));
        return summary;
      }

      return null;
    } catch {
      return null;
    }
  }, []);

  const refreshAnalysisDetailSummary = useCallback(
    async (analysisId: string): Promise<AnalysisDetailSummaryDto | null> => {
      try {
        const response = await fetch(`/api/analysis-details/${analysisId}`);
        if (!response.ok) {
          return null;
        }

        const analysis = (await response.json()) as AnalysisDetailSummaryDto;
        setAnalysisSummaries((current) => ({
          ...current,
          [analysis.job.id]: {
            job: analysis.job,
            progress: analysis.progress,
            snapshotCount: analysis.snapshotCount,
            latestSnapshot: analysis.latestSnapshot,
          },
        }));
        return analysis;
      } catch {
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    const activeAnalyses = Object.values(analysisSummaries).filter(
      (analysis) => analysis.job.status === "pending" || analysis.job.status === "running",
    );

    if (activeAnalyses.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      for (const analysis of activeAnalyses) {
        void refreshAnalysisSummary(analysis.job.id);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [analysisSummaries, refreshAnalysisSummary]);

  const runAnalysis = useCallback(
    async (
      repository: RepositoryTargetDto,
      sampling = selectedSamplingByRepository[repository.id] ?? "weekly",
    ): Promise<AnalysisResultDto | null> => {
      const loadingKey = `${repository.id}:${sampling}`;
      setAnalysisLoading((current) => ({ ...current, [loadingKey]: true }));
      setError(null);

      const payload: CreateAnalysisRequestDto = {
        repositoryId: repository.id,
        branch: repository.defaultBranch ?? undefined,
        sampling,
      };

      try {
        const response = await fetch("/api/analyses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorPayload = (await response.json()) as ApiError;
          throw new Error(errorPayload.message);
        }

        const analysis = (await response.json()) as AnalysisResultDto;
        setAnalysisSummaries((current) => ({
          ...current,
          [analysis.job.id]: summarizeAnalysis(analysis),
        }));
        return analysis;
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : t("feedback.errorFallback"));
        return null;
      } finally {
        setAnalysisLoading((current) => ({ ...current, [loadingKey]: false }));
      }
    },
    [selectedSamplingByRepository, t],
  );

  const deleteRepository = useCallback(async (repository: RepositoryTargetDto) => {
    const confirmed = window.confirm(
      t("dialog.deleteRepository.confirm", { name: repository.name }),
    );
    if (!confirmed) {
      return;
    }

    setDeleteLoading((current) => ({ ...current, [repository.id]: true }));
    setError(null);

    try {
      const response = await fetch(`/api/repositories/${repository.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json()) as ApiError;
        throw new Error(payload.message);
      }

      setRepositories((current) => current.filter((item) => item.id !== repository.id));
      setSelectedSamplingByRepository((current) => {
        const next = { ...current };
        delete next[repository.id];
        return next;
      });
      setModuleResults((current) => {
        const next = { ...current };
        delete next[repository.id];
        return next;
      });
      setModuleLoading((current) => {
        const next = { ...current };
        delete next[repository.id];
        return next;
      });
      setAnalysisLoading((current) => {
        const next = { ...current };
        delete next[repository.id];
        return next;
      });
      setAnalysisSummaries((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([, analysis]) => analysis.job.repositoryId !== repository.id,
          ),
        ),
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("feedback.errorFallback"));
    } finally {
      setDeleteLoading((current) => ({ ...current, [repository.id]: false }));
    }
  }, [t]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const latestAnalysesByRepositoryAndSampling = Object.values(analysisSummaries).reduce<
    Record<string, AnalysisSummaryDto>
  >((accumulator, analysis) => {
    const key = `${analysis.job.repositoryId}:${analysis.job.sampling}`;
    const current = accumulator[key];
    if (!current || current.job.createdAt < analysis.job.createdAt) {
      accumulator[key] = analysis;
    }

    return accumulator;
  }, {});

  function updateRepositorySampling(repositoryId: string, sampling: AnalysisSamplingDto) {
    setSelectedSamplingByRepository((current) => ({
      ...current,
      [repositoryId]: sampling,
    }));
  }

  const activeAnalyses = useMemo(
    () =>
      Object.values(analysisSummaries).filter(
        (analysis) => analysis.job.status === "pending" || analysis.job.status === "running",
      ).length,
    [analysisSummaries],
  );
  const readyRepositories = useMemo(
    () => repositories.filter((repository) => repository.status === "ready").length,
    [repositories],
  );
  const shellCopy = getShellCopy(location.pathname, t);

  return (
    <div className="app-shell">
      <aside className="shell-sidebar">
        <div className="brand-block">
          <div className="brand-mark">CD</div>
          <div className="brand-copy">
            <strong>Code Dance</strong>
            <span>{t("shell.brandDescription")}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <Link className={`sidebar-link ${location.pathname === "/" ? "active" : ""}`} to="/">
            <span className="sidebar-link-index">01</span>
            <span className="sidebar-link-copy">
              <strong>{t("nav.workspace")}</strong>
              <small>{t("nav.workspaceDescription")}</small>
            </span>
          </Link>

          <div className={`sidebar-link ${location.pathname.startsWith("/analyses/") ? "active" : ""}`}>
            <span className="sidebar-link-index">02</span>
            <span className="sidebar-link-copy">
              <strong>{t("nav.analysis")}</strong>
              <small>{t("nav.analysisDescription")}</small>
            </span>
          </div>

          <div className={`sidebar-link ${location.pathname.startsWith("/repositories/") ? "active" : ""}`}>
            <span className="sidebar-link-index">03</span>
            <span className="sidebar-link-copy">
              <strong>{t("nav.modules")}</strong>
              <small>{t("nav.modulesDescription")}</small>
            </span>
          </div>
        </nav>

        <div className="sidebar-footer">
          <span className="mono-badge">v0.1.0-alpha</span>
          <p>{t("shell.sidebarFootnote")}</p>
        </div>
      </aside>

      <div className="shell-main">
        <header className="shell-header">
          <div className="shell-header-copy">
            <p className="page-kicker">{shellCopy.eyebrow}</p>
            <h1>{shellCopy.title}</h1>
            <p>{shellCopy.description}</p>
          </div>

          <div className="shell-header-meta">
            <div className="shell-meta-cluster">
              <span className="meta-chip">
                {t("shell.meta.repositories", { count: formatNumber(repositories.length) })}
              </span>
              <span className="meta-chip">
                {t("shell.meta.running", { count: formatNumber(activeAnalyses) })}
              </span>
              <span className="meta-chip">
                {t("shell.meta.ready", { count: formatNumber(readyRepositories) })}
              </span>
            </div>
            <div className="preferences-strip">
              <label className="preferences-field">
                <span>{t("shell.locale.label")}</span>
                <select
                  className="chart-select"
                  onChange={(event) => setLocale(event.target.value as AppLocale)}
                  value={locale}
                >
                  {localeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "en" ? t("shell.locale.english") : t("shell.locale.zh-CN")}
                    </option>
                  ))}
                </select>
              </label>
              <div className="preferences-field preferences-field-icon">
                <span className="sr-only">{t("shell.theme.label")}</span>
                <button
                  aria-label={t(
                    `shell.theme.${getNextThemeMode(themeMode, resolvedTheme)}` as const,
                  )}
                  className="theme-toggle-button"
                  onClick={() => setThemeMode(getNextThemeMode(themeMode, resolvedTheme))}
                  title={t(`shell.theme.${themeMode}` as const)}
                  type="button"
                >
                  <span aria-hidden="true" className="theme-toggle-icon">
                    {resolvedTheme === "dark" ? "☾" : "☀"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="page-shell">
          <Routes>
            <Route
              element={
                <RepositoryListPage
                  analysesByRepositoryAndSampling={latestAnalysesByRepositoryAndSampling}
                  analysisLoading={analysisLoading}
                  deleteLoading={deleteLoading}
                  error={error}
                  loading={loading}
                  localPath={localPath}
                  moduleLoading={moduleLoading}
                  moduleResults={moduleResults}
                  onDeleteRepository={deleteRepository}
                  onLoadModules={loadModules}
                  onRefreshWorkspace={loadWorkspace}
                  onRunAnalysis={runAnalysis}
                  onSubmit={handleSubmit}
                  onUpdateLocalPath={setLocalPath}
                  onUpdateSampling={updateRepositorySampling}
                  repositories={repositories}
                  selectedSamplingByRepository={selectedSamplingByRepository}
                  submitting={submitting}
                />
              }
              path="/"
            />
            <Route
              element={
                <AnalysisDetailPage
                  analysisSummaries={analysisSummaries}
                  onRefreshAnalysisDetailSummary={refreshAnalysisDetailSummary}
                  onRefreshAnalysisSummary={refreshAnalysisSummary}
                  onRunAnalysis={runAnalysis}
                  repositories={repositories}
                />
              }
              path="/analyses/:analysisId"
            />
            <Route
              element={
                <RepositoryModulesPage
                  moduleLoading={moduleLoading}
                  moduleResults={moduleResults}
                  onLoadModules={loadModules}
                  repositories={repositories}
                />
              }
              path="/repositories/:repositoryId/modules"
            />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function summarizeAnalysis(analysis: AnalysisResultDto): AnalysisSummaryDto {
  const latestSnapshot = analysis.snapshots.at(-1);

  return {
    job: analysis.job,
    progress: analysis.progress,
    snapshotCount: analysis.snapshots.length,
    latestSnapshot: latestSnapshot
      ? {
          seq: analysis.snapshots.length,
          commit: latestSnapshot.commit,
          ts: latestSnapshot.ts,
        }
      : null,
  };
}

function getShellCopy(pathname: string, t: (key: any, params?: Record<string, string>) => string): ShellCopy {
  if (pathname.startsWith("/analyses/")) {
    return {
      eyebrow: t("shell.title.analysisEyebrow"),
      title: t("shell.title.analysis"),
      description: t("shell.title.analysisBody"),
    };
  }

  if (pathname.startsWith("/repositories/")) {
    return {
      eyebrow: t("shell.title.modulesEyebrow"),
      title: t("shell.title.modules"),
      description: t("shell.title.modulesBody"),
    };
  }

  return {
    eyebrow: t("shell.title.workspaceEyebrow"),
    title: t("shell.title.workspace"),
    description: t("shell.title.workspaceBody"),
  };
}
