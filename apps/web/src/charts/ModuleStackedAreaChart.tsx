import { useEffect, useRef, useState } from "react";

import * as echarts from "echarts";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildStackedAreaSeriesFromQuery, formatMetricValue } from "../analysis-data";
import { useI18n } from "../i18n";
import { useThemeMode } from "../theme";
import {
  axisStyle,
  baseGrid,
  createBaseChart,
  createMetricTooltip,
  getChartTokens,
} from "./chart-helpers";

type ModuleStackedAreaChartProps = {
  series: SeriesResponseDto;
  allSeries?: SeriesResponseDto | null;
  allSeriesLoading?: boolean;
  onRequestAllSeries?: () => void;
  showHeader?: boolean;
};

type FocusMode = 8 | 16 | "all";

export function ModuleStackedAreaChart({
  series,
  allSeries,
  allSeriesLoading = false,
  onRequestAllSeries,
  showHeader = true,
}: ModuleStackedAreaChartProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const themeMode = useThemeMode();
  const [focusMode, setFocusMode] = useState<FocusMode>(8);
  const requiresExpandedSeries = focusMode !== "all" && series.series.length < focusMode;
  const effectiveSeries =
    (focusMode === "all" || requiresExpandedSeries) && allSeries ? allSeries : series;
  const expandedSeriesRequested = focusMode === "all" || requiresExpandedSeries;
  const { xAxis, modules, collapsedCount } = buildStackedAreaSeriesFromQuery(effectiveSeries, focusMode);
  const latestTotal = modules.reduce((sum, module) => sum + (module.values.at(-1) ?? 0), 0);
  const requestedModuleCount =
    focusMode === "all"
      ? allSeries?.series.length ?? series.series.length
      : Math.min(focusMode, effectiveSeries.series.length);
  const moduleCountLabel =
    focusMode === "all"
      ? allSeries
        ? t("chart.summary.loadedAll", { count: String(allSeries.series.length) })
        : allSeriesLoading
          ? t("action.loadAllModules")
          : t("chart.summary.loadedTop", { count: String(series.series.length) })
      : t("chart.summary.loadedTop", {
          count: String(requestedModuleCount),
        });

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
        tooltip: createMetricTooltip("loc", tokens),
        legend: {
          type: "scroll",
          bottom: compact ? 0 : 8,
          icon: "circle",
          textStyle: {
            color: tokens.emphasisText,
          },
        },
        grid: baseGrid(compact, 18, compact ? 96 : 92),
        xAxis: {
          ...axisStyle(tokens),
          type: "category",
          data: xAxis,
          boundaryGap: false,
          axisLabel: {
            color: tokens.axisLabel,
            formatter: (value: string) => value.slice(0, 10),
          },
        },
        yAxis: {
          ...axisStyle(tokens),
          type: "value",
          name: "LOC",
          nameTextStyle: {
            color: tokens.axisName,
            padding: [0, 0, 8, 0],
          },
        },
        dataZoom: [
          {
            type: "inside",
          },
          {
            type: "slider",
            height: 18,
            bottom: compact ? 44 : 20,
            borderColor: "transparent",
            backgroundColor: tokens.zoomBg,
            fillerColor: "rgba(56, 189, 248, 0.18)",
            textStyle: {
              color: tokens.zoomText,
            },
            handleStyle: {
              color: tokens.zoomHandle,
              borderColor: "transparent",
            },
          },
        ],
        series: modules.map((module) => ({
          id: module.key,
          name: module.name,
          type: "line",
          stack: "loc",
          smooth: true,
          showSymbol: false,
          areaStyle: {
            opacity: module.key === "others" ? 0.2 : 0.34,
          },
          emphasis: {
            focus: "series",
          },
          data: module.values,
        })),
      } as echarts.EChartsOption,
      true,
    );

    chart.resize();
  }, [focusMode, modules, themeMode, xAxis]);

  const focusOptions: FocusMode[] = [];
  if (series.series.length > 0) {
    focusOptions.push(8, 16, "all");
  }

  return (
    <div className="chart-panel">
      <div className="chart-toolbar">
        {showHeader ? (
          <div>
            <h3>{t("chart.stacked.title")}</h3>
            <p className="chart-subtitle">{t("chart.stacked.description")}</p>
          </div>
        ) : null}
        <div className="chart-toolbar-inline">
          <div className="chart-summary">
            <span className="chart-chip">
              {t("chart.stacked.summary.total", { value: formatMetricValue(latestTotal) })}
            </span>
            <span className="chart-chip">{moduleCountLabel}</span>
            {collapsedCount > 0 ? (
              <span className="chart-chip chart-chip-muted">
                {t("chart.stacked.summary.collapsed", { count: String(collapsedCount) })}
              </span>
            ) : null}
          </div>
          <div className="chart-focus-switch">
            {focusOptions.map((option) => (
              <button
                aria-pressed={focusMode === option}
                className={`chart-toggle-button ${focusMode === option ? "active" : ""}`}
                key={String(option)}
                onClick={() => {
                  setFocusMode(option);
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
      <div className="chart-surface" ref={containerRef} />
    </div>
  );
}
