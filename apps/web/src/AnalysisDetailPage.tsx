import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import type {
  AnalysisModuleSummaryDto,
  AnalysisResultDto,
  AnalysisSamplingDto,
  AnalysisSummaryDto,
  CandlesResponseDto,
  DistributionResponseDto,
  RepositoryTargetDto,
  SeriesResponseDto,
} from "@code-dance/contracts";
import {
  buildMetricSeriesFromQuery,
  buildTotalLocSeriesFromQuery,
  formatMetricValue,
  getLatestSnapshotFromSeries,
  getTotalDistributionValue,
  type MetricKey,
} from "./analysis-data";
import { ModuleBumpChart } from "./charts/ModuleBumpChart";
import { ModuleCandlestickChart } from "./charts/ModuleCandlestickChart";
import { ModuleChurnHeatmapChart } from "./charts/ModuleChurnHeatmapChart";
import { ModuleRankingChart } from "./charts/ModuleRankingChart";
import { ModuleShareStackedAreaChart } from "./charts/ModuleShareStackedAreaChart";
import { ModuleStackedAreaChart } from "./charts/ModuleStackedAreaChart";
import { ModuleTrendChart } from "./charts/ModuleTrendChart";
import { RepositoryScaleChart } from "./charts/RepositoryScaleChart";
import { ProgressBar } from "./ProgressBar";
import { getSamplingLabel, samplingOptions } from "./sampling";

type AnalysisDetailPageProps = {
  analyses: Record<string, AnalysisResultDto | undefined>;
  analysisSummaries: Record<string, AnalysisSummaryDto | undefined>;
  onRefreshAnalysis: (analysisId: string) => Promise<void> | void;
  onRunAnalysis: (
    repository: RepositoryTargetDto,
    sampling?: AnalysisSamplingDto,
  ) => Promise<AnalysisResultDto | null>;
  repositories: RepositoryTargetDto[];
};

type ApiError = {
  error: string;
  message: string;
};

type AnalysisDetailQueryState = {
  modules: AnalysisModuleSummaryDto[];
  candles: CandlesResponseDto | null;
  seriesByMetric: Partial<Record<MetricKey, SeriesResponseDto>>;
  distributionsByMetric: Partial<Record<MetricKey, DistributionResponseDto>>;
};

type ChartCard = {
  id: string;
  tabLabel: string;
  category: string;
  title: string;
  description: string;
  summary: string[];
  content: ReactNode;
};

const metrics: MetricKey[] = ["loc", "added", "deleted", "churn"];

export function AnalysisDetailPage({
  analyses,
  analysisSummaries,
  onRefreshAnalysis,
  onRunAnalysis,
  repositories,
}: AnalysisDetailPageProps) {
  const navigate = useNavigate();
  const { analysisId } = useParams();
  const analysis = analysisId ? analyses[analysisId] : undefined;
  const [queryState, setQueryState] = useState<AnalysisDetailQueryState | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [activeChartIndex, setActiveChartIndex] = useState(0);
  const [samplingActionLoading, setSamplingActionLoading] = useState<AnalysisSamplingDto | null>(
    null,
  );
  const currentAnalysisId = analysisId ?? "";

  useEffect(() => {
    if (!analysis && analysisId) {
      void onRefreshAnalysis(analysisId);
    }
  }, [analysis, analysisId, onRefreshAnalysis]);

  useEffect(() => {
    if (!analysisId || !analysis || analysis.job.status !== "done") {
      return;
    }

    let cancelled = false;

    async function loadDetailQueries() {
      setQueryLoading(true);
      setQueryError(null);

      try {
        const moduleQuery = new URLSearchParams({ analysisId: currentAnalysisId });
        const moduleResponse = fetch(`/api/modules?${moduleQuery.toString()}`);
        const seriesResponses = metrics.map((metric) =>
          fetch(
            `/api/series?${new URLSearchParams({ analysisId: currentAnalysisId, metric }).toString()}`,
          ),
        );
        const candlesResponse = fetch(`/api/candles?${moduleQuery.toString()}`);
        const distributionResponses = metrics.map((metric) =>
          fetch(
            `/api/distribution?${new URLSearchParams({
              analysisId: currentAnalysisId,
              metric,
              snapshot: "latest",
            }).toString()}`,
          ),
        );

        const responses = await Promise.all([
          moduleResponse,
          ...seriesResponses,
          candlesResponse,
          ...distributionResponses,
        ]);

        for (const response of responses) {
          if (!response.ok) {
            const payload = (await response.json()) as ApiError;
            throw new Error(payload.message);
          }
        }

        const modules = (await responses[0]!.json()) as AnalysisModuleSummaryDto[];
        const seriesByMetric = Object.fromEntries(
          await Promise.all(
            metrics.map(async (metric, index) => [
              metric,
              (await responses[index + 1]!.json()) as SeriesResponseDto,
            ]),
          ),
        ) as Partial<Record<MetricKey, SeriesResponseDto>>;
        const candles = (await responses[1 + metrics.length]!.json()) as CandlesResponseDto;
        const distributionsByMetric = Object.fromEntries(
          await Promise.all(
            metrics.map(async (metric, index) => [
              metric,
              (await responses[index + 2 + metrics.length]!.json()) as DistributionResponseDto,
            ]),
          ),
        ) as Partial<Record<MetricKey, DistributionResponseDto>>;

        if (!cancelled) {
          setQueryState({
            modules,
            candles,
            seriesByMetric,
            distributionsByMetric,
          });
        }
      } catch (requestError) {
        if (!cancelled) {
          setQueryError(
            requestError instanceof Error
              ? requestError.message
              : "failed to load analysis detail data",
          );
        }
      } finally {
        if (!cancelled) {
          setQueryLoading(false);
        }
      }
    }

    void loadDetailQueries();

    return () => {
      cancelled = true;
    };
  }, [analysis, currentAnalysisId, analysisId]);

  const currentAnalysis = analysis ?? null;
  const repository = currentAnalysis
    ? repositories.find((candidate) => candidate.id === currentAnalysis.job.repositoryId)
    : undefined;
  const locSeries = queryState?.seriesByMetric.loc;
  const totalLocSeries = locSeries ? buildTotalLocSeriesFromQuery(locSeries) : null;
  const totalLoc = totalLocSeries?.values.at(-1) ?? 0;
  const peakLoc = totalLocSeries?.values.reduce((peak, value) => Math.max(peak, value), 0) ?? 0;
  const latestSnapshot = locSeries ? getLatestSnapshotFromSeries(locSeries) : null;
  const moduleCount = queryState?.modules.length ?? 0;
  const totalAdded = queryState?.distributionsByMetric.added
    ? getTotalDistributionValue(queryState.distributionsByMetric.added)
    : 0;
  const totalDeleted = queryState?.distributionsByMetric.deleted
    ? getTotalDistributionValue(queryState.distributionsByMetric.deleted)
    : 0;
  const totalChurn = queryState?.distributionsByMetric.churn
    ? getTotalDistributionValue(queryState.distributionsByMetric.churn)
    : 0;
  const topModule = locSeries ? buildMetricSeriesFromQuery(locSeries).modules[0] : null;
  const siblingAnalysesBySampling = repository
    ? samplingOptions.map((sampling) => ({
        sampling,
        analysis: Object.values(analysisSummaries).find(
          (summary) =>
            summary?.job.repositoryId === repository.id && summary.job.sampling === sampling,
        ),
      }))
    : [];

  const chartCards = useMemo<ChartCard[]>(() => {
    const cards: ChartCard[] = [];

    if (locSeries && currentAnalysis) {
      cards.push({
        id: "repo-scale",
        tabLabel: "总览趋势",
        category: "总览",
        title: "仓库总 LOC 趋势",
        description: "先只看整体规模，建立对长期增长和阶段跳变的直觉。",
        summary: [`当前 ${formatMetricValue(totalLoc)}`, `峰值 ${formatMetricValue(peakLoc)}`],
        content: <RepositoryScaleChart series={locSeries} />,
      });

      cards.push({
        id: "stacked-area",
        tabLabel: "结构变化",
        category: "结构",
        title: "模块堆叠面积图",
        description: "看谁构成了当前结构，以及结构随时间如何迁移。",
        summary: [`${locSeries.series.length} 个模块`, `${locSeries.timeline.length} 个采样点`],
        content: <ModuleStackedAreaChart series={locSeries} />,
      });

      cards.push({
        id: "share-stacked-area",
        tabLabel: "占比结构",
        category: "结构",
        title: "模块占比 100% 堆叠面积图",
        description: "忽略绝对规模，只关注结构份额是如何变化的。",
        summary: ["100% 归一化", `${locSeries.series.length} 个模块`],
        content: <ModuleShareStackedAreaChart series={locSeries} />,
      });

      cards.push({
        id: "ranking",
        tabLabel: "当前排行",
        category: "排行",
        title: "当前模块排行",
        description: "在当前时间点看谁最大、谁最活跃，适合作为深入分析入口。",
        summary: [`Top 模块 ${topModule?.name ?? "-"}`],
        content: <ModuleRankingChart analysisId={currentAnalysis.job.id} />,
      });
    }

    if (queryState?.seriesByMetric.churn) {
      cards.push({
        id: "churn-heatmap",
        tabLabel: "热点扫描",
        category: "波动",
        title: "Churn 热力图",
        description: "扫描哪个阶段最动荡、热点迁移到了哪些模块。",
        summary: [`${queryState.seriesByMetric.churn.series.length} 个模块`, "时间 x 模块"],
        content: <ModuleChurnHeatmapChart series={queryState.seriesByMetric.churn} />,
      });
    }

    if (queryState?.candles) {
      cards.push({
        id: "candlestick",
        tabLabel: "阶段波动",
        category: "波动",
        title: "模块 K 线图",
        description: "聚焦单模块在每个采样桶内的开高低收，适合看真实波动。",
        summary: [`候选 ${queryState.modules.length} 个模块`, `当前 ${topModule?.name ?? "-"}`],
        content: <ModuleCandlestickChart candles={queryState.candles} />,
      });
    }

    if (queryState?.seriesByMetric.loc) {
      cards.push({
        id: "bump-chart",
        tabLabel: "地位变化",
        category: "趋势",
        title: "Top N 模块 Bump Chart",
        description: "把变化理解成排名轨迹，更容易判断谁在上升、谁在掉队。",
        summary: ["排名视角", "Top N"],
        content: <ModuleBumpChart seriesByMetric={queryState.seriesByMetric} />,
      });
    }

    if (queryState && currentAnalysis) {
      cards.push({
        id: "trend",
        tabLabel: "趋势对比",
        category: "趋势",
        title: "模块趋势图",
        description: "对少量核心模块做长期对比，适合做具体问题的深入排查。",
        summary: [`${moduleCount} 个模块`, "loc / added / deleted / churn"],
        content: (
          <ModuleTrendChart
            analysisId={currentAnalysis.job.id}
            seriesByMetric={queryState.seriesByMetric}
          />
        ),
      });
    }

    return cards;
  }, [
    currentAnalysis?.job.id,
    locSeries,
    moduleCount,
    peakLoc,
    queryState,
    topModule?.name,
    totalLoc,
  ]);

  useEffect(() => {
    setActiveChartIndex((current) => Math.min(current, Math.max(chartCards.length - 1, 0)));
  }, [chartCards.length]);

  if (!analysisId) {
    return (
      <main className="page-grid">
        <section className="surface-section">
          <div className="empty-state">
            <strong>分析任务 ID 缺失</strong>
            <p>当前无法定位具体分析结果。</p>
          </div>
        </section>
      </main>
    );
  }

  if (!analysis || !currentAnalysis) {
    return (
      <main className="page-grid">
        <section className="surface-section">
          <div className="section-heading section-heading-inline">
            <div>
              <p className="section-kicker">Analysis</p>
              <h2>正在加载分析详情</h2>
            </div>
            <Link className="secondary-button" to="/">
              返回工作台
            </Link>
          </div>
          <div className="empty-state">
            <strong>分析详情加载中</strong>
            <p>正在读取任务结果与关联查询数据。</p>
          </div>
        </section>
      </main>
    );
  }

  const loadedAnalysis = currentAnalysis;

  async function handleRefresh() {
    await onRefreshAnalysis(loadedAnalysis.job.id);
    if (loadedAnalysis.job.status === "done") {
      setQueryState(null);
    }
  }

  async function handleCreateSampling(targetSampling: AnalysisSamplingDto) {
    if (!repository) {
      return;
    }

    setSamplingActionLoading(targetSampling);
    try {
      const createdAnalysis = await onRunAnalysis(repository, targetSampling);
      if (createdAnalysis) {
        navigate(`/analyses/${createdAnalysis.job.id}`);
      }
    } finally {
      setSamplingActionLoading(null);
    }
  }

  const activeChart = chartCards[activeChartIndex] ?? null;

  return (
    <main className="page-grid">
      <section className="surface-section detail-summary-section">
        <div className="section-heading section-heading-inline">
          <div>
            <p className="section-kicker">Analysis</p>
            <h2>{repository?.name ?? currentAnalysis.job.repositoryId}</h2>
            <p className="section-description">
              当前按 {getSamplingLabel(currentAnalysis.job.sampling)} 采样查看仓库演化结果，先看摘要，再进入单图分析。
            </p>
          </div>
          <div className="detail-action-row">
            <Link className="secondary-button" to="/">
              返回工作台
            </Link>
            <button className="secondary-button" onClick={() => void handleRefresh()} type="button">
              刷新任务
            </button>
          </div>
        </div>

        <div className="detail-toolbar">
          <div className="segmented-control">
            {siblingAnalysesBySampling.map(({ sampling, analysis: sibling }) =>
              sibling ? (
                <Link
                  className={`segmented-option ${currentAnalysis.job.sampling === sampling ? "active" : ""}`}
                  key={sampling}
                  to={`/analyses/${sibling.job.id}`}
                >
                  {getSamplingLabel(sampling)}
                </Link>
              ) : (
                <button
                  className={`segmented-option ${currentAnalysis.job.sampling === sampling ? "active" : ""}`}
                  key={sampling}
                  onClick={() => void handleCreateSampling(sampling)}
                  type="button"
                >
                  {samplingActionLoading === sampling
                    ? `${getSamplingLabel(sampling)}...`
                    : getSamplingLabel(sampling)}
                </button>
              ),
            )}
          </div>

          <div className="meta-chip-row">
            <span className="meta-chip">
              分支 {repository?.defaultBranch ?? currentAnalysis.job.branch}
            </span>
              <span className="meta-chip">状态 {loadedAnalysis.job.status}</span>
              <span className="meta-chip">{loadedAnalysis.snapshots.length} 个采样点</span>
          </div>
        </div>

        <div className="summary-grid detail-summary-grid">
          <article className="summary-card">
            <span>当前总 LOC</span>
            <strong>{formatMetricValue(totalLoc)}</strong>
            <p>当前时间点的仓库整体规模。</p>
          </article>
          <article className="summary-card">
            <span>模块数</span>
            <strong>{formatMetricValue(moduleCount)}</strong>
            <p>当前分析对应的模块数量。</p>
          </article>
          <article className="summary-card">
            <span>最新采样</span>
            <strong>{latestSnapshot?.ts.slice(0, 10) ?? "-"}</strong>
            <p>最近一次采样时间。</p>
          </article>
          <article className="summary-card">
            <span>关键模块</span>
            <strong>{topModule?.name ?? "-"}</strong>
            <p>按当前总量排序的最大模块。</p>
          </article>
          <article className="summary-card">
            <span>新增 / 删除 / Churn</span>
            <strong>
              {formatMetricValue(totalAdded)} / {formatMetricValue(totalDeleted)} /{" "}
              {formatMetricValue(totalChurn)}
            </strong>
            <p>基于最新分布查询得到的变更规模。</p>
          </article>
        </div>

        {loadedAnalysis.job.status === "pending" || loadedAnalysis.job.status === "running" ? (
          <ProgressBar analysis={loadedAnalysis} />
        ) : null}
        {queryLoading ? <p className="feedback">正在加载图表查询数据...</p> : null}
        {queryError ? <p className="feedback error">{queryError}</p> : null}
      </section>

      {activeChart ? (
        <section className="surface-section analysis-stage">
          <div className="section-heading section-heading-inline">
            <div>
              <p className="section-kicker">Charts</p>
              <h2>单图聚焦分析</h2>
              <p className="section-description">一次只看一张主图，把注意力集中在当前问题上。</p>
            </div>
            <div className="analysis-stage-nav">
              <button
                className="secondary-button"
                disabled={activeChartIndex <= 0}
                onClick={() => setActiveChartIndex((current) => Math.max(0, current - 1))}
                type="button"
              >
                上一张
              </button>
              <span className="meta-chip">
                {activeChartIndex + 1} / {chartCards.length}
              </span>
              <button
                className="secondary-button"
                disabled={activeChartIndex >= chartCards.length - 1}
                onClick={() =>
                  setActiveChartIndex((current) => Math.min(chartCards.length - 1, current + 1))
                }
                type="button"
              >
                下一张
              </button>
            </div>
          </div>

          <div className="chart-tab-strip">
            {chartCards.map((card, index) => (
              <button
                aria-pressed={index === activeChartIndex}
                className={`chart-gallery-tab ${index === activeChartIndex ? "active" : ""}`}
                key={card.id}
                onClick={() => setActiveChartIndex(index)}
                type="button"
              >
                {card.tabLabel}
              </button>
            ))}
          </div>

          <article className="analysis-focus-card">
            <div className="analysis-focus-head">
              <div>
                <p className="section-kicker">{activeChart.category}</p>
                <h3>{activeChart.title}</h3>
                <p className="section-description">{activeChart.description}</p>
              </div>
              <div className="meta-chip-row">
                {activeChart.summary.map((item) => (
                  <span className="meta-chip" key={item}>
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="analysis-focus-body">{activeChart.content}</div>
          </article>
        </section>
      ) : null}
    </main>
  );
}
