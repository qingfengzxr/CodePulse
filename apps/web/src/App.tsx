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

type ApiError = {
  error: string;
  message: string;
};

export function App() {
  const location = useLocation();
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
  const [selectedSampling, setSelectedSampling] = useState<AnalysisSamplingDto>("weekly");
  const [deleteLoading, setDeleteLoading] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadWorkspace();
  }, []);

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
    sampling = selectedSampling,
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

  const latestAnalysesByRepository = Object.values(analysisSummaries)
    .filter((analysis) => analysis.job.sampling === selectedSampling)
    .reduce<Record<string, AnalysisSummaryDto>>((accumulator, analysis) => {
      const current = accumulator[analysis.job.repositoryId];
      if (!current || current.job.createdAt < analysis.job.createdAt) {
        accumulator[analysis.job.repositoryId] = analysis;
      }

      return accumulator;
    }, {});

  return (
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
            <span className="mono-badge">{repositories.length} 仓库</span>
            <span className="mono-badge">{Object.keys(analysisSummaries).length} 分析</span>
          </div>
        </header>

        <div className="page-shell">
          <Routes>
            <Route
              element={
                <RepositoryListPage
                  analysesByRepository={latestAnalysesByRepository}
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
                  onUpdateSampling={setSelectedSampling}
                  onUpdateLocalPath={setLocalPath}
                  repositories={repositories}
                  selectedSampling={selectedSampling}
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
