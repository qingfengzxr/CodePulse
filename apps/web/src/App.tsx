import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";

import type {
  AnalysisResultDto,
  AnalysisSamplingDto,
  AnalysisSummaryDto,
  CreateAnalysisRequestDto,
  ModuleUnitDto,
  RepositoryModulesResponseDto,
  RepositoryTargetDto,
} from "@code-dance/contracts";
import { AnalysisDetailPage } from "./AnalysisDetailPage";
import { RepositoryModulesPage } from "./RepositoryModulesPage";
import { RepositoryListPage } from "./RepositoryListPage";
import { ThemeProvider, type ThemeMode } from "./theme";

type ApiError = {
  error: string;
  message: string;
};

type ShellCopy = {
  eyebrow: string;
  title: string;
  description: string;
};

const THEME_STORAGE_KEY = "code-dance-theme";

export function App() {
  const location = useLocation();
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readInitialThemeMode());
  const [localPath, setLocalPath] = useState("");
  const [repositories, setRepositories] = useState<RepositoryTargetDto[]>([]);
  const [moduleResults, setModuleResults] = useState<Record<string, ModuleUnitDto[] | undefined>>(
    {},
  );
  const [moduleLoading, setModuleLoading] = useState<Record<string, boolean>>({});
  const [analysisSummaries, setAnalysisSummaries] = useState<Record<string, AnalysisSummaryDto>>(
    {},
  );
  const [analysisDetails, setAnalysisDetails] = useState<Record<string, AnalysisResultDto>>({});
  const [analysisLoading, setAnalysisLoading] = useState<Record<string, boolean>>({});
  const [selectedSamplingByRepository, setSelectedSamplingByRepository] = useState<
    Record<string, AnalysisSamplingDto>
  >({});
  const [deleteLoading, setDeleteLoading] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const activeAnalyses = Object.values(analysisSummaries).filter(
      (analysis) => analysis.job.status === "pending" || analysis.job.status === "running",
    );

    if (activeAnalyses.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      for (const analysis of activeAnalyses) {
        void refreshAnalysis(analysis.job.id);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [analysisSummaries]);

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
      setError(requestError instanceof Error ? requestError.message : "failed to load workspace");
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError(requestError instanceof Error ? requestError.message : "failed to detect modules");
    } finally {
      setModuleLoading((current) => ({ ...current, [repositoryId]: false }));
    }
  }, []);

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
      setError(
        requestError instanceof Error ? requestError.message : "repository registration failed",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const refreshAnalysis = useCallback(async (analysisId: string) => {
    try {
      const response = await fetch(`/api/analyses/${analysisId}`);
      if (!response.ok) {
        return;
      }

      const analysis = (await response.json()) as AnalysisResultDto;
      setAnalysisDetails((current) => ({
        ...current,
        [analysis.job.id]: analysis,
      }));
      setAnalysisSummaries((current) => ({
        ...current,
        [analysis.job.id]: summarizeAnalysis(analysis),
      }));
    } catch {
      // Keep the latest known result on transient polling errors.
    }
  }, []);

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
      setAnalysisDetails((current) => ({
        ...current,
        [analysis.job.id]: analysis,
      }));
      setAnalysisSummaries((current) => ({
        ...current,
        [analysis.job.id]: summarizeAnalysis(analysis),
      }));
      return analysis;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "failed to run analysis");
      return null;
    } finally {
      setAnalysisLoading((current) => ({ ...current, [loadingKey]: false }));
    }
    },
    [selectedSamplingByRepository],
  );

  const deleteRepository = useCallback(async (repository: RepositoryTargetDto) => {
    const confirmed = window.confirm(
      `确认删除仓库“${repository.name}”吗？这会同时删除关联的分析结果。`,
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
      setAnalysisDetails((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([, analysis]) => analysis.job.repositoryId !== repository.id,
          ),
        ),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "failed to delete repository",
      );
    } finally {
      setDeleteLoading((current) => ({ ...current, [repository.id]: false }));
    }
  }, []);

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
  const shellCopy = getShellCopy(location.pathname);

  return (
    <ThemeProvider theme={themeMode}>
      <div className="app-shell">
        <aside className="shell-sidebar">
          <div className="brand-block">
            <div className="brand-mark">CD</div>
            <div className="brand-copy">
              <strong>Code Dance</strong>
              <span>仓库演化分析工作区</span>
            </div>
          </div>

          <nav className="sidebar-nav">
            <Link
              className={`sidebar-link ${location.pathname === "/" ? "active" : ""}`}
              to="/"
            >
              <span className="sidebar-link-index">01</span>
              <span className="sidebar-link-copy">
                <strong>工作台</strong>
                <small>仓库接入、任务运行、结果入口</small>
              </span>
            </Link>

            <div className={`sidebar-link ${location.pathname.startsWith("/analyses/") ? "active" : ""}`}>
              <span className="sidebar-link-index">02</span>
              <span className="sidebar-link-copy">
                <strong>分析详情</strong>
                <small>聚焦单张主图，按节奏阅读结果</small>
              </span>
            </div>

            <div
              className={`sidebar-link ${location.pathname.startsWith("/repositories/") ? "active" : ""}`}
            >
              <span className="sidebar-link-index">03</span>
              <span className="sidebar-link-copy">
                <strong>模块清单</strong>
                <small>补充查看仓库的技术模块结构</small>
              </span>
            </div>
          </nav>

          <div className="sidebar-footer">
            <span className="mono-badge">v0.1.0-alpha</span>
            <p>保留现有分析接口，重做前端体验。</p>
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
                <span className="meta-chip">仓库 {repositories.length}</span>
                <span className="meta-chip">运行中 {activeAnalyses}</span>
                <span className="meta-chip">可分析 {readyRepositories}</span>
              </div>
              <button
                aria-label={`切换到${themeMode === "dark" ? "亮色" : "暗色"}主题`}
                className="secondary-button theme-toggle"
                onClick={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
                type="button"
              >
                <span className="theme-toggle-mark">{themeMode === "dark" ? "Light" : "Dark"}</span>
                <span>{themeMode === "dark" ? "切换亮色" : "切换暗色"}</span>
              </button>
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
                    analyses={analysisDetails}
                    analysisSummaries={analysisSummaries}
                    onRefreshAnalysis={refreshAnalysis}
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
    </ThemeProvider>
  );
}

function readInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
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

function getShellCopy(pathname: string): ShellCopy {
  if (pathname.startsWith("/analyses/")) {
    return {
      eyebrow: "Analysis View",
      title: "分析详情",
      description: "单图聚焦查看仓库演化结果，按结构、波动与趋势逐步深入。",
    };
  }

  if (pathname.startsWith("/repositories/")) {
    return {
      eyebrow: "Module View",
      title: "模块清单",
      description: "独立查看仓库模块结构，避免工作台列表承载过多细节。",
    };
  }

  return {
    eyebrow: "Workspace",
    title: "仓库工作台",
    description: "在一个页面里完成仓库接入、任务运行、状态筛查和结果跳转。",
  };
}
