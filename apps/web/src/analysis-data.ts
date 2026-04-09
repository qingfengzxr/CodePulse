import type {
  AnalysisResultDto,
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
  const hiddenModules =
    visibleLimit === "all" ? [] : modules.slice(Math.max(1, visibleLimit));

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

export function getTotalMetric(
  points: MetricPointDto[],
  metric: MetricKey,
  ts?: string,
): number {
  return points
    .filter((point) => !ts || point.ts === ts)
    .reduce((sum, point) => sum + point[metric], 0);
}

export function buildMetricSeriesFromQuery(
  series: SeriesResponseDto,
): { xAxis: string[]; modules: MetricModuleSeries[] } {
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
  const hiddenModules =
    visibleLimit === "all" ? [] : modules.slice(Math.max(1, visibleLimit));

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

export function getLatestSnapshotFromSeries(series: SeriesResponseDto) {
  return series.timeline.at(-1) ?? null;
}

export function getTotalDistributionValue(distribution: DistributionResponseDto): number {
  return distribution.items.reduce((sum, item) => sum + item.value, 0);
}

export function buildCandlestickSeriesFromQueries(input: {
  loc: SeriesResponseDto;
  added?: SeriesResponseDto;
  deleted?: SeriesResponseDto;
}): {
  xAxis: string[];
  modules: Array<{
    key: string;
    name: string;
    kind: string;
    candles: Array<[number, number, number, number]>;
    closes: number[];
  }>;
} {
  const locSeries = buildMetricSeriesFromQuery(input.loc);
  const addedByModule = input.added
    ? new Map(
        buildMetricSeriesFromQuery(input.added).modules.map((module) => [module.key, module.values]),
      )
    : new Map<string, number[]>();
  const deletedByModule = input.deleted
    ? new Map(
        buildMetricSeriesFromQuery(input.deleted).modules.map((module) => [module.key, module.values]),
      )
    : new Map<string, number[]>();

  return {
    xAxis: locSeries.xAxis,
    modules: locSeries.modules.map((module) => {
      const addedValues = addedByModule.get(module.key) ?? [];
      const deletedValues = deletedByModule.get(module.key) ?? [];
      const candles = module.values.map((close, index) => {
        const previousClose = index === 0 ? 0 : module.values[index - 1] ?? 0;
        const added = addedValues[index] ?? (index === 0 ? close : 0);
        const deleted = deletedValues[index] ?? 0;
        const open = previousClose;
        const high = Math.max(open, close, open + added);
        const low = Math.max(0, Math.min(open, close, open - deleted));

        return [open, close, low, high] as [number, number, number, number];
      });

      return {
        key: module.key,
        name: module.name,
        kind: module.kind,
        candles,
        closes: module.values,
      };
    }),
  };
}
