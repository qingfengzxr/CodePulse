import { useEffect, useMemo, useRef, useState } from "react";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import type { CandlesResponseDto } from "@code-dance/contracts";
import { buildCandlestickSeriesFromQuery, formatMetricValue } from "../analysis-data";
import { useI18n } from "../i18n";
import { useThemeMode } from "../theme";
import { getChartTokens } from "./chart-helpers";

type ModuleCandlestickChartProps = {
  candles: CandlesResponseDto;
  allCandles?: CandlesResponseDto | null;
  allCandlesLoading?: boolean;
  onRequestAllCandles?: () => void;
  showHeader?: boolean;
};

type FocusMode = 8 | 16 | "all";

export function ModuleCandlestickChart({
  candles,
  allCandles,
  allCandlesLoading = false,
  onRequestAllCandles,
  showHeader = true,
}: ModuleCandlestickChartProps) {
  const { t, formatDate } = useI18n();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick", Time> | null>(null);
  const themeMode = useThemeMode();
  const [focusMode, setFocusMode] = useState<FocusMode>(8);
  const [selectedModuleKey, setSelectedModuleKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const requiresExpandedCandles = focusMode !== "all" && candles.series.length < focusMode;
  const effectiveCandles =
    (focusMode === "all" || requiresExpandedCandles) && allCandles ? allCandles : candles;
  const expandedCandlesRequested = focusMode === "all" || requiresExpandedCandles;
  const data = useMemo(
    () => buildCandlestickSeriesFromQuery(effectiveCandles),
    [effectiveCandles],
  );

  const rankedModules = [...data.modules].sort((left, right) => {
    const leftClose = left.latestClose;
    const rightClose = right.latestClose;
    if (rightClose !== leftClose) {
      return rightClose - leftClose;
    }

    return left.name.localeCompare(right.name);
  });
  const visibleModules = focusMode === "all" ? rankedModules : rankedModules.slice(0, focusMode);
  const filteredModules = visibleModules.filter((module) =>
    module.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );
  const selectedModule =
    visibleModules.find((module) => module.key === selectedModuleKey) ?? visibleModules[0] ?? null;

  useEffect(() => {
    setSelectedModuleKey(visibleModules[0]?.key ?? null);
  }, [effectiveCandles.analysisId, focusMode, visibleModules[0]?.key]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const container = containerRef.current;

    if (!surface || !container) {
      return;
    }

    const chart = createChart(container, {
      width: surface.clientWidth,
      height: surface.clientHeight,
      autoSize: false,
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      grid: {
        vertLines: {
          visible: true,
        },
        horzLines: {
          visible: true,
        },
      },
      layout: {
        attributionLogo: true,
        background: {
          type: ColorType.Solid,
          color: "transparent",
        },
        textColor: "#94a3b8",
      },
      rightPriceScale: {
        borderVisible: true,
      },
      timeScale: {
        borderVisible: true,
        rightOffset: 6,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#f43f5e",
      borderVisible: true,
      wickVisible: true,
      borderUpColor: "#4ade80",
      borderDownColor: "#fb7185",
      wickUpColor: "#4ade80",
      wickDownColor: "#fb7185",
      priceLineVisible: true,
      lastValueVisible: true,
      priceFormat: {
        type: "price",
        precision: 0,
        minMove: 1,
      },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const { width, height } = entry.contentRect;
      chart.applyOptions({
        width: Math.max(Math.floor(width), 0),
        height: Math.max(Math.floor(height), 0),
      });
      chart.timeScale().fitContent();
    });
    resizeObserver.observe(surface);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const surface = surfaceRef.current;
    const tooltip = tooltipRef.current;

    if (!chart || !series || !surface || !tooltip) {
      return;
    }

    const tokens = getChartTokens();
    const selectedCandles = selectedModule?.candles ?? [];
    const chartData = buildChartData(data.xAxis, selectedCandles);
    const candleByTime = new Map<number, { label: string; candle: (typeof selectedCandles)[number] }>(
      chartData.map((point, index) => [
        point.time as number,
        {
          label: point.originalLabel,
          candle: point.originalCandle,
        },
      ]),
    );

    chart.applyOptions({
      localization: {
        priceFormatter: (value: number) => formatMetricValue(value),
      },
      layout: {
        attributionLogo: true,
        background: {
          type: ColorType.Solid,
          color: "transparent",
        },
        textColor: tokens.axisLabel,
      },
      grid: {
        vertLines: {
          color: tokens.splitLine,
        },
        horzLines: {
          color: tokens.splitLine,
        },
      },
      rightPriceScale: {
        borderColor: tokens.axisLine,
      },
      timeScale: {
        borderColor: tokens.axisLine,
      },
    });
    series.applyOptions({
      priceLineColor: tokens.zoomHandle,
      lastValueVisible: true,
      title: selectedModule ? `${selectedModule.name} / LOC` : "module / LOC",
    });
    series.setData(chartData.map(({ originalCandle: _originalCandle, originalLabel: _originalLabel, ...point }) => point));
    chart.timeScale().fitContent();

    const renderTooltip = (label: string, candle: { open: number; high: number; low: number; close: number }) => {
      tooltip.innerHTML = [
        `<strong>${label ? formatTimestampLabel(label, formatDate) : "-"}</strong>`,
        t("chart.tooltip.openLoc", { value: formatMetricValue(candle.open) }),
        t("chart.tooltip.closeLoc", { value: formatMetricValue(candle.close) }),
        t("chart.tooltip.lowLoc", { value: formatMetricValue(candle.low) }),
        t("chart.tooltip.highLoc", { value: formatMetricValue(candle.high) }),
      ].join("<br/>");
    };

    const hideTooltip = () => {
      tooltip.style.opacity = "0";
    };

    const showTooltip = () => {
      tooltip.style.opacity = "1";
    };

    const moveTooltip = (x: number, y: number) => {
      const gap = 14;
      const maxLeft = Math.max(surface.clientWidth - tooltip.offsetWidth - gap, gap);
      const maxTop = Math.max(surface.clientHeight - tooltip.offsetHeight - gap, gap);
      const nextLeft = Math.min(Math.max(x + gap, gap), maxLeft);
      const nextTop = Math.min(Math.max(y + gap, gap), maxTop);

      tooltip.style.left = `${nextLeft}px`;
      tooltip.style.top = `${nextTop}px`;
    };

    hideTooltip();

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (
        !param.point ||
        !param.time ||
        param.point.x < 0 ||
        param.point.y < 0 ||
        param.point.x > surface.clientWidth ||
        param.point.y > surface.clientHeight
      ) {
        hideTooltip();
        return;
      }

      const seriesDatum = param.seriesData.get(series);
      if (!seriesDatum) {
        hideTooltip();
        return;
      }

      const hovered = candleByTime.get(param.time as number);
      if (!hovered) {
        hideTooltip();
        return;
      }

      moveTooltip(param.point.x, param.point.y);
      showTooltip();
      renderTooltip(hovered.label, hovered.candle);
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
    };
  }, [data.xAxis, formatDate, selectedModule, t, themeMode]);

  return (
    <div className="chart-panel">
      <div className="chart-toolbar chart-toolbar-stacked">
        {showHeader ? (
          <div>
            <h3>
              {selectedModule
                ? t("chart.candles.title", { name: selectedModule.name })
                : t("chart.candles.titleFallback")}
            </h3>
            <p className="chart-subtitle">{t("chart.candles.description")}</p>
          </div>
        ) : null}
        <div className="chart-toolbar-inline">
          <div className="chart-summary">
            <span className="chart-chip">
              {t("chart.candles.summary.currentPair", {
                name: selectedModule ? selectedModule.name : "-",
              })}
            </span>
            <span className="chart-chip">
              {t("chart.candles.summary.latestClose", {
                value: formatMetricValue(selectedModule?.latestClose ?? 0),
              })}
            </span>
          </div>
          <div className="chart-filter-controls">
            <div className="chart-focus-switch">
              {[8, 16, "all"].map((option) => (
                <button
                  aria-pressed={focusMode === option}
                  className={`chart-toggle-button ${focusMode === option ? "active" : ""}`}
                  key={String(option)}
                  onClick={() => {
                    setFocusMode(option as FocusMode);
                    if (option === "all" || (typeof option === "number" && candles.series.length < option)) {
                      onRequestAllCandles?.();
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
            <label className="chart-search chart-search-compact chart-search-inline">
              <span className="sr-only">{t("chart.filter.searchModules")}</span>
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("chart.candles.searchPlaceholder")}
                type="search"
                value={searchQuery}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="chart-filter-bar">
        <div className="chart-summary">
          <span className="chart-chip">
            {focusMode === "all" && allCandles
              ? t("chart.candles.summary.candidatesAll", { count: String(visibleModules.length) })
              : focusMode === "all" && allCandlesLoading
                ? t("action.loadAllCandidates")
                : t("chart.candles.summary.candidatesTop", { count: String(visibleModules.length) })}
          </span>
            <span className="chart-chip chart-chip-muted">{t("chart.candles.ohlcSource")}</span>
        </div>
      </div>
      {expandedCandlesRequested && allCandlesLoading && !allCandles ? (
        <p className="feedback">{t("action.loadAllCandidates")}...</p>
      ) : null}

      <div className="module-selector">
        {filteredModules.map((module) => (
          <button
            aria-pressed={selectedModule?.key === module.key}
            className={`module-selector-pill ${selectedModule?.key === module.key ? "active" : ""}`}
            key={module.key}
            onClick={() => setSelectedModuleKey(module.key)}
            type="button"
          >
            <strong>{module.name}</strong>
            <span>{module.kind}</span>
            <span>
              {t("chart.candles.summary.latestClose", {
                value: formatMetricValue(module.latestClose),
              })}
            </span>
          </button>
        ))}
        {filteredModules.length === 0 ? <p className="feedback">{t("feedback.searchNoMatches")}</p> : null}
      </div>

      <div className="chart-surface tradingview-surface" ref={surfaceRef}>
        <div className="tradingview-chart-host" ref={containerRef} />
        <div className="tradingview-tooltip" ref={tooltipRef} />
      </div>
    </div>
  );
}

function toChartTime(value: string): UTCTimestamp {
  return Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp;
}

function formatTimestampLabel(
  value: string,
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string,
) {
  return formatDate(value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildChartData(
  labels: string[],
  candles: Array<{ open: number; high: number; low: number; close: number }>,
): Array<
  CandlestickData & {
    originalLabel: string;
    originalCandle: { open: number; high: number; low: number; close: number };
  }
> {
  let previousTime = -1;

  return candles.map((candle, index) => {
    const originalLabel = labels[index] ?? "";
    const rawTime = toChartTime(originalLabel) as number;
    const normalizedTime = Math.max(rawTime, previousTime + 1);
    previousTime = normalizedTime;

    return {
      time: normalizedTime as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      originalLabel,
      originalCandle: candle,
    };
  });
}
