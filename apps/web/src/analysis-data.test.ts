import assert from "node:assert/strict";
import test from "node:test";

import type { SeriesResponseDto } from "@code-dance/contracts";

import {
  buildCalendarHeatmapFromQuery,
  buildLifecycleSeriesFromQuery,
  buildRiskScatterDataFromQuery,
} from "./analysis-data";

function createSeries(metric: "loc" | "churn", values: Record<string, number[]>) {
  const timeline = [
    { seq: 1, commit: "aaa111", ts: "2026-01-01T00:00:00.000Z" },
    { seq: 2, commit: "bbb222", ts: "2026-01-08T00:00:00.000Z" },
    { seq: 3, commit: "ccc333", ts: "2026-01-15T00:00:00.000Z" },
    { seq: 4, commit: "ddd444", ts: "2026-01-22T00:00:00.000Z" },
  ];

  const entries = Object.entries(values).map(([moduleKey, metricValues]) => ({
    moduleKey,
    moduleName: moduleKey,
    moduleKind: "rust-crate",
    values: metricValues,
  }));

  return {
    analysisId: `${metric}-analysis`,
    metric,
    timeline,
    series: entries,
  } satisfies SeriesResponseDto;
}

test("risk scatter derives latest metrics and recent churn averages", () => {
  const locSeries = createSeries("loc", {
    alpha: [10, 20, 30, 40],
    beta: [5, 10, 15, 20],
  });
  const churnSeries = createSeries("churn", {
    alpha: [1, 3, 6, 9],
    beta: [0, 1, 2, 3],
  });

  const result = buildRiskScatterDataFromQuery(locSeries, churnSeries, 8);
  assert.equal(result[0]?.name, "alpha");
  assert.equal(result[0]?.latestLoc, 40);
  assert.equal(result[0]?.latestChurn, 9);
  assert.equal(result[0]?.recentAverageChurn, 6);
});

test("lifecycle classification marks growth and dormant modules", () => {
  const locSeries = createSeries("loc", {
    alpha: [0, 10, 20, 30],
    beta: [20, 10, 2, 0],
  });

  const result = buildLifecycleSeriesFromQuery(locSeries);
  assert.equal(result.find((module) => module.name === "alpha")?.stage, "growth");
  assert.equal(result.find((module) => module.name === "beta")?.stage, "dormant");
});

test("calendar heatmap aggregates churn totals by sampled day", () => {
  const churnSeries = createSeries("churn", {
    alpha: [1, 2, 3, 4],
    beta: [4, 3, 2, 1],
  });

  const result = buildCalendarHeatmapFromQuery(churnSeries);
  assert.equal(result.entries.length, 4);
  assert.equal(result.entries[0]?.value, 5);
  assert.deepEqual(result.years, ["2026"]);
});
