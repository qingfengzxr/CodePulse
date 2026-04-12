import { useEffect, useRef, useState } from "react";

import * as echarts from "echarts";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildRiskScatterDataFromQuery, formatMetricValue } from "../analysis-data";
import { useI18n } from "../i18n";
import { useThemeMode } from "../theme";
import { axisStyle, baseGrid, createBaseChart, createBaseTooltip, escapeHtml, getChartTokens } from "./chart-helpers";

type ModuleRiskScatterChartProps = {
  locSeries: SeriesResponseDto;
  churnSeries: SeriesResponseDto;
  allLocSeries?: SeriesResponseDto | null;
  allChurnSeries?: SeriesResponseDto | null;
  allSeriesLoading?: boolean;
  onRequestAllSeries?: () => void;
  showHeader?: boolean;
};

type VisibleMode = 8 | "all";

export function ModuleRiskScatterChart({
  locSeries,
  churnSeries,
  allLocSeries,
  allChurnSeries,
  allSeriesLoading = false,
  onRequestAllSeries,
  showHeader = true,
}: ModuleRiskScatterChartProps) {
  const { t } = useI18n();
  const themeMode = useThemeMode();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const [visibleMode, setVisibleMode] = useState<VisibleMode>(8);
  const [selectedModuleKey, setSelectedModuleKey] = useState<string | null>(null);

  const activeLocSeries = visibleMode === "all" && allLocSeries ? allLocSeries : locSeries;
  const activeChurnSeries = visibleMode === "all" && allChurnSeries ? allChurnSeries : churnSeries;
  const points = buildRiskScatterDataFromQuery(activeLocSeries, activeChurnSeries, visibleMode);
  const sizeValues = points.map((point) => point.sizeMetric);
  const minSizeMetric = Math.min(...sizeValues, 1);
  const maxSizeMetric = Math.max(...sizeValues, 1);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const chart = createBaseChart(containerRef.current);
    chartRef.current = chart;
    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);

    chart.on("click", (params) => {
      const data = params.data as [number, number, number, string, string, number, number, string] | undefined;
      setSelectedModuleKey(data?.[7] ?? null);
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    const tokens = getChartTokens();

    chart.setOption(
      {
        backgroundColor: "transparent",
        tooltip: {
          ...createBaseTooltip((paramsRaw: unknown) => {
            const params = paramsRaw as {
              data?: [number, number, number, string, string, number, number, string];
            };
            const data = params.data;
            if (!data) {
              return "";
            }

            return [
              `<strong>${escapeHtml(data[3])}</strong>`,
              escapeHtml(data[4]),
              `${escapeHtml(t("label.currentLoc"))}: ${formatMetricValue(data[0])}`,
              `${escapeHtml(t("metric.churn"))}: ${formatMetricValue(data[1])}`,
              `${escapeHtml(t("chart.risk.tooltip.recentAverage"))}: ${formatMetricValue(data[5])}`,
              `${escapeHtml(t("chart.risk.tooltip.peak"))}: ${formatMetricValue(data[6])}`,
            ].join("<br/>");
          }, tokens),
        },
        grid: baseGrid(false, 24, 20),
        xAxis: {
          ...axisStyle(tokens),
          type: "value",
          name: t("label.currentLoc"),
          nameTextStyle: {
            color: tokens.axisName,
            padding: [0, 0, 8, 0],
          },
          axisLabel: {
            color: tokens.axisLabel,
            formatter: (value: number) => formatMetricValue(value),
          },
        },
        yAxis: {
          ...axisStyle(tokens),
          type: "value",
          name: t("metric.churn"),
          nameTextStyle: {
            color: tokens.axisName,
            padding: [0, 0, 8, 0],
          },
          axisLabel: {
            color: tokens.axisLabel,
            formatter: (value: number) => formatMetricValue(value),
          },
        },
        series: [
          {
            type: "scatter",
            data: points.map((point) => [
              point.latestLoc,
              point.latestChurn,
              point.sizeMetric,
              point.name,
              point.kind,
              point.recentAverageChurn,
              point.peakChurn,
              point.key,
            ]),
            symbolSize: (rawValue: unknown) => {
              const value = rawValue as [number, number, number];
              const metric = value[2] ?? 1;
              if (maxSizeMetric === minSizeMetric) {
                return 20;
              }

              return 14 + ((metric - minSizeMetric) / (maxSizeMetric - minSizeMetric)) * 18;
            },
            itemStyle: {
              color: ({ data }: { data?: [number, number, number, string, string, number, number, string] }) => {
                const kind = data?.[4] ?? "";
                if (kind.includes("rust")) {
                  return "#4f7df3";
                }
                if (kind.includes("node")) {
                  return "#f59e0b";
                }
                if (kind.includes("go")) {
                  return "#14b8a6";
                }

                return "#7c6ee6";
              },
              borderWidth: 2,
              borderColor: ({ data }: { data?: [number, number, number, string, string, number, number, string] }) =>
                data?.[7] === selectedModuleKey ? tokens.heatHigh : "rgba(255,255,255,0.45)",
              shadowBlur: 12,
              shadowColor: "rgba(47, 109, 246, 0.18)",
            },
            emphasis: {
              scale: true,
            },
          },
        ],
      } as echarts.EChartsOption,
      true,
    );
  }, [maxSizeMetric, minSizeMetric, points, selectedModuleKey, t, themeMode]);

  return (
    <div className="chart-panel">
      <div className="chart-toolbar chart-toolbar-stacked">
        {showHeader ? (
          <div>
            <h3>{t("chart.risk.title")}</h3>
            <p className="chart-subtitle">{t("chart.risk.description")}</p>
          </div>
        ) : null}
        <div className="chart-toolbar-inline">
          <div className="chart-focus-switch">
            {[8, "all"].map((option) => (
              <button
                aria-pressed={visibleMode === option}
                className={`chart-toggle-button ${visibleMode === option ? "active" : ""}`}
                key={String(option)}
                onClick={() => {
                  setVisibleMode(option as VisibleMode);
                  if (option === "all" && (!allLocSeries || !allChurnSeries)) {
                    onRequestAllSeries?.();
                  }
                }}
                type="button"
              >
                {option === "all" ? t("chart.focus.all") : t("chart.focus.top", { count: String(option) })}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-summary">
        <span className="chart-chip">
          {visibleMode === "all" && allLocSeries
            ? t("chart.summary.loadedAll", { count: String(points.length) })
            : t("chart.summary.loadedTop", { count: String(points.length) })}
        </span>
        <span className="chart-chip chart-chip-muted">{t("chart.risk.summary.axes")}</span>
      </div>
      {visibleMode === "all" && allSeriesLoading && (!allLocSeries || !allChurnSeries) ? (
        <p className="feedback">{t("action.loadAllModules")}...</p>
      ) : null}
      <div className="chart-surface" ref={containerRef} />
    </div>
  );
}
