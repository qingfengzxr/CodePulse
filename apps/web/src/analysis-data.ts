import type {
  AnalysisResultDto,
  CandlesResponseDto,
  DistributionResponseDto,
  MetricPointDto,
  RankingResponseDto,
  SeriesResponseDto,
} from "@code-dance/contracts";

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

const metricLabelMap: Record<MetricKey, string> = {
  loc: "LOC",
  added: "新增",
  deleted: "删除",
  churn: "变更量",
};

export function formatMetricLabel(metric: MetricKey): string {
  return metricLabelMap[metric];
}

export function formatMetricValue(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
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
      name: "Others",
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
      name: "Others",
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
  data: Array<[number, number, number]>;
} {
  const { xAxis, modules } = buildMetricSeriesFromQuery(series);
  const visibleModules =
    visibleLimit === "all" ? modules : modules.slice(0, Math.max(1, visibleLimit));
  const yAxis = visibleModules.map((module) => module.name);
  const data: Array<[number, number, number]> = [];
  let maxValue = 0;

  for (const [yIndex, module] of visibleModules.entries()) {
    for (const [xIndex, value] of module.values.entries()) {
      data.push([xIndex, yIndex, value]);
      maxValue = Math.max(maxValue, value);
    }
  }

  return {
    xAxis,
    yAxis,
    maxValue,
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
