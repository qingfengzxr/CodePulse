import { useCallback, useEffect, useRef, useState } from "react";

import * as echarts from "echarts";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildBumpChartSeriesFromQuery, formatMetricLabel, type MetricKey } from "../analysis-data";
import { useI18n } from "../i18n";
import { useThemeMode } from "../theme";
import {
  axisStyle,
  baseGrid,
  createBaseChart,
  createBaseTooltip,
  escapeHtml,
  formatBumpRank,
  getChartTokens,
} from "./chart-helpers";

type ModuleBumpChartProps = {
  seriesByMetric: Partial<Record<MetricKey, SeriesResponseDto>>;
  allSeriesByMetric?: Partial<Record<MetricKey, SeriesResponseDto | null>>;
  allSeriesLoadingByMetric?: Partial<Record<MetricKey, boolean>>;
  onRequestAllSeries?: (metric: MetricKey) => void;
  showHeader?: boolean;
};

type FocusMode = 8 | 16 | "all";
type BumpMetric = "loc" | "churn";

export function ModuleBumpChart({
  seriesByMetric,
  allSeriesByMetric,
  allSeriesLoadingByMetric,
  onRequestAllSeries,
  showHeader = true,
}: ModuleBumpChartProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const playbackFrameRef = useRef<number | null>(null);
  const zoomEndRef = useRef(100);
  const themeMode = useThemeMode();
  const [metric, setMetric] = useState<BumpMetric>("loc");
  const [focusMode, setFocusMode] = useState<FocusMode>(8);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoomEnd, setZoomEnd] = useState(100);
  const defaultSeries = seriesByMetric[metric] ?? null;
  const requiresExpandedSeries =
    focusMode !== "all" && (defaultSeries?.series.length ?? 0) < focusMode;
  const activeSeries =
    (focusMode === "all" || requiresExpandedSeries) && allSeriesByMetric?.[metric]
      ? allSeriesByMetric[metric]
      : defaultSeries;
  const activeSeriesLoading =
    focusMode === "all" || requiresExpandedSeries
      ? allSeriesLoadingByMetric?.[metric] ?? false
      : false;
  const data = activeSeries
    ? buildBumpChartSeriesFromQuery(activeSeries, focusMode)
    : { xAxis: [], maxRank: 0, modules: [] };
  const initialPlaybackWindow = data.xAxis.length > 1
    ? Math.min(30, Math.max(12, (5 / data.xAxis.length) * 100))
    : 100;

  const cancelPlayback = useCallback(() => {
    if (playbackFrameRef.current !== null) {
      window.cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    cancelPlayback();
    setIsPlaying(false);
  }, [cancelPlayback]);

  useEffect(() => {
    zoomEndRef.current = zoomEnd;
  }, [zoomEnd]);

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

  useEffect(() => () => cancelPlayback(), [cancelPlayback]);

  useEffect(() => {
    stopPlayback();
    setZoomEnd(100);
    zoomEndRef.current = 100;
  }, [activeSeries, focusMode, metric, stopPlayback]);

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
        tooltip: {
          ...createBaseTooltip((paramsRaw: unknown) => {
            const params = (Array.isArray(paramsRaw) ? paramsRaw : [paramsRaw]) as Array<{
              axisValueLabel?: string;
              data?: number;
              marker: string;
              seriesName: string;
            }>;
            const axisLabel = String(params[0]?.axisValueLabel ?? "").slice(0, 10);
            const rows = params
              .filter((param) => typeof param.data === "number")
              .sort((left, right) => Number(left.data) - Number(right.data));

            return [
              `<strong>${escapeHtml(axisLabel)}</strong>`,
              ...rows.map(
                (param) =>
                  `${param.marker}${escapeHtml(param.seriesName)}: ${escapeHtml(formatBumpRank(Number(param.data)))}`,
              ),
            ].join("<br/>");
          }, tokens),
          trigger: "axis",
        },
        legend: {
          type: "scroll",
          bottom: compact ? 0 : 8,
          icon: "circle",
          textStyle: {
            color: tokens.emphasisText,
          },
        },
        grid: baseGrid(compact, compact ? 18 : 120, compact ? 96 : 92),
        xAxis: {
          ...axisStyle(tokens),
          type: "category",
          data: data.xAxis,
          boundaryGap: false,
          axisLabel: {
            color: tokens.axisLabel,
            formatter: (value: string) => value.slice(0, 10),
          },
        },
        yAxis: {
          ...axisStyle(tokens),
          type: "value",
          name: t("chart.bump.rank"),
          min: 1,
          max: Math.max(data.maxRank, 1),
          inverse: true,
          minInterval: 1,
          axisLabel: {
            color: tokens.axisLabel,
            formatter: (value: number) => `#${value}`,
          },
          nameTextStyle: {
            color: tokens.axisName,
            padding: [0, 0, 8, 0],
          },
        },
        dataZoom: [
          { type: "inside", start: 0, end: zoomEnd },
          {
            type: "slider",
            height: 18,
            bottom: compact ? 44 : 20,
            start: 0,
            end: zoomEnd,
            borderColor: "transparent",
            backgroundColor: tokens.zoomBg,
            fillerColor: "rgba(168, 85, 247, 0.18)",
            textStyle: {
              color: tokens.zoomText,
            },
            handleStyle: {
              color: tokens.zoomHandle,
              borderColor: "transparent",
            },
          },
        ],
        series: data.modules.map((module) => ({
          id: module.key,
          name: module.name,
          type: "line",
          smooth: true,
          showSymbol: false,
          endLabel: {
            show: true,
            formatter: `${module.name}  #${module.latestRank}`,
            color: tokens.emphasisText,
          },
          emphasis: {
            focus: "series",
          },
          lineStyle: {
            width: module.bestRank <= 3 ? 3 : 2,
          },
          data: module.ranks,
        })),
      } as echarts.EChartsOption,
      true,
    );

    chart.resize();
  }, [data, t, themeMode, zoomEnd]);

  useEffect(() => {
    const chart = chartRef.current;

    if (!chart) {
      return;
    }

    chart.dispatchAction({
      type: "dataZoom",
      dataZoomIndex: 0,
      start: 0,
      end: zoomEnd,
    });
    chart.dispatchAction({
      type: "dataZoom",
      dataZoomIndex: 1,
      start: 0,
      end: zoomEnd,
    });
  }, [zoomEnd]);

  useEffect(() => {
    if (!isPlaying) {
      cancelPlayback();
      return;
    }

    const startedAt = window.performance.now();
    const startEnd = zoomEndRef.current;
    const durationMs = 4200;

    const tick = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startedAt) / durationMs);
      const nextZoomEnd = startEnd + (100 - startEnd) * progress;
      zoomEndRef.current = nextZoomEnd;
      setZoomEnd(nextZoomEnd);

      if (progress >= 1) {
        playbackFrameRef.current = null;
        setIsPlaying(false);
        return;
      }

      playbackFrameRef.current = window.requestAnimationFrame(tick);
    };

    playbackFrameRef.current = window.requestAnimationFrame(tick);
    return cancelPlayback;
  }, [cancelPlayback, isPlaying]);

  function handlePlaybackToggle() {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    if (data.xAxis.length <= 1) {
      return;
    }

    const startZoomEnd = zoomEndRef.current >= 99.5 ? initialPlaybackWindow : zoomEndRef.current;
    zoomEndRef.current = startZoomEnd;
    setZoomEnd(startZoomEnd);
    setIsPlaying(true);
  }

  return (
    <div className="chart-panel">
      <div className="chart-toolbar chart-toolbar-stacked">
        {showHeader ? (
          <div>
            <h3>{t("chart.bump.title")}</h3>
            <p className="chart-subtitle">{t("chart.bump.description")}</p>
          </div>
        ) : null}
        <div className="chart-toolbar-inline">
          <div className="metric-switch">
            {(["loc", "churn"] as const).map((candidate) => (
              <button
                aria-pressed={metric === candidate}
                className={`chart-toggle-button ${metric === candidate ? "active" : ""}`}
                key={candidate}
                onClick={() => {
                  setMetric(candidate);
                  if (
                    focusMode === "all" ||
                    (typeof focusMode === "number" &&
                      (seriesByMetric[candidate]?.series.length ?? 0) < focusMode)
                  ) {
                    onRequestAllSeries?.(candidate);
                  }
                }}
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
                onClick={() => {
                  setFocusMode(option as FocusMode);
                  if (
                    option === "all" ||
                    (typeof option === "number" && (defaultSeries?.series.length ?? 0) < option)
                  ) {
                    onRequestAllSeries?.(metric);
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
          <button
            aria-label={t(isPlaying ? "action.stopPlayback" : "action.playPlayback")}
            className={`chart-toggle-button chart-playback-button ${isPlaying ? "active" : ""}`}
            disabled={data.xAxis.length <= 1}
            onClick={handlePlaybackToggle}
            type="button"
          >
            <span aria-hidden="true">{isPlaying ? "■" : "▶"}</span>
            {t(isPlaying ? "action.stopPlayback" : "action.playPlayback")}
          </button>
        </div>
      </div>
      {(focusMode === "all" || requiresExpandedSeries) && activeSeriesLoading && !activeSeries ? (
        <p className="feedback">{t("action.loadAllModules")}...</p>
      ) : null}
      <div className="chart-summary">
        <span className="chart-chip">
          {t("chart.bump.summary.lines", { count: String(data.modules.length) })}
        </span>
        <span className="chart-chip chart-chip-muted">
          {t("chart.bump.summary.currentMetric", { metric: formatMetricLabel(metric) })}
        </span>
      </div>
      <div className="chart-surface chart-surface-tall" ref={containerRef} />
    </div>
  );
}
