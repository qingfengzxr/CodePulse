import type {
  AnalysisResultDto,
  CandlesResponseDto,
  DistributionResponseDto,
  MetricPointDto,
  RankingResponseDto,
  SeriesResponseDto,
} from "@code-dance/contracts";

import { formatMetricLabel as formatMetricLabelText } from "./display";
import { formatNumberValue, translate } from "./i18n";

export type MetricKey = "loc" | "added" | "deleted" | "churn";

export type MetricModuleSeries = {
  key: string;
  name: string;
  kind: string;
  values: number[];
  latestValue: number;
  peakValue: number;
};

export type RankingEntry = {
  key: string;
  name: string;
  kind: string;
  value: number;
};

export type LifecycleStage = "new" | "growth" | "stable" | "decline" | "dormant";

export type RiskScatterPoint = {
  key: string;
  name: string;
  kind: string;
  latestLoc: number;
  latestChurn: number;
  recentAverageChurn: number;
  peakChurn: number;
  sizeMetric: number;
};

export type LifecycleModuleEntry = {
  key: string;
  name: string;
  kind: string;
  stage: LifecycleStage;
  firstActiveIndex: number;
  lastActiveIndex: number;
  activeSpan: number;
  latestLoc: number;
  peakLoc: number;
  recentTrend: number;
};

export type CalendarHeatEntry = {
  date: string;
  value: number;
  snapshotCount: number;
};

export function formatMetricLabel(metric: MetricKey): string {
  return formatMetricLabelText(metric);
}

export function formatMetricValue(value: number): string {
  return formatNumberValue(value);
}

export function getTimeline(analysis: AnalysisResultDto): string[] {
  return Array.from(new Set(analysis.snapshots.map((snapshot) => snapshot.ts))).sort(
    (left, right) => left.localeCompare(right),
  );
}

function groupPointsByModule(
  analysis: AnalysisResultDto,
  metric: MetricKey,
): Map<string, { key: string; name: string; kind: string; values: Map<string, number> }> {
  const grouped = new Map<
    string,
    { key: string; name: string; kind: string; values: Map<string, number> }
  >();

  for (const point of analysis.points) {
    if (!grouped.has(point.moduleKey)) {
      grouped.set(point.moduleKey, {
        key: point.moduleKey,
        name: point.moduleName,
        kind: point.moduleKind,
        values: new Map<string, number>(),
      });
    }

    grouped.get(point.moduleKey)!.values.set(point.ts, point[metric]);
  }

  return grouped;
}

export function buildMetricSeries(
  analysis: AnalysisResultDto,
  metric: MetricKey,
): { xAxis: string[]; modules: MetricModuleSeries[] } {
  const xAxis = getTimeline(analysis);
  const grouped = groupPointsByModule(analysis, metric);

  const modules = Array.from(grouped.values())
    .map((entry) => {
      const values = xAxis.map((ts) => entry.values.get(ts) ?? 0);

      return {
        key: entry.key,
        name: entry.name,
        kind: entry.kind,
        values,
        latestValue: values.at(-1) ?? 0,
        peakValue: values.reduce((peak, value) => Math.max(peak, value), 0),
      };
    })
    .sort((left, right) => {
      if (right.latestValue !== left.latestValue) {
        return right.latestValue - left.latestValue;
      }

      if (right.peakValue !== left.peakValue) {
        return right.peakValue - left.peakValue;
      }

      return left.name.localeCompare(right.name);
    });

  return {
    xAxis,
    modules,
  };
}

export function buildTotalLocSeries(analysis: AnalysisResultDto): {
  xAxis: string[];
  values: number[];
} {
  const xAxis = getTimeline(analysis);
  const totals = new Map<string, number>();

  for (const point of analysis.points) {
    totals.set(point.ts, (totals.get(point.ts) ?? 0) + point.loc);
  }

  return {
    xAxis,
    values: xAxis.map((ts) => totals.get(ts) ?? 0),
  };
}

export function buildCurrentRanking(
  analysis: AnalysisResultDto,
  metric: MetricKey,
): RankingEntry[] {
  const latestTs = analysis.snapshots.at(-1)?.ts;
  if (!latestTs) {
    return [];
  }

  return analysis.points
    .filter((point) => point.ts === latestTs)
    .map((point) => ({
      key: point.moduleKey,
      name: point.moduleName,
      kind: point.moduleKind,
      value: point[metric],
    }))
    .sort((left, right) => {
      if (right.value !== left.value) {
        return right.value - left.value;
      }

      return left.name.localeCompare(right.name);
    });
}

export function buildStackedAreaSeries(
  analysis: AnalysisResultDto,
  visibleLimit: number | "all",
): {
  xAxis: string[];
  modules: Array<{ key: string; name: string; values: number[] }>;
  collapsedCount: number;
} {
  const { xAxis, modules } = buildMetricSeries(analysis, "loc");
  const visibleModules =
    visibleLimit === "all" ? modules : modules.slice(0, Math.max(1, visibleLimit));
  const hiddenModules = visibleLimit === "all" ? [] : modules.slice(Math.max(1, visibleLimit));

  const resultModules = visibleModules.map((module) => ({
    key: module.key,
    name: module.name,
    values: module.values,
  }));

  if (hiddenModules.length > 0) {
    resultModules.push({
      key: "others",
      name: translate("label.others"),
      values: xAxis.map((_, index) =>
        hiddenModules.reduce((sum, module) => sum + (module.values[index] ?? 0), 0),
      ),
    });
  }

  return {
    xAxis,
    modules: resultModules,
    collapsedCount: hiddenModules.length,
  };
}

export function getLatestSnapshot(analysis: AnalysisResultDto) {
  return analysis.snapshots.at(-1) ?? null;
}

export function getTotalMetric(points: MetricPointDto[], metric: MetricKey, ts?: string): number {
  return points
    .filter((point) => !ts || point.ts === ts)
    .reduce((sum, point) => sum + point[metric], 0);
}

export function buildMetricSeriesFromQuery(series: SeriesResponseDto): {
  xAxis: string[];
  modules: MetricModuleSeries[];
} {
  const xAxis = series.timeline.map((snapshot) => snapshot.ts);
  const modules = [...series.series]
    .map((entry) => ({
      key: entry.moduleKey,
      name: entry.moduleName,
      kind: entry.moduleKind,
      values: entry.values,
      latestValue: entry.values.at(-1) ?? 0,
      peakValue: entry.values.reduce((peak, value) => Math.max(peak, value), 0),
    }))
    .sort((left, right) => {
      if (right.latestValue !== left.latestValue) {
        return right.latestValue - left.latestValue;
      }

      if (right.peakValue !== left.peakValue) {
        return right.peakValue - left.peakValue;
      }

      return left.name.localeCompare(right.name);
    });

  return {
    xAxis,
    modules,
  };
}

export function buildTotalLocSeriesFromQuery(series: SeriesResponseDto): {
  xAxis: string[];
  values: number[];
} {
  const { xAxis, modules } = buildMetricSeriesFromQuery(series);

  return {
    xAxis,
    values: xAxis.map((_, index) =>
      modules.reduce((sum, module) => sum + (module.values[index] ?? 0), 0),
    ),
  };
}

export function buildStackedAreaSeriesFromQuery(
  series: SeriesResponseDto,
  visibleLimit: number | "all",
): {
  xAxis: string[];
  modules: Array<{ key: string; name: string; values: number[] }>;
  collapsedCount: number;
} {
  const { xAxis, modules } = buildMetricSeriesFromQuery(series);
  const visibleModules =
    visibleLimit === "all" ? modules : modules.slice(0, Math.max(1, visibleLimit));
  const hiddenModules = visibleLimit === "all" ? [] : modules.slice(Math.max(1, visibleLimit));

  const resultModules = visibleModules.map((module) => ({
    key: module.key,
    name: module.name,
    values: module.values,
  }));

  if (hiddenModules.length > 0) {
    resultModules.push({
      key: "others",
      name: translate("label.others"),
      values: xAxis.map((_, index) =>
        hiddenModules.reduce((sum, module) => sum + (module.values[index] ?? 0), 0),
      ),
    });
  }

  return {
    xAxis,
    modules: resultModules,
    collapsedCount: hiddenModules.length,
  };
}

export function buildPercentageStackedAreaSeriesFromQuery(
  series: SeriesResponseDto,
  visibleLimit: number | "all",
): {
  xAxis: string[];
  modules: Array<{ key: string; name: string; values: number[] }>;
  collapsedCount: number;
} {
  const base = buildStackedAreaSeriesFromQuery(series, visibleLimit);
  const totals = base.xAxis.map((_, index) =>
    base.modules.reduce((sum, module) => sum + (module.values[index] ?? 0), 0),
  );

  return {
    xAxis: base.xAxis,
    collapsedCount: base.collapsedCount,
    modules: base.modules.map((module) => ({
      ...module,
      values: module.values.map((value, index) => {
        const total = totals[index] ?? 0;
        if (total <= 0) {
          return 0;
        }

        return Number(((value / total) * 100).toFixed(2));
      }),
    })),
  };
}

export function buildCurrentRankingFromQuery(ranking: RankingResponseDto): RankingEntry[] {
  return [...ranking.items]
    .map((item) => ({
      key: item.moduleKey,
      name: item.moduleName,
      kind: item.moduleKind,
      value: item.value,
    }))
    .sort((left, right) => {
      if (right.value !== left.value) {
        return right.value - left.value;
      }

      return left.name.localeCompare(right.name);
    });
}

export function buildHeatmapSeriesFromQuery(
  series: SeriesResponseDto,
  visibleLimit: number | "all",
): {
  xAxis: string[];
  yAxis: string[];
  maxValue: number;
  visualMax: number;
  data: Array<[number, number, number, number]>;
} {
  const { xAxis, modules } = buildMetricSeriesFromQuery(series);
  const visibleModules =
    visibleLimit === "all" ? modules : modules.slice(0, Math.max(1, visibleLimit));
  const yAxis = visibleModules.map((module) => module.name);
  const data: Array<[number, number, number, number]> = [];
  let maxValue = 0;
  const nonZeroValues: number[] = [];

  for (const [yIndex, module] of visibleModules.entries()) {
    for (const [xIndex, value] of module.values.entries()) {
      const visualValue = value > 0 ? Math.log10(value + 1) : 0;
      data.push([xIndex, yIndex, visualValue, value]);
      maxValue = Math.max(maxValue, value);
      if (value > 0) {
        nonZeroValues.push(value);
      }
    }
  }

  nonZeroValues.sort((left, right) => left - right);
  const percentileIndex =
    nonZeroValues.length > 0 ? Math.max(0, Math.ceil(nonZeroValues.length * 0.95) - 1) : 0;
  const percentileValue = nonZeroValues[percentileIndex] ?? 0;
  const visualMax =
    percentileValue > 0 ? Math.log10(percentileValue + 1) : maxValue > 0 ? Math.log10(maxValue + 1) : 1;

  return {
    xAxis,
    yAxis,
    maxValue,
    visualMax,
    data,
  };
}

export function getLatestSnapshotFromSeries(series: SeriesResponseDto) {
  return series.timeline.at(-1) ?? null;
}

export function getTotalDistributionValue(distribution: DistributionResponseDto): number {
  return distribution.items.reduce((sum, item) => sum + item.value, 0);
}

export function buildCandlestickSeriesFromQuery(candles: CandlesResponseDto): {
  xAxis: string[];
  modules: Array<{
    key: string;
    name: string;
    kind: string;
    candles: Array<{
      open: number;
      high: number;
      low: number;
      close: number;
    }>;
    latestClose: number;
    peakHigh: number;
  }>;
} {
  return {
    xAxis: candles.timeline.map((snapshot) => snapshot.ts),
    modules: [...candles.series]
      .map((module) => ({
        key: module.moduleKey,
        name: module.moduleName,
        kind: module.moduleKind,
        candles: module.values,
        latestClose: module.values.at(-1)?.close ?? 0,
        peakHigh: module.values.reduce((peak, candle) => Math.max(peak, candle.high), 0),
      }))
      .sort((left, right) => {
        if (right.latestClose !== left.latestClose) {
          return right.latestClose - left.latestClose;
        }

        if (right.peakHigh !== left.peakHigh) {
          return right.peakHigh - left.peakHigh;
        }

        return left.name.localeCompare(right.name);
      }),
  };
}

export function buildBumpChartSeriesFromQuery(
  series: SeriesResponseDto,
  visibleLimit: number | "all",
): {
  xAxis: string[];
  maxRank: number;
  modules: Array<{
    key: string;
    name: string;
    kind: string;
    ranks: number[];
    latestRank: number;
    bestRank: number;
  }>;
} {
  const { xAxis, modules } = buildMetricSeriesFromQuery(series);
  const visibleModules =
    visibleLimit === "all" ? modules : modules.slice(0, Math.max(1, visibleLimit));

  const rankByModuleAndIndex = new Map<string, number[]>();

  for (let index = 0; index < xAxis.length; index += 1) {
    const rankedAtIndex = [...modules].sort((left, right) => {
      const leftValue = left.values[index] ?? 0;
      const rightValue = right.values[index] ?? 0;
      if (rightValue !== leftValue) {
        return rightValue - leftValue;
      }

      return left.name.localeCompare(right.name);
    });

    for (const [rankIndex, module] of rankedAtIndex.entries()) {
      const current = rankByModuleAndIndex.get(module.key) ?? [];
      current[index] = rankIndex + 1;
      rankByModuleAndIndex.set(module.key, current);
    }
  }

  return {
    xAxis,
    maxRank: modules.length,
    modules: visibleModules.map((module) => {
      const ranks = rankByModuleAndIndex.get(module.key) ?? xAxis.map(() => modules.length);

      return {
        key: module.key,
        name: module.name,
        kind: module.kind,
        ranks,
        latestRank: ranks.at(-1) ?? modules.length,
        bestRank: ranks.reduce((best, rank) => Math.min(best, rank), Number.POSITIVE_INFINITY),
      };
    }),
  };
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildRiskScatterDataFromQuery(
  locSeries: SeriesResponseDto,
  churnSeries: SeriesResponseDto,
  visibleLimit: number | "all",
) {
  const { modules: locModules } = buildMetricSeriesFromQuery(locSeries);
  const { modules: churnModules } = buildMetricSeriesFromQuery(churnSeries);
  const churnByModule = new Map(churnModules.map((module) => [module.key, module]));
  const visibleModules =
    visibleLimit === "all" ? locModules : locModules.slice(0, Math.max(1, visibleLimit));

  return visibleModules.map((module) => {
    const churnModule = churnByModule.get(module.key);
    const churnValues = churnModule?.values ?? [];
    const recentWindow = churnValues.slice(Math.max(0, churnValues.length - 3));
    const latestChurn = churnValues.at(-1) ?? 0;
    const recentAverageChurn = average(recentWindow);
    const peakChurn = churnValues.reduce((peak, value) => Math.max(peak, value), 0);

    return {
      key: module.key,
      name: module.name,
      kind: module.kind,
      latestLoc: module.latestValue,
      latestChurn,
      recentAverageChurn,
      peakChurn,
      sizeMetric: Math.max(recentAverageChurn, latestChurn, 1),
    } satisfies RiskScatterPoint;
  });
}

function computeLifecycleStage(values: number[], firstActiveIndex: number, lastActiveIndex: number) {
  const latestLoc = values.at(-1) ?? 0;
  const peakLoc = values.reduce((peak, value) => Math.max(peak, value), 0);

  if (peakLoc <= 0 || latestLoc <= Math.max(1, peakLoc * 0.05)) {
    return "dormant" as const;
  }

  const activeSpan = lastActiveIndex - firstActiveIndex + 1;
  if (activeSpan <= 2 || firstActiveIndex >= Math.max(0, values.length - 2)) {
    return "new" as const;
  }

  const recentWindow = values.slice(Math.max(0, values.length - 3));
  const previousWindow = values.slice(Math.max(0, values.length - 6), Math.max(0, values.length - 3));
  const recentAverage = average(recentWindow);
  const previousAverage = previousWindow.length > 0 ? average(previousWindow) : recentAverage;
  const trendDelta = recentAverage - previousAverage;
  const baseline = Math.max(peakLoc, 1);

  if (trendDelta >= baseline * 0.08) {
    return "growth" as const;
  }

  if (trendDelta <= baseline * -0.08) {
    return "decline" as const;
  }

  return "stable" as const;
}

export function buildLifecycleSeriesFromQuery(series: SeriesResponseDto) {
  const { modules } = buildMetricSeriesFromQuery(series);

  return modules.map((module) => {
    const firstActiveIndex = module.values.findIndex((value) => value > 0);
    const lastActiveIndex = (() => {
      for (let index = module.values.length - 1; index >= 0; index -= 1) {
        if ((module.values[index] ?? 0) > 0) {
          return index;
        }
      }

      return -1;
    })();
    const safeFirstActiveIndex = firstActiveIndex >= 0 ? firstActiveIndex : 0;
    const safeLastActiveIndex = lastActiveIndex >= 0 ? lastActiveIndex : 0;
    const recentWindow = module.values.slice(Math.max(0, module.values.length - 3));
    const previousWindow = module.values.slice(Math.max(0, module.values.length - 6), Math.max(0, module.values.length - 3));

    return {
      key: module.key,
      name: module.name,
      kind: module.kind,
      stage: computeLifecycleStage(module.values, safeFirstActiveIndex, safeLastActiveIndex),
      firstActiveIndex: safeFirstActiveIndex,
      lastActiveIndex: safeLastActiveIndex,
      activeSpan: Math.max(0, safeLastActiveIndex - safeFirstActiveIndex + 1),
      latestLoc: module.latestValue,
      peakLoc: module.peakValue,
      recentTrend:
        average(recentWindow) -
        (previousWindow.length > 0 ? average(previousWindow) : average(recentWindow)),
    } satisfies LifecycleModuleEntry;
  });
}

export function buildCalendarHeatmapFromQuery(series: SeriesResponseDto) {
  const totalsByDate = new Map<string, { value: number; snapshotCount: number }>();

  for (const [index, snapshot] of series.timeline.entries()) {
    const date = snapshot.ts.slice(0, 10);
    const current = totalsByDate.get(date) ?? { value: 0, snapshotCount: 0 };
    const totalValue = series.series.reduce((sum, module) => sum + (module.values[index] ?? 0), 0);

    totalsByDate.set(date, {
      value: current.value + totalValue,
      snapshotCount: current.snapshotCount + 1,
    });
  }

  const entries = Array.from(totalsByDate.entries())
    .map(([date, value]) => ({
      date,
      value: value.value,
      snapshotCount: value.snapshotCount,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    entries: entries satisfies CalendarHeatEntry[],
    years: Array.from(new Set(entries.map((entry) => entry.date.slice(0, 4)))),
    maxValue: entries.reduce((max, entry) => Math.max(max, entry.value), 0),
  };
}
