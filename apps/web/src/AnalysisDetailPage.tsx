import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import type {
  AnalysisSamplingDto,
  AnalysisModuleSummaryDto,
  AnalysisResultDto,
  AnalysisSummaryDto,
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
import { ModuleCandlestickChart } from "./charts/ModuleCandlestickChart";
import { ModuleBumpChart } from "./charts/ModuleBumpChart";
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
  seriesByMetric: Partial<Record<MetricKey, SeriesResponseDto>>;
  distributionsByMetric: Partial<Record<MetricKey, DistributionResponseDto>>;
};

const metrics: MetricKey[] = ["loc", "added", "deleted", "churn"];

type ChartFrameProps = {
  title: string;
  description: string;
  badges?: string[];
  footer?: string;
  actions?: string[];
  wide?: boolean;
  children: React.ReactNode;
};

type ChartCard = {
  id: string;
  title: string;
  description: string;
  badges?: string[];
  footer?: string;
  actions?: string[];
  wide?: boolean;
  content: ReactNode;
};

function ChartFrame({
  title,
  description,
  badges = [],
  footer,
  actions = [],
  wide = false,
  children,
}: ChartFrameProps) {
  return (
    <article className={`chart-showcase-card ${wide ? "chart-showcase-card-wide" : ""}`}>
      <div className="chart-showcase-head">
        <div>
          <p className="panel-kicker">Chart Note</p>
          <h3>{title}</h3>
          <p className="section-copy">{description}</p>
        </div>
        {badges.length > 0 ? (
          <div className="chart-showcase-badges">
            {badges.map((badge) => (
              <span className="stat-chip" key={badge}>
                {badge}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="chart-showcase-body">{children}</div>

      {footer || actions.length > 0 ? (
        <div className="chart-showcase-footer">
          <p>{footer}</p>
          <div className="chart-showcase-actions">
            {actions.map((action) => (
              <span className="ghost-chip" key={action}>
                {action}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

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
        const moduleQuery = new URLSearchParams({ analysisId: analysisId! });
        const moduleResponse = fetch(`/api/modules?${moduleQuery.toString()}`);
        const seriesResponses = metrics.map((metric) =>
          fetch(
            `/api/series?${new URLSearchParams({
              analysisId: analysisId!,
              metric,
            }).toString()}`,
          ),
        );
        const distributionResponses = metrics.map((metric) =>
          fetch(
            `/api/distribution?${new URLSearchParams({
              analysisId: analysisId!,
              metric,
              snapshot: "latest",
            }).toString()}`,
          ),
        );

        const responses = await Promise.all([
          moduleResponse,
          ...seriesResponses,
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
        const distributionsByMetric = Object.fromEntries(
          await Promise.all(
            metrics.map(async (metric, index) => [
              metric,
              (await responses[index + 1 + metrics.length]!.json()) as DistributionResponseDto,
            ]),
          ),
        ) as Partial<Record<MetricKey, DistributionResponseDto>>;

        if (!cancelled) {
          setQueryState({
            modules,
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
  }, [analysis?.job.id, analysis?.job.status, analysisId]);

  const currentAnalysis = analysis ?? null;
  const currentAnalysisId = analysisId ?? null;
  const repository = currentAnalysis
    ? repositories.find((candidate) => candidate.id === currentAnalysis.job.repositoryId)
    : undefined;
  const locSeries = queryState?.seriesByMetric.loc;
  const latestSnapshot = locSeries ? getLatestSnapshotFromSeries(locSeries) : null;
  const siblingAnalysesBySampling = repository
    ? samplingOptions.map((sampling) => ({
        sampling,
        analysis: Object.values(analysisSummaries).find(
          (summary) =>
            summary?.job.repositoryId === repository.id && summary.job.sampling === sampling,
        ),
      }))
    : [];
  const totalLocSeries = locSeries ? buildTotalLocSeriesFromQuery(locSeries) : null;
  const totalLoc = totalLocSeries?.values.at(-1) ?? 0;
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

  const peakLoc = totalLocSeries?.values.reduce((peak, value) => Math.max(peak, value), 0) ?? 0;

  const chartCards = useMemo<ChartCard[]>(() => {
    const cards: ChartCard[] = [];

    if (locSeries && currentAnalysis) {
      cards.push({
        id: "repo-scale",
        title: "仓库总 LOC 趋势",
        description: "回答“整体规模如何变化”，只看仓库总量，不在这张图里叠加模块细节。",
        badges: [`当前 ${formatMetricValue(totalLoc)}`, `峰值 ${formatMetricValue(peakLoc)}`],
        footer: "适合作为第一张主图，用来建立对仓库长期增长和阶段性跳变的整体感知。",
        actions: ["时间缩放", "悬浮提示", "总量视角"],
        wide: true,
        content: <RepositoryScaleChart series={locSeries} />,
      });

      cards.push({
        id: "stacked-area",
        title: "模块堆叠面积图",
        description: "回答“当前结构由谁构成、份额如何变化”，重点是模块占比和结构迁移。",
        badges: [`${locSeries.series.length} 个模块`, `${locSeries.timeline.length} 个采样点`],
        footer: "先看面积图，再去趋势图和排行图钻取具体模块，是最自然的阅读路径。",
        actions: ["长尾折叠", "模块聚合", "结构对比"],
        wide: true,
        content: <ModuleStackedAreaChart series={locSeries} />,
      });

      cards.push({
        id: "share-stacked-area",
        title: "模块占比 100% 堆叠面积图",
        description: "回答“谁正在吞噬份额、结构迁移有多快”，把绝对 LOC 变化折叠成百分比结构变化。",
        badges: ["结构视角", "100% 归一化", `${locSeries.series.length} 个模块`],
        footer: "当你只关心份额变化而不是总量扩张时，这张图比普通堆叠面积图更有效。",
        actions: ["份额迁移", "Top N", "结构对比"],
        wide: true,
        content: <ModuleShareStackedAreaChart series={locSeries} />,
      });

      cards.push({
        id: "ranking",
        title: "当前模块排行",
        description: "回答“此刻谁最大、谁最活跃”，把当前时间点的模块规模或变更量直接排出来。",
        badges: [`Top 模块 ${topModule?.name ?? "-"}`],
        footer: "这张图最适合做入口：先定位重点模块，再进入模块趋势图查看长期演化。",
        actions: ["切换指标", "Top N", "当前快照"],
        content: <ModuleRankingChart analysisId={currentAnalysis.job.id} />,
      });
    }

    if (queryState?.seriesByMetric.churn) {
      cards.push({
        id: "churn-heatmap",
        title: "Churn 热力图",
        description:
          "回答“哪个阶段最动荡、热点从哪里迁移到哪里”，适合先扫时间热点，再深入具体模块。",
        badges: [
          "时间 x 模块",
          "颜色代表 churn",
          `${queryState.seriesByMetric.churn.series.length} 个模块`,
        ],
        footer: "热力图不擅长精确读值，但极适合发现重构窗口和高频活跃模块。",
        actions: ["热点扫描", "阶段定位", "模块迁移"],
        wide: true,
        content: <ModuleChurnHeatmapChart series={queryState.seriesByMetric.churn} />,
      });
    }

    if (queryState?.seriesByMetric.loc) {
      cards.push({
        id: "candlestick",
        title: "模块 K 线视图",
        description: "把模块 LOC 演化翻译成 K 线语义，用更强的波动感去观察单个模块的变化节奏。",
        badges: [`候选 ${queryState.modules.length} 个模块`, `当前 ${topModule?.name ?? "-"}`],
        footer: "这张图不适合总览，但很适合拿来观察重点模块在不同阶段的增长、回撤和波动幅度。",
        actions: ["模块切换", "K 线语义", "时间窗口"],
        wide: true,
        content: (
          <ModuleCandlestickChart
            seriesByMetric={{
              loc: queryState.seriesByMetric.loc,
              added: queryState.seriesByMetric.added,
              deleted: queryState.seriesByMetric.deleted,
            }}
          />
        ),
      });
    }

    if (queryState?.seriesByMetric.loc) {
      cards.push({
        id: "bump-chart",
        title: "Top N 模块 Bump Chart",
        description: "回答“谁在上升、谁在掉队”，把时间序列翻译成排名轨迹，更适合讲地位变化。",
        badges: ["排名视角", "Top N", "loc / churn"],
        footer: "当你关心模块地位而不是绝对数值时，Bump Chart 的表达会比折线图更直接。",
        actions: ["排名轨迹", "Top N", "loc / churn"],
        wide: true,
        content: <ModuleBumpChart seriesByMetric={queryState.seriesByMetric} />,
      });
    }

    if (queryState && currentAnalysis) {
      cards.push({
        id: "trend",
        title: "模块趋势图",
        description: "回答“某些核心模块分别怎么变”，用于做多模块之间的趋势对比和阶段性对照。",
        badges: ["loc / added / deleted / churn", `${moduleCount} 个模块`],
        footer: "这是最适合深挖模块行为的一张图，建议和排行图、K 线图配合使用。",
        actions: ["指标切换", "搜索模块", "图例筛选", "时间缩放"],
        wide: true,
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
    setActiveChartIndex((current) => {
      if (chartCards.length === 0) {
        return 0;
      }

      return Math.min(current, chartCards.length - 1);
    });
  }, [chartCards.length]);

  if (!analysisId) {
    return (
      <main className="layout">
        <section className="panel">
          <p className="feedback error">分析任务 ID 缺失。</p>
        </section>
      </main>
    );
  }

  if (!analysis || !currentAnalysis || !currentAnalysisId) {
    return (
      <main className="layout">
        <section className="panel">
          <div className="detail-header">
            <Link className="ghost-button detail-link-button" to="/">
              返回仓库列表
            </Link>
          </div>
          <p className="feedback">正在加载分析详情...</p>
        </section>
      </main>
    );
  }

  const loadedAnalysis = currentAnalysis;
  const loadedAnalysisId = currentAnalysisId;

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

  return (
    <main className="layout">
      <section className="panel detail-hero">
        <div className="detail-header">
          <div>
            <p className="panel-kicker">Analysis Detail</p>
            <h1 className="detail-title">{repository?.name ?? loadedAnalysis.job.repositoryId}</h1>
            <p className="hero-copy">
              当前按 {getSamplingLabel(loadedAnalysis.job.sampling)}{" "}
              采样展示仓库演化趋势，图表仍完全基于现有查询接口加载。
            </p>
            <div className="hero-filter detail-sampling-switch">
              {siblingAnalysesBySampling.map(({ sampling, analysis }) =>
                analysis ? (
                  <Link
                    className={`hero-filter-button ${loadedAnalysis.job.sampling === sampling ? "active" : ""}`}
                    key={sampling}
                    to={`/analyses/${analysis.job.id}`}
                  >
                    {getSamplingLabel(sampling)}
                  </Link>
                ) : (
                  <button
                    className={`hero-filter-button detail-sampling-missing ${loadedAnalysis.job.sampling === sampling ? "active" : ""}`}
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
            <div className="detail-meta-strip">
              <span className="mono-badge">
                {repository?.defaultBranch ?? loadedAnalysis.job.branch}
              </span>
              <span className="mono-badge">{loadedAnalysis.job.status}</span>
              <span className="mono-badge">{getSamplingLabel(loadedAnalysis.job.sampling)}</span>
              <span className="mono-badge">{loadedAnalysis.snapshots.length} 个采样点</span>
            </div>
          </div>
          <div className="detail-actions">
            <Link className="ghost-button detail-link-button" to="/">
              返回工作台
            </Link>
            <button className="ghost-button" onClick={() => void handleRefresh()} type="button">
              刷新任务
            </button>
          </div>
        </div>

        <div className="overview-stats">
          <div className="overview-stat-card">
            <span>当前总 LOC</span>
            <strong>{formatMetricValue(totalLoc)}</strong>
          </div>
          <div className="overview-stat-card">
            <span>模块数</span>
            <strong>{formatMetricValue(moduleCount)}</strong>
          </div>
          <div className="overview-stat-card">
            <span>最新采样</span>
            <strong>{latestSnapshot?.ts.slice(0, 10) ?? "-"}</strong>
          </div>
          <div className="overview-stat-card">
            <span>最大模块</span>
            <strong>{topModule?.name ?? "-"}</strong>
          </div>
          <div className="overview-stat-card">
            <span>新增 / 删除 / Churn</span>
            <strong>
              {formatMetricValue(totalAdded)} / {formatMetricValue(totalDeleted)} /{" "}
              {formatMetricValue(totalChurn)}
            </strong>
          </div>
        </div>

        {loadedAnalysis.job.status === "pending" || loadedAnalysis.job.status === "running" ? (
          <ProgressBar analysis={loadedAnalysis} />
        ) : null}
        {queryLoading ? <p className="feedback">正在加载查询接口数据...</p> : null}
        {queryError ? <p className="feedback error">{queryError}</p> : null}
      </section>

      {chartCards.length > 0 ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Chart Gallery</p>
              <h2>图表分析区</h2>
              <p className="section-copy">
                一次只展示一张图表卡，通过左右切换聚焦当前视图，避免整页下拉式堆叠。
              </p>
            </div>
            <div className="chart-gallery-controls">
              <button
                className="ghost-button"
                disabled={activeChartIndex <= 0}
                onClick={() => setActiveChartIndex((current) => Math.max(0, current - 1))}
                type="button"
              >
                上一张
              </button>
              <span className="stat-chip">
                {activeChartIndex + 1} / {chartCards.length}
              </span>
              <button
                className="ghost-button"
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

          <div className="chart-gallery-tabs">
            {chartCards.map((card, index) => (
              <button
                aria-pressed={index === activeChartIndex}
                className={`chart-gallery-tab ${index === activeChartIndex ? "active" : ""}`}
                key={card.id}
                onClick={() => setActiveChartIndex(index)}
                type="button"
              >
                {card.title}
              </button>
            ))}
          </div>

          <ChartFrame
            actions={chartCards[activeChartIndex]?.actions}
            badges={chartCards[activeChartIndex]?.badges}
            description={chartCards[activeChartIndex]?.description ?? ""}
            footer={chartCards[activeChartIndex]?.footer}
            title={chartCards[activeChartIndex]?.title ?? ""}
            wide
          >
            {chartCards[activeChartIndex]?.content}
          </ChartFrame>
        </section>
      ) : null}
    </main>
  );
}
