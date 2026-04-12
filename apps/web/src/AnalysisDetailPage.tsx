import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import type {
  AnalysisDetailSummaryDto,
  AnalysisResultDto,
  AnalysisSamplingDto,
  AnalysisSummaryDto,
  CandlesResponseDto,
  RankingResponseDto,
  RepositoryTargetDto,
  SeriesResponseDto,
} from "@code-dance/contracts";
import {
  buildMetricSeriesFromQuery,
  buildTotalLocSeriesFromQuery,
  formatMetricValue,
  getLatestSnapshotFromSeries,
  type MetricKey,
} from "./analysis-data";
import { ModuleBumpChart } from "./charts/ModuleBumpChart";
import { ModuleCalendarHeatmapChart } from "./charts/ModuleCalendarHeatmapChart";
import { ModuleCandlestickChart } from "./charts/ModuleCandlestickChart";
import { ModuleChurnHeatmapChart } from "./charts/ModuleChurnHeatmapChart";
import { ModuleLifecycleChart } from "./charts/ModuleLifecycleChart";
import { ModuleRankingChart } from "./charts/ModuleRankingChart";
import { ModuleRiskScatterChart } from "./charts/ModuleRiskScatterChart";
import { ModuleShareStackedAreaChart } from "./charts/ModuleShareStackedAreaChart";
import { ModuleStackedAreaChart } from "./charts/ModuleStackedAreaChart";
import { ModuleTrendChart } from "./charts/ModuleTrendChart";
import { RepositoryScaleChart } from "./charts/RepositoryScaleChart";
import { ProgressBar } from "./ProgressBar";
import { formatProgressPhase } from "./display";
import { useI18n } from "./i18n";
import { getSamplingLabel, samplingOptions } from "./sampling";
import { usePageQueryCache } from "./use-page-query-cache";

type AnalysisDetailPageProps = {
  analysisSummaries: Record<string, AnalysisSummaryDto | undefined>;
  onRefreshAnalysisDetailSummary: (analysisId: string) => Promise<AnalysisDetailSummaryDto | null>;
  onRefreshAnalysisSummary: (analysisId: string) => Promise<AnalysisSummaryDto | null>;
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
const chartOrder = [
  "repo-scale",
  "stacked-area",
  "share-stacked-area",
  "lifecycle",
  "ranking",
  "churn-heatmap",
  "risk-scatter",
  "calendar-heatmap",
  "candlestick",
  "bump-chart",
  "trend",
] as const;

export function AnalysisDetailPage({
  analysisSummaries,
  onRefreshAnalysisDetailSummary,
  onRefreshAnalysisSummary,
  onRunAnalysis,
  repositories,
}: AnalysisDetailPageProps) {
  const { t, formatDate, formatNumber } = useI18n();
  const navigate = useNavigate();
  const { analysisId } = useParams();
  const analysisSummary = analysisId ? analysisSummaries[analysisId] : undefined;
  const queryCache = usePageQueryCache();
  const [queryError, setQueryError] = useState<string | null>(null);
  const [detailSummary, setDetailSummary] = useState<AnalysisDetailSummaryDto | null>(null);
  const [activeChartIndex, setActiveChartIndex] = useState(0);
  const [rankingMetric, setRankingMetric] = useState<MetricKey>("loc");
  const [rankingVisibleCount, setRankingVisibleCount] = useState<8 | 16>(8);
  const [samplingActionLoading, setSamplingActionLoading] = useState<AnalysisSamplingDto | null>(
    null,
  );
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  const currentAnalysisId = analysisId ?? "";

  useEffect(() => {
    setActiveChartIndex(0);
    setRankingMetric("loc");
    setRankingVisibleCount(8);
    setQueryError(null);
    setDetailSummary(null);
    queryCache.clear();
  }, [currentAnalysisId, queryCache]);

  useEffect(() => {
    if (!currentAnalysisId) {
      return;
    }

    void onRefreshAnalysisDetailSummary(currentAnalysisId).then((summary) => {
      if (summary && summary.job.id === currentAnalysisId) {
        setDetailSummary(summary);
      }
    });
  }, [currentAnalysisId, detailRefreshToken, onRefreshAnalysisDetailSummary]);

  useEffect(() => {
    if (!currentAnalysisId || analysisSummary) {
      return;
    }

    void onRefreshAnalysisSummary(currentAnalysisId);
  }, [currentAnalysisId, analysisSummary, onRefreshAnalysisSummary]);

  useEffect(() => {
    if (!analysisSummary || !detailSummary || analysisSummary.job.id !== detailSummary.job.id) {
      return;
    }

    setDetailSummary((current) =>
      current && current.job.id === analysisSummary.job.id
        ? current.job.status === analysisSummary.job.status &&
          current.progress.phase === analysisSummary.progress.phase &&
          current.progress.percent === analysisSummary.progress.percent &&
          current.snapshotCount === analysisSummary.snapshotCount &&
          current.latestSnapshot?.seq === analysisSummary.latestSnapshot?.seq
          ? current
          : {
              ...current,
              job: analysisSummary.job,
              progress: analysisSummary.progress,
              snapshotCount: analysisSummary.snapshotCount,
              latestSnapshot: analysisSummary.latestSnapshot,
            }
        : current,
    );
  }, [analysisSummary, detailSummary]);

  const defaultModuleKeys = detailSummary?.defaultModuleKeys ?? [];
  const seriesQueryKey = (metric: MetricKey, moduleKeys?: string[] | null, all = false) =>
    `series:${currentAnalysisId}:${metric}:${all ? "__all__" : moduleKeys === null ? "__default__" : (moduleKeys ?? []).join(",")}`;
  const candlesQueryKey = (moduleKeys: string[], sampling?: AnalysisSamplingDto, all = false) =>
    `candles:${currentAnalysisId}:${sampling ?? ""}:${all ? "__all__" : moduleKeys.join(",")}`;
  const rankingQueryKey = (metric: MetricKey, limit: 8 | 16) =>
    `ranking:${currentAnalysisId}:${metric}:${limit}`;

  const loadSeries = async (metric: MetricKey, moduleKeys?: string[] | null, all = false) => {
    if (!analysisId) {
      return null;
    }

    const requestedModuleKeys = moduleKeys === undefined ? defaultModuleKeys : moduleKeys;

    try {
      return await queryCache.load(seriesQueryKey(metric, requestedModuleKeys, all), async () => {
        const params = new URLSearchParams({ analysisId, metric });
        if (all) {
          params.set("all", "true");
        } else if (requestedModuleKeys && requestedModuleKeys.length > 0) {
          params.set("moduleKeys", requestedModuleKeys.join(","));
        }
        const response = await fetch(
          `/api/series?${params.toString()}`,
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as ApiError | null;
          throw new Error(payload?.message ?? `failed to load ${metric} series`);
        }

        const payload = (await response.json()) as SeriesResponseDto;
        return payload;
      });
    } catch (requestError) {
      setQueryError(
        requestError instanceof Error ? requestError.message : t("feedback.errorFallback"),
      );
      return null;
    }
  };

  const loadCandles = async (
    moduleKeys = defaultModuleKeys,
    sampling = detailSummary?.job.sampling,
    all = false,
  ) => {
    if (!analysisId) {
      return null;
    }

    try {
      return await queryCache.load(candlesQueryKey(moduleKeys, sampling, all), async () => {
        const params = new URLSearchParams({ analysisId });
        if (sampling) {
          params.set("sampling", sampling);
        }
        if (all) {
          params.set("all", "true");
        } else if (moduleKeys.length > 0) {
          params.set("moduleKeys", moduleKeys.join(","));
        }
        const response = await fetch(`/api/candles?${params.toString()}`);
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as ApiError | null;
          throw new Error(payload?.message ?? t("feedback.errorFallback"));
        }

        const payload = (await response.json()) as CandlesResponseDto;
        return payload;
      });
    } catch (requestError) {
      setQueryError(
        requestError instanceof Error ? requestError.message : t("feedback.errorFallback"),
      );
      return null;
    }
  };

  const loadRanking = async (metric: MetricKey, limit: 8 | 16) => {
    if (!analysisId) {
      return null;
    }

    try {
      return await queryCache.load(rankingQueryKey(metric, limit), async () => {
        const response = await fetch(
          `/api/ranking?${new URLSearchParams({
            analysisId,
            metric,
            snapshot: "latest",
            limit: String(limit),
          }).toString()}`,
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as ApiError | null;
          throw new Error(payload?.message ?? t("feedback.errorFallback"));
        }

        const payload = (await response.json()) as RankingResponseDto;
        return payload;
      });
    } catch (requestError) {
      setQueryError(
        requestError instanceof Error ? requestError.message : t("feedback.errorFallback"),
      );
      return null;
    }
  };

  useEffect(() => {
    if (!detailSummary || detailSummary.job.status !== "done") {
      return;
    }

    void loadSeries("loc");
  }, [currentAnalysisId, detailSummary?.job.status, defaultModuleKeys.join(","), detailRefreshToken]);

  useEffect(() => {
    if (!detailSummary || detailSummary.job.status !== "done") {
      return;
    }

    const activeChartId = chartOrder[activeChartIndex];
    if (activeChartId === "ranking") {
      void loadRanking(rankingMetric, rankingVisibleCount);
      return;
    }

    if (activeChartId === "candlestick") {
      void loadCandles();
      return;
    }

    if (activeChartId === "churn-heatmap") {
      void loadSeries("churn");
      return;
    }

    if (activeChartId === "risk-scatter") {
      void Promise.all([loadSeries("loc"), loadSeries("churn")]);
      return;
    }

    if (activeChartId === "calendar-heatmap") {
      void loadSeries("churn", null, true);
      return;
    }

    if (activeChartId === "lifecycle") {
      void loadSeries("loc", null, true);
      return;
    }

    if (activeChartId === "trend") {
      void Promise.all(metrics.map((metric) => loadSeries(metric)));
      return;
    }

    if (activeChartId === "bump-chart") {
      void Promise.all((["loc", "churn"] as const).map((metric) => loadSeries(metric)));
    }
  }, [
    currentAnalysisId,
    activeChartIndex,
    defaultModuleKeys.join(","),
    detailRefreshToken,
    detailSummary?.job.sampling,
    detailSummary?.job.status,
    rankingMetric,
    rankingVisibleCount,
  ]);

  const currentAnalysis = detailSummary ?? null;
  const repository = detailSummary?.repository ?? repositories.find((candidate) => candidate.id === currentAnalysis?.job.repositoryId);
  const modules = detailSummary?.modules ?? [];
  const locSeries = queryCache.get<SeriesResponseDto>(seriesQueryKey("loc", defaultModuleKeys)) ?? null;
  const fullLocSeries = queryCache.get<SeriesResponseDto>(seriesQueryKey("loc", null, true)) ?? null;
  const addedSeries =
    queryCache.get<SeriesResponseDto>(seriesQueryKey("added", defaultModuleKeys)) ?? null;
  const fullAddedSeries = queryCache.get<SeriesResponseDto>(seriesQueryKey("added", null, true)) ?? null;
  const deletedSeries =
    queryCache.get<SeriesResponseDto>(seriesQueryKey("deleted", defaultModuleKeys)) ?? null;
  const fullDeletedSeries = queryCache.get<SeriesResponseDto>(seriesQueryKey("deleted", null, true)) ?? null;
  const churnSeries =
    queryCache.get<SeriesResponseDto>(seriesQueryKey("churn", defaultModuleKeys)) ?? null;
  const fullChurnSeries = queryCache.get<SeriesResponseDto>(seriesQueryKey("churn", null, true)) ?? null;
  const candles =
    queryCache.get<CandlesResponseDto>(
      candlesQueryKey(defaultModuleKeys, detailSummary?.job.sampling),
    ) ?? null;
  const fullCandles =
    queryCache.get<CandlesResponseDto>(
      candlesQueryKey(defaultModuleKeys, detailSummary?.job.sampling, true),
    ) ?? null;
  const rankingResponse =
    queryCache.get<RankingResponseDto>(rankingQueryKey(rankingMetric, rankingVisibleCount)) ?? null;
  const seriesByMetric: Partial<Record<MetricKey, SeriesResponseDto>> = {
    loc: locSeries ?? undefined,
    added: addedSeries ?? undefined,
    deleted: deletedSeries ?? undefined,
    churn: churnSeries ?? undefined,
  };
  const fullSeriesByMetric: Partial<Record<MetricKey, SeriesResponseDto>> = {
    loc: fullLocSeries ?? undefined,
    added: fullAddedSeries ?? undefined,
    deleted: fullDeletedSeries ?? undefined,
    churn: fullChurnSeries ?? undefined,
  };
  const totalLocSeries = locSeries ? buildTotalLocSeriesFromQuery(locSeries) : null;
  const totalLoc = totalLocSeries?.values.at(-1) ?? 0;
  const peakLoc = totalLocSeries?.values.reduce((peak, value) => Math.max(peak, value), 0) ?? 0;
  const latestSnapshot = locSeries ? getLatestSnapshotFromSeries(locSeries) : currentAnalysis?.latestSnapshot ?? null;
  const moduleCount = modules.length;
  const defaultModuleCount = locSeries?.series.length ?? 0;
  const fullModuleCount = fullLocSeries?.series.length ?? null;
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
    return [
      {
        id: "repo-scale",
        tabLabel: t("chart.tabs.repoScale"),
        category: t("chart.focusCard.category.summary"),
        title: t("chart.repoScale.title"),
        description: t("chart.repoScale.description"),
        summary: [
          t("chart.repoScale.summary.current", { value: formatMetricValue(totalLoc) }),
          t("chart.repoScale.summary.peak", { value: formatMetricValue(peakLoc) }),
        ],
        content: locSeries ? (
          <RepositoryScaleChart series={locSeries} showHeader={false} />
        ) : (
          <div className="empty-state">
            <strong>{t("chart.empty.waitOverview")}</strong>
            <p>{t("chart.empty.loadOverview")}</p>
          </div>
        ),
      },
      {
        id: "stacked-area",
        tabLabel: t("chart.tabs.stacked"),
        category: t("chart.focusCard.category.structure"),
        title: t("chart.stacked.title"),
        description: t("chart.stacked.description"),
        summary: [
          fullModuleCount
            ? t("chart.summary.loadedAll", { count: formatNumber(fullModuleCount) })
            : t("chart.summary.loadedTop", { count: formatNumber(defaultModuleCount) }),
          t("chart.summary.points", { count: formatNumber(locSeries?.timeline.length ?? 0) }),
        ],
        content: locSeries ? (
          <ModuleStackedAreaChart
            allSeries={fullLocSeries}
            allSeriesLoading={queryCache.isPending(seriesQueryKey("loc", null, true))}
            onRequestAllSeries={() => {
              void loadSeries("loc", null, true);
            }}
            series={locSeries}
            showHeader={false}
          />
        ) : (
          <div className="empty-state">
            <strong>{t("chart.empty.waitStructure")}</strong>
            <p>{t("chart.empty.loadStructure")}</p>
          </div>
        ),
      },
      {
        id: "share-stacked-area",
        tabLabel: t("chart.tabs.share"),
        category: t("chart.focusCard.category.structure"),
        title: t("chart.share.title"),
        description: t("chart.share.description"),
        summary: [
          t("chart.summary.normalized"),
          fullModuleCount
            ? t("chart.summary.loadedAll", { count: formatNumber(fullModuleCount) })
            : t("chart.summary.loadedTop", { count: formatNumber(defaultModuleCount) }),
        ],
        content: locSeries ? (
          <ModuleShareStackedAreaChart
            allSeries={fullLocSeries}
            allSeriesLoading={queryCache.isPending(seriesQueryKey("loc", null, true))}
            onRequestAllSeries={() => {
              void loadSeries("loc", null, true);
            }}
            series={locSeries}
            showHeader={false}
          />
        ) : (
          <div className="empty-state">
            <strong>{t("chart.empty.waitShare")}</strong>
            <p>{t("chart.empty.loadStructure")}</p>
          </div>
        ),
      },
      {
        id: "lifecycle",
        tabLabel: t("chart.tabs.lifecycle"),
        category: t("chart.focusCard.category.trend"),
        title: t("chart.lifecycle.title"),
        description: t("chart.lifecycle.description"),
        summary: [
          fullLocSeries
            ? t("chart.summary.loadedAll", { count: formatNumber(fullLocSeries.series.length) })
            : t("chart.summary.loadedTop", { count: formatNumber(defaultModuleCount) }),
          t("chart.lifecycle.summary.rules"),
        ],
        content: fullLocSeries ? (
          <ModuleLifecycleChart series={fullLocSeries} showHeader={false} />
        ) : (
          <div className="empty-state">
            <strong>{t("chart.empty.waitStructure")}</strong>
            <p>{t("chart.empty.loadStructure")}</p>
          </div>
        ),
      },
      {
        id: "ranking",
        tabLabel: t("chart.tabs.ranking"),
        category: t("chart.focusCard.category.summary"),
        title: t("chart.ranking.title"),
        description: t("chart.ranking.description"),
        summary: [rankingResponse?.items[0]?.moduleName ?? "-"],
        content: (
          <ModuleRankingChart
            metric={rankingMetric}
            onMetricChange={setRankingMetric}
            onVisibleCountChange={setRankingVisibleCount}
            ranking={rankingResponse}
            showHeader={false}
            visibleCount={rankingVisibleCount}
          />
        ),
      },
      {
        id: "churn-heatmap",
        tabLabel: t("chart.tabs.churn"),
        category: t("chart.focusCard.category.volatility"),
        title: t("chart.churn.title"),
        description: t("chart.churn.description"),
        summary: [
          t("chart.churn.summary.modules", { count: formatNumber(churnSeries?.series.length ?? 0) }),
          t("chart.summary.timeByModule"),
        ],
        content: churnSeries ? (
          <ModuleChurnHeatmapChart
            allSeries={fullChurnSeries}
            allSeriesLoading={queryCache.isPending(seriesQueryKey("churn", null, true))}
            onRequestAllSeries={() => {
              void loadSeries("churn", null, true);
            }}
            series={churnSeries}
            showHeader={false}
          />
        ) : (
          <div className="empty-state">
            <strong>{t("chart.empty.waitTrend")}</strong>
            <p>{t("chart.empty.loadSeries", { metric: "churn" })}</p>
          </div>
        ),
      },
      {
        id: "risk-scatter",
        tabLabel: t("chart.tabs.risk"),
        category: t("chart.focusCard.category.volatility"),
        title: t("chart.risk.title"),
        description: t("chart.risk.description"),
        summary: [
          locSeries
            ? t("chart.summary.loadedTop", { count: formatNumber(locSeries.series.length) })
            : t("chart.summary.loadedTop", { count: "0" }),
          t("chart.risk.summary.axes"),
        ],
        content:
          locSeries && churnSeries ? (
            <ModuleRiskScatterChart
              allChurnSeries={fullChurnSeries}
              allLocSeries={fullLocSeries}
              allSeriesLoading={
                queryCache.isPending(seriesQueryKey("loc", null, true)) ||
                queryCache.isPending(seriesQueryKey("churn", null, true))
              }
              churnSeries={churnSeries}
              locSeries={locSeries}
              onRequestAllSeries={() => {
                void Promise.all([loadSeries("loc", null, true), loadSeries("churn", null, true)]);
              }}
              showHeader={false}
            />
          ) : (
            <div className="empty-state">
              <strong>{t("chart.empty.waitTrend")}</strong>
              <p>{t("chart.empty.loadTrend")}</p>
            </div>
          ),
      },
      {
        id: "calendar-heatmap",
        tabLabel: t("chart.tabs.calendar"),
        category: t("chart.focusCard.category.volatility"),
        title: t("chart.calendar.title"),
        description: t("chart.calendar.description"),
        summary: [
          fullChurnSeries
            ? t("chart.summary.loadedAll", { count: formatNumber(fullChurnSeries.timeline.length) })
            : t("chart.summary.points", { count: formatNumber(churnSeries?.timeline.length ?? 0) }),
          t("chart.calendar.summary.sampled"),
        ],
        content: fullChurnSeries ? (
          <ModuleCalendarHeatmapChart series={fullChurnSeries} showHeader={false} />
        ) : (
          <div className="empty-state">
            <strong>{t("chart.empty.waitTrend")}</strong>
            <p>{t("chart.empty.loadSeries", { metric: "churn" })}</p>
          </div>
        ),
      },
      {
        id: "candlestick",
        tabLabel: t("chart.tabs.candles"),
        category: t("chart.focusCard.category.volatility"),
        title: t("chart.candles.titleFallback"),
        description: t("chart.candles.description"),
        summary: [
          fullCandles
            ? t("chart.candles.summary.candidatesAll", { count: formatNumber(fullCandles.series.length) })
            : t("chart.candles.summary.candidatesTop", { count: formatNumber(candles?.series.length ?? 0) }),
          t("chart.candles.summary.currentPair", { name: topModule?.name ?? "-" }),
        ],
        content: candles ? (
          <ModuleCandlestickChart
            allCandles={fullCandles}
            allCandlesLoading={queryCache.isPending(
              candlesQueryKey(defaultModuleKeys, detailSummary?.job.sampling, true),
            )}
            candles={candles}
            onRequestAllCandles={() => {
              void loadCandles(defaultModuleKeys, detailSummary?.job.sampling, true);
            }}
            showHeader={false}
          />
        ) : (
          <div className="empty-state">
            <strong>{t("chart.empty.waitCandles")}</strong>
            <p>{t("chart.empty.loadCandles")}</p>
          </div>
        ),
      },
      {
        id: "bump-chart",
        tabLabel: t("chart.tabs.bump"),
        category: t("chart.focusCard.category.trend"),
        title: t("chart.bump.title"),
        description: t("chart.bump.description"),
        summary: [t("chart.bump.rank"), "Top N"],
        content: (
          <ModuleBumpChart
            allSeriesByMetric={{
              loc: fullLocSeries,
              churn: fullChurnSeries,
            }}
            allSeriesLoadingByMetric={{
              loc: queryCache.isPending(seriesQueryKey("loc", null, true)),
              churn: queryCache.isPending(seriesQueryKey("churn", null, true)),
            }}
            onRequestAllSeries={(metric) => {
              void loadSeries(metric, null, true);
            }}
            seriesByMetric={seriesByMetric}
            showHeader={false}
          />
        ),
      },
      {
        id: "trend",
        tabLabel: t("chart.tabs.trend"),
        category: t("chart.focusCard.category.trend"),
        title: t("chart.trend.title"),
        description: t("chart.trend.description"),
        summary: [
          fullSeriesByMetric.loc
            ? t("chart.summary.loadedAll", { count: formatNumber(fullSeriesByMetric.loc.series.length) })
            : t("chart.summary.loadedTop", { count: formatNumber(locSeries?.series.length ?? 0) }),
          "loc / added / deleted / churn",
        ],
        content:
          seriesByMetric.loc &&
          seriesByMetric.added &&
          seriesByMetric.deleted &&
          seriesByMetric.churn ? (
            <ModuleTrendChart
              allSeriesByMetric={fullSeriesByMetric}
              allSeriesLoadingByMetric={{
                loc: queryCache.isPending(seriesQueryKey("loc", null, true)),
                added: queryCache.isPending(seriesQueryKey("added", null, true)),
                deleted: queryCache.isPending(seriesQueryKey("deleted", null, true)),
                churn: queryCache.isPending(seriesQueryKey("churn", null, true)),
              }}
              analysisId={currentAnalysis?.job.id ?? currentAnalysisId}
              onRequestAllSeries={(metric) => {
                void loadSeries(metric, null, true);
              }}
              seriesByMetric={seriesByMetric}
              showHeader={false}
            />
          ) : (
            <div className="empty-state">
              <strong>{t("chart.empty.waitTrend")}</strong>
              <p>{t("chart.empty.loadTrend")}</p>
            </div>
          ),
      },
    ];
  }, [
    candles,
    currentAnalysis?.job.id,
    currentAnalysisId,
    defaultModuleCount,
    fullCandles,
    fullChurnSeries,
    fullLocSeries,
    formatNumber,
    locSeries,
    moduleCount,
    peakLoc,
    rankingMetric,
    rankingResponse,
    rankingVisibleCount,
    fullSeriesByMetric,
    seriesByMetric,
    topModule?.name,
    totalLoc,
    t,
    churnSeries,
  ]);

  useEffect(() => {
    setActiveChartIndex((current) => Math.min(current, Math.max(chartCards.length - 1, 0)));
  }, [chartCards.length]);

  if (!analysisId) {
    return (
      <main className="page-grid">
        <section className="surface-section">
          <div className="empty-state">
            <strong>{t("feedback.analysisMissingId")}</strong>
            <p>{t("feedback.analysisMissing")}</p>
          </div>
        </section>
      </main>
    );
  }

  if (!currentAnalysis) {
    return (
      <main className="page-grid">
        <section className="surface-section">
          <div className="section-heading section-heading-inline">
            <div>
              <p className="section-kicker">{t("page.analysis.title")}</p>
              <h2>{t("feedback.analysisLoading")}</h2>
            </div>
            <Link className="secondary-button" to="/">
              {t("action.backToWorkspace")}
            </Link>
          </div>
          <div className="empty-state">
            <strong>{t("feedback.analysisLoading")}</strong>
            <p>{t("feedback.analysisSummaryLoading")}</p>
          </div>
        </section>
      </main>
    );
  }

  const loadedAnalysis = currentAnalysis;

  async function handleRefresh() {
    if (!analysisId) {
      return;
    }

    const refreshed = await onRefreshAnalysisDetailSummary(analysisId);
    if (!refreshed) {
      return;
    }

    setDetailSummary(refreshed);
    queryCache.clear();
    setQueryError(null);
    setDetailRefreshToken((current) => current + 1);
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
            <h2>{repository?.name ?? loadedAnalysis.job.repositoryId}</h2>
          </div>
          <div className="detail-action-row">
            <Link className="secondary-button" to="/">
              {t("action.backToWorkspace")}
            </Link>
            <button className="secondary-button" onClick={() => void handleRefresh()} type="button">
              {t("action.refreshJob")}
            </button>
          </div>
        </div>

        <div className="detail-toolbar">
          <div className="segmented-control">
            {siblingAnalysesBySampling.map(({ sampling, analysis: sibling }) =>
              sibling ? (
                <Link
                  className={`segmented-option ${loadedAnalysis.job.sampling === sampling ? "active" : ""}`}
                  key={sampling}
                  to={`/analyses/${sibling.job.id}`}
                >
                  {getSamplingLabel(sampling)}
                </Link>
              ) : (
                <button
                  className={`segmented-option ${loadedAnalysis.job.sampling === sampling ? "active" : ""}`}
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
              {t("label.branch")} {repository?.defaultBranch ?? loadedAnalysis.job.branch}
            </span>
            <span className="meta-chip">
              {t("page.analysis.metaStatus", { status: loadedAnalysis.job.status })}
            </span>
            <span className="meta-chip">
              {t("page.analysis.metaPoints", { count: formatNumber(loadedAnalysis.snapshotCount) })}
            </span>
          </div>
        </div>

        <div className="summary-grid detail-summary-grid">
          <article className="summary-card">
            <span>{t("label.currentLoc")}</span>
            <strong>{formatMetricValue(totalLoc)}</strong>
            <p>{t("page.analysis.summaryBody.currentLoc")}</p>
          </article>
          <article className="summary-card">
            <span>{t("label.moduleCount")}</span>
            <strong>{formatMetricValue(moduleCount)}</strong>
            <p>{t("page.analysis.summaryBody.moduleCount")}</p>
          </article>
          <article className="summary-card">
            <span>{t("label.latestSampling")}</span>
            <strong>{latestSnapshot?.ts ? formatDate(latestSnapshot.ts) : "-"}</strong>
            <p>{t("page.analysis.summaryBody.latestSampling")}</p>
          </article>
          <article className="summary-card">
            <span>{t("label.keyModule")}</span>
            <strong>{topModule?.name ?? "-"}</strong>
            <p>{t("page.analysis.summaryBody.keyModule")}</p>
          </article>
          <article className="summary-card">
            <span>{t("label.phase")}</span>
            <strong>{formatProgressPhase(loadedAnalysis.progress.phase)}</strong>
            <p>{t("page.analysis.summaryBody.phase")}</p>
          </article>
        </div>

        {loadedAnalysis.job.status === "pending" || loadedAnalysis.job.status === "running" ? (
          <ProgressBar analysis={loadedAnalysis} />
        ) : null}
        {queryError ? <p className="feedback error">{queryError}</p> : null}
      </section>

      {loadedAnalysis.job.status === "done" ? (
        <section className="surface-section analysis-stage">
          <div className="section-heading section-heading-inline">
            <div>
              <h2>{t("page.analysis.focus")}</h2>
            </div>
            <div className="analysis-stage-nav">
              <button
                className="secondary-button"
                disabled={activeChartIndex <= 0}
                onClick={() => setActiveChartIndex((current) => Math.max(0, current - 1))}
                type="button"
              >
                {t("action.previousChart")}
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
                {t("action.nextChart")}
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

          {activeChart ? (
            <article className="analysis-focus-card">
              <div className="analysis-focus-head">
                <div>
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
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
