import { useEffect, useMemo, useRef, useState } from "react";

import * as echarts from "echarts";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildHeatmapSeriesFromQuery, formatMetricValue } from "../analysis-data";
import { useI18n } from "../i18n";
import { useThemeMode } from "../theme";
import {
  axisStyle,
  baseGrid,
  createBaseChart,
  createBaseTooltip,
  escapeHtml,
  getHeatmapPalette,
  getChartTokens,
} from "./chart-helpers";

type ModuleChurnHeatmapChartProps = {
  series: SeriesResponseDto;
  allSeries?: SeriesResponseDto | null;
  allSeriesLoading?: boolean;
  onRequestAllSeries?: () => void;
  showHeader?: boolean;
};

type FocusMode = 12 | 24 | "all";

export function ModuleChurnHeatmapChart({
  series,
  allSeries,
  allSeriesLoading = false,
  onRequestAllSeries,
  showHeader = true,
}: ModuleChurnHeatmapChartProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const themeMode = useThemeMode();
  const [focusMode, setFocusMode] = useState<FocusMode>(12);
  const requiresExpandedSeries = focusMode !== "all" && series.series.length < focusMode;
  const effectiveSeries =
    (focusMode === "all" || requiresExpandedSeries) && allSeries ? allSeries : series;
  const expandedSeriesRequested = focusMode === "all" || requiresExpandedSeries;
  const { xAxis, yAxis, data, maxValue, visualMax } = useMemo(
    () => buildHeatmapSeriesFromQuery(effectiveSeries, focusMode),
    [effectiveSeries, focusMode],
  );

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

    const compact = container.clientWidth < 720;
    const tokens = getChartTokens();

    chart.setOption(
      {
        backgroundColor: "transparent",
        animation: false,
        animationDurationUpdate: 0,
        tooltip: {
          ...createBaseTooltip((paramsRaw: unknown) => {
            const params = paramsRaw as {
              data?: [number, number, number, number];
            };
            const point = params.data ?? [0, 0, 0, 0];
            const ts = xAxis[point[0] ?? 0] ?? "-";
            const moduleName = yAxis[point[1] ?? 0] ?? "-";
            const rawValue = point[3] ?? 0;
            return [
              `<strong>${escapeHtml(moduleName)}</strong>`,
              escapeHtml(ts.slice(0, 10)),
              `${t("metric.churn")}: ${formatMetricValue(rawValue)}`,
            ].join("<br/>");
          }, tokens),
          position: "top",
        },
        grid: baseGrid(compact, 18, 110),
        xAxis: {
          ...axisStyle(tokens),
          type: "category",
          data: xAxis,
          splitArea: { show: false },
          axisLabel: {
            color: tokens.axisLabel,
            formatter: (value: string) => value.slice(0, 10),
          },
        },
        yAxis: {
          ...axisStyle(tokens),
          type: "category",
          data: yAxis,
          splitArea: { show: false },
          axisLabel: {
            color: tokens.axisLabel,
            width: compact ? 120 : 180,
            overflow: "truncate",
          },
        },
        visualMap: {
          min: 0,
          max: Math.max(visualMax, 1),
          calculable: true,
          orient: compact ? "horizontal" : "vertical",
          left: compact ? "center" : "right",
          bottom: compact ? 20 : 90,
          text: [t("chart.churn.heat.high"), t("chart.churn.heat.low")],
          textStyle: {
            color: tokens.axisLabel,
          },
          inRange: {
            color: getHeatmapPalette(tokens),
          },
        },
        dataZoom: [
          {
            type: "inside",
            xAxisIndex: 0,
          },
          {
            type: "slider",
            xAxisIndex: 0,
            height: 18,
            bottom: compact ? 56 : 22,
            borderColor: "transparent",
            backgroundColor: tokens.zoomBg,
            fillerColor: "rgba(59, 130, 246, 0.18)",
            textStyle: {
              color: tokens.zoomText,
            },
            handleStyle: {
              color: tokens.zoomHandle,
              borderColor: "transparent",
            },
          },
        ],
        series: [
          {
            name: "churn",
            type: "heatmap",
            data,
            progressive: 1_000,
            emphasis: {
              itemStyle: {
                borderColor: tokens.tooltipText,
                borderWidth: 1,
              },
            },
          },
        ],
      } as echarts.EChartsOption,
      {
        notMerge: false,
        lazyUpdate: true,
      },
    );

    chart.resize();
  }, [data, t, themeMode, visualMax, xAxis, yAxis]);

  return (
    <div className="chart-panel">
      <div className="chart-toolbar">
        {showHeader ? (
          <div>
            <h3>{t("chart.churn.title")}</h3>
            <p className="chart-subtitle">{t("chart.churn.description")}</p>
          </div>
        ) : null}
        <div className="chart-toolbar-inline">
          <div className="chart-summary">
            <span className="chart-chip">
              {t("chart.churn.summary.max", { value: formatMetricValue(maxValue) })}
            </span>
            <span className="chart-chip">
              {t("chart.churn.summary.modules", { count: String(yAxis.length) })}
            </span>
          </div>
          <div className="chart-focus-switch">
            {[12, 24, "all"].map((option) => (
              <button
                aria-pressed={focusMode === option}
                className={`chart-toggle-button ${focusMode === option ? "active" : ""}`}
                key={String(option)}
                onClick={() => {
                  setFocusMode(option as FocusMode);
                  if (option === "all" || (typeof option === "number" && series.series.length < option)) {
                    onRequestAllSeries?.();
                  }
                }}
                type="button"
              >
                {option === "all"
                  ? t("chart.focus.all")
                  : t("chart.focus.top", { count: String(option) })}
              </button>
            ))}
          </div>
        </div>
      </div>
      {expandedSeriesRequested && allSeriesLoading && !allSeries ? (
        <p className="feedback">{t("action.loadAllModules")}...</p>
      ) : null}
      <div className="chart-surface chart-surface-tall" ref={containerRef} />
    </div>
  );
}
