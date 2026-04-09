import { FormEvent, useEffect, useState } from "react";
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
import { getSamplingLabel } from "./sampling";
import { ThemeProvider, type ThemeMode } from "./theme";

type ApiError = {
  error: string;
  message: string;
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
    void loadWorkspace();
  }, []);

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

  async function loadWorkspace() {
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
  }

  async function loadModules(repositoryId: string) {
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
  }

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

  async function refreshAnalysis(analysisId: string) {
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
  }

  async function runAnalysis(
    repository: RepositoryTargetDto,
    sampling = selectedSamplingByRepository[repository.id] ?? "weekly",
  ): Promise<AnalysisResultDto | null> {
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
  }

  async function deleteRepository(repository: RepositoryTargetDto) {
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
  }

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

  return (
    <ThemeProvider theme={themeMode}>
      <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">CD</div>
          <div className="brand-copy">
            <strong>CODE DANCE</strong>
            <span>Repo evolution workbench</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <Link
            className={`sidebar-link ${location.pathname === "/" || location.pathname.startsWith("/repositories/") ? "active" : ""}`}
            to="/"
          >
            <span className="sidebar-link-icon">01</span>
            <span className="sidebar-link-copy">
              <strong>工作台</strong>
              <small>仓库与分析任务</small>
            </span>
          </Link>

          <div
            className={`sidebar-link ${location.pathname.startsWith("/analyses/") ? "active" : ""}`}
          >
            <span className="sidebar-link-icon">02</span>
            <span className="sidebar-link-copy">
              <strong>分析结果</strong>
              <small>图表与历史趋势</small>
            </span>
          </div>

          <div className="sidebar-link disabled">
            <span className="sidebar-link-icon">03</span>
            <span className="sidebar-link-copy">
              <strong>归档区</strong>
              <small>后续预留</small>
            </span>
          </div>
        </nav>

        <div className="sidebar-footer">
          <span className="mono-badge">v0.1.0-alpha</span>
          <p>Rust 优先的本地仓库演化分析工具</p>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <div className="command-bar">
            <span className="command-icon">/</span>
            <input
              aria-label="Search"
              className="command-input"
              disabled
              placeholder="搜索仓库、模块或分析记录"
              type="text"
            />
            <span className="command-hint">⌘K</span>
          </div>

          <div className="topbar-meta">
            <button
              aria-label={`切换到${themeMode === "dark" ? "亮色" : "暗色"}主题`}
              className="ghost-button theme-toggle"
              onClick={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
              type="button"
            >
              <span className="theme-toggle-mark">{themeMode === "dark" ? "LIGHT" : "DARK"}</span>
              <span>{themeMode === "dark" ? "切换亮色" : "切换暗色"}</span>
            </button>
            <span className="mono-badge">{repositories.length} 仓库</span>
            <span className="mono-badge">{Object.keys(analysisSummaries).length} 分析</span>
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
                  onLoadModules={loadModules}
                  onDeleteRepository={deleteRepository}
                  onRefreshWorkspace={loadWorkspace}
                  onRunAnalysis={runAnalysis}
                  onSubmit={handleSubmit}
                  onUpdateSampling={updateRepositorySampling}
                  onUpdateLocalPath={setLocalPath}
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
