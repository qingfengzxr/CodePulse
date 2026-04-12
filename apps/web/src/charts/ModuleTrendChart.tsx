import { useEffect, useRef, useState } from "react";

import * as echarts from "echarts";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildMetricSeriesFromQuery, formatMetricLabel, type MetricKey } from "../analysis-data";
import { useI18n } from "../i18n";
import { useThemeMode } from "../theme";
import {
  axisStyle,
  baseGrid,
  createBaseChart,
  createMetricTooltip,
  getChartTokens,
} from "./chart-helpers";

type ModuleTrendChartProps = {
  analysisId: string;
  seriesByMetric: Partial<Record<MetricKey, SeriesResponseDto>>;
  allSeriesByMetric?: Partial<Record<MetricKey, SeriesResponseDto | null>>;
  allSeriesLoadingByMetric?: Partial<Record<MetricKey, boolean>>;
  onRequestAllSeries?: (metric: MetricKey) => void;
  showHeader?: boolean;
};

type FocusMode = 8 | 16 | "all";

const metrics: MetricKey[] = ["loc", "added", "deleted", "churn"];

function buildDefaultSelection(
  moduleKeys: string[],
  focusMode: FocusMode,
): Record<string, boolean> {
  const visibleCount =
    focusMode === "all" ? moduleKeys.length : Math.min(focusMode, moduleKeys.length);

  return Object.fromEntries(
    moduleKeys.map((moduleKey, index) => [moduleKey, index < visibleCount]),
  );
}

export function ModuleTrendChart({
  analysisId,
  seriesByMetric,
  allSeriesByMetric,
  allSeriesLoadingByMetric,
  onRequestAllSeries,
  showHeader = true,
}: ModuleTrendChartProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const themeMode = useThemeMode();
  const [metric, setMetric] = useState<MetricKey>("loc");
  const [focusMode, setFocusMode] = useState<FocusMode>(8);
  const [searchQuery, setSearchQuery] = useState("");
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const defaultSeries = seriesByMetric[metric] ?? null;
  const requiresExpandedSeries =
    focusMode !== "all" && (defaultSeries?.series.length ?? 0) < focusMode;
  const currentSeries =
    (focusMode === "all" || requiresExpandedSeries) && allSeriesByMetric?.[metric]
      ? allSeriesByMetric[metric]
      : defaultSeries;
  const currentSeriesLoading =
    focusMode === "all" || requiresExpandedSeries
      ? allSeriesLoadingByMetric?.[metric] ?? false
      : false;
  const { xAxis, modules } = currentSeries
    ? buildMetricSeriesFromQuery(currentSeries)
    : { xAxis: [], modules: [] };
  const moduleKeys = modules.map((module) => module.key);
  const filteredModules = modules.filter((module) =>
    module.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );
  const visibleModules = modules.filter((module) => selection[module.key] !== false);
  const selectableModules = filteredModules.filter((module) => selection[module.key] === false);
  const currentSeriesId = currentSeries?.analysisId ?? "";
  const requestedModuleCount =
    focusMode === "all"
      ? modules.length
      : Math.min(focusMode, currentSeries?.series.length ?? 0);

  useEffect(() => {
    const defaultFocusMode = modules.length <= 8 ? "all" : 8;
    setFocusMode(defaultFocusMode);
    setSelection(buildDefaultSelection(moduleKeys, defaultFocusMode));
    setSearchQuery("");
  }, [analysisId, currentSeriesId, metric]);

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
        tooltip: createMetricTooltip(metric, tokens),
        legend: {
          type: "scroll",
          orient: compact ? "horizontal" : "vertical",
          left: compact ? 0 : undefined,
          right: compact ? 0 : 0,
          top: compact ? undefined : 12,
          bottom: compact ? 0 : 56,
          width: compact ? undefined : 190,
          height: compact ? 42 : undefined,
          icon: "circle",
          itemWidth: 10,
          itemHeight: 10,
          selected: Object.fromEntries(
            modules.map((module) => [module.name, selection[module.key] !== false]),
          ),
          pageIconColor: tokens.pageIconActive,
          pageIconInactiveColor: tokens.pageIconInactive,
          pageTextStyle: {
            color: tokens.axisLabel,
          },
          textStyle: {
            color: tokens.emphasisText,
            width: compact ? 120 : 160,
            overflow: "truncate",
          },
        },
        grid: baseGrid(compact, compact ? 18 : 224, compact ? 92 : 80),
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
          name: formatMetricLabel(metric),
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
            bottom: compact ? 46 : 18,
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
          smooth: true,
          showSymbol: false,
          data: module.values,
          emphasis: {
            focus: "series",
          },
          lineStyle: {
            width: selection[module.key] !== false ? 2.4 : 1.6,
            opacity: selection[module.key] !== false ? 0.96 : 0.42,
          },
        })),
      } as echarts.EChartsOption,
      true,
    );

    chart.resize();
  }, [metric, modules, selection, themeMode, xAxis]);

  function applyFocus(nextFocusMode: FocusMode) {
    if (
      nextFocusMode === "all" ||
      (typeof nextFocusMode === "number" && (defaultSeries?.series.length ?? 0) < nextFocusMode)
    ) {
      onRequestAllSeries?.(metric);
    }
    setFocusMode(nextFocusMode);
    setSelection(buildDefaultSelection(moduleKeys, nextFocusMode));
  }

  function toggleModule(moduleKey: string) {
    setSelection((current) => ({
      ...current,
      [moduleKey]: current[moduleKey] === false,
    }));
  }

  function handleAddModule(moduleKey: string) {
    if (!moduleKey) {
      return;
    }

    setSelection((current) => ({
      ...current,
      [moduleKey]: true,
    }));
  }

  return (
    <div className="chart-panel">
      <div className="chart-toolbar chart-toolbar-stacked">
        {showHeader ? (
          <div>
            <h3>{t("chart.trend.title")}</h3>
            <p className="chart-subtitle">{t("chart.trend.description")}</p>
          </div>
        ) : null}
        <div className="chart-toolbar-inline">
          <div className="chart-toolbar-group">
            <div className="metric-switch">
              {metrics.map((candidate) => (
                <button
                  aria-pressed={metric === candidate}
                  className={`chart-toggle-button ${metric === candidate ? "active" : ""}`}
                  key={candidate}
                  onClick={() => setMetric(candidate)}
                  type="button"
                >
                  {formatMetricLabel(candidate)}
                </button>
              ))}
            </div>
            <div className="chart-focus-switch">
              {[8, 16, "all"].map((option) => (
                <button
                  aria-pressed={focusMode === option}
                  className={`chart-toggle-button ${focusMode === option ? "active" : ""}`}
                  key={String(option)}
                  onClick={() => applyFocus(option as FocusMode)}
                  type="button"
                >
                  {option === "all"
                    ? t("chart.focus.all")
                    : t("chart.focus.top", { count: String(option) })}
                </button>
              ))}
            </div>
          </div>
          <div className="chart-filter-controls">
            <label className="chart-search chart-search-compact">
              <span className="sr-only">{t("chart.filter.searchModules")}</span>
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("chart.filter.searchPlaceholder")}
                type="search"
                value={searchQuery}
              />
            </label>
            <label className="chart-search chart-search-compact">
              <span className="sr-only">{t("chart.filter.addModule")}</span>
              <select
                className="chart-select"
                onChange={(event) => {
                  handleAddModule(event.target.value);
                  event.target.value = "";
                }}
                value=""
              >
                <option value="">{t("chart.filter.addFromList")}</option>
                {selectableModules.map((module) => (
                  <option key={module.key} value={module.key}>
                    {module.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="chart-filter-bar">
        <div className="chart-summary">
          <span className="chart-chip">
            {focusMode === "all" && currentSeries
              ? t("chart.summary.loadedAll", { count: String(modules.length) })
              : t("chart.summary.loadedTop", { count: String(requestedModuleCount) })}
          </span>
          <span className="chart-chip">
            {t("chart.trend.moduleVisible", { count: String(visibleModules.length) })}
          </span>
          {visibleModules.length < modules.length ? (
            <span className="chart-chip chart-chip-muted">
              {t("chart.summary.hiddenModules", {
                count: String(modules.length - visibleModules.length),
              })}
            </span>
          ) : null}
        </div>
      </div>

      {(focusMode === "all" || requiresExpandedSeries) && currentSeriesLoading && !currentSeries ? (
        <p className="feedback">{t("action.loadAllModules")}...</p>
      ) : null}
      <div className="module-selection-strip">
        {visibleModules.map((module) => (
          <button
            aria-pressed={selection[module.key] !== false}
            className={`module-selector-pill ${selection[module.key] !== false ? "active" : ""}`}
            key={module.key}
            onClick={() => toggleModule(module.key)}
            type="button"
          >
            <strong>{module.name}</strong>
            <span>{t("action.hide")}</span>
          </button>
        ))}
        {visibleModules.length === 0 ? (
          <p className="feedback">{t("chart.trend.emptySelection")}</p>
        ) : null}
      </div>

      <div className="chart-surface" ref={containerRef} />
      {!currentSeries ? (
        <p className="feedback">
          {t("chart.empty.loadSeries", { metric: formatMetricLabel(metric) })}
        </p>
      ) : null}
    </div>
  );
}
