import { useEffect, useRef } from "react";

import * as echarts from "echarts";

import type { RankingResponseDto } from "@code-dance/contracts";
import {
  buildCurrentRankingFromQuery,
  formatMetricLabel,
  formatMetricValue,
  type MetricKey,
} from "../analysis-data";
import { useI18n } from "../i18n";
import { useThemeMode } from "../theme";
import { axisStyle, baseGrid, createBaseChart, createBaseTooltip, getChartTokens } from "./chart-helpers";

type ModuleRankingChartProps = {
  ranking: RankingResponseDto | null;
  metric: MetricKey;
  visibleCount: 8 | 16;
  onMetricChange: (metric: MetricKey) => void;
  onVisibleCountChange: (count: 8 | 16) => void;
  showHeader?: boolean;
};

const rankingMetrics: MetricKey[] = ["loc", "added", "deleted", "churn"];

export function ModuleRankingChart({
  ranking,
  metric,
  visibleCount,
  onMetricChange,
  onVisibleCountChange,
  showHeader = true,
}: ModuleRankingChartProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const themeMode = useThemeMode();
  const rankingItems = ranking ? buildCurrentRankingFromQuery(ranking) : [];

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const chart = createBaseChart(containerRef.current);
    chartRef.current = chart;
    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;

    if (!chart || !container) {
      return;
    }

    if (rankingItems.length === 0) {
      chart.clear();
      chart.resize();
      return;
    }

    const compact = container.clientWidth < 720;
    const reversed = [...rankingItems].reverse();
    const tokens = getChartTokens();

    chart.setOption(
      {
        backgroundColor: "transparent",
        tooltip: {
          ...createBaseTooltip((paramsRaw: unknown) => {
            const params = (Array.isArray(paramsRaw) ? paramsRaw[0] : paramsRaw) as
              | { name?: string; value?: number }
              | undefined;

            return [
              `<strong>${params?.name ?? "-"}</strong>`,
              `${formatMetricLabel(metric)}: ${formatMetricValue(Number(params?.value ?? 0))}`,
            ].join("<br/>");
          }, tokens),
          trigger: "axis",
          axisPointer: {
            type: "shadow",
          },
        },
        grid: baseGrid(compact, 18, 22),
        xAxis: {
          ...axisStyle(tokens),
          type: "value",
        },
        yAxis: {
          ...axisStyle(tokens),
          type: "category",
          data: reversed.map((entry) => entry.name),
          axisLabel: {
            color: tokens.axisLabel,
            width: compact ? 120 : 180,
            overflow: "truncate",
          },
        },
        series: [
          {
            type: "bar",
            data: reversed.map((entry) => entry.value),
            barWidth: 18,
            itemStyle: {
              borderRadius: [0, 8, 8, 0],
              color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
                { offset: 0, color: "#38bdf8" },
                { offset: 1, color: "#f59e0b" },
              ]),
            },
          },
        ],
      } as echarts.EChartsOption,
      true,
    );

    chart.resize();
  }, [metric, rankingItems, themeMode]);

  const total = rankingItems.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <div className="chart-panel">
      <div className="chart-toolbar chart-toolbar-stacked">
        {showHeader ? (
          <div>
            <h3>{t("chart.ranking.title")}</h3>
            <p className="chart-subtitle">{t("chart.ranking.description")}</p>
          </div>
        ) : null}
        <div className="chart-toolbar-inline">
          <div className="metric-switch">
            {rankingMetrics.map((candidate) => (
              <button
                aria-pressed={metric === candidate}
                className={`chart-toggle-button ${metric === candidate ? "active" : ""}`}
                key={candidate}
                onClick={() => onMetricChange(candidate)}
                type="button"
              >
                {formatMetricLabel(candidate)}
              </button>
            ))}
          </div>
          <div className="chart-focus-switch">
            {[8, 16].map((count) => (
              <button
                aria-pressed={visibleCount === count}
                className={`chart-toggle-button ${visibleCount === count ? "active" : ""}`}
                key={count}
                onClick={() => onVisibleCountChange(count as 8 | 16)}
                type="button"
              >
                {t("chart.focus.top", { count: String(count) })}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-summary">
        <span className="chart-chip">
          {t("chart.ranking.summary.total", { value: formatMetricValue(total) })}
        </span>
      </div>
      <div className="chart-surface chart-surface-tall" ref={containerRef} />
      {ranking ? null : <p className="feedback">{t("chart.empty.loadRanking")}</p>}
    </div>
  );
}
