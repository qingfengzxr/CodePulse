import * as echarts from "echarts";

import {
  formatMetricLabel,
  formatMetricValue,
  type MetricKey,
} from "../analysis-data";
import { formatDateValue, translate } from "../i18n";

type ChartTokens = {
  axisLine: string;
  axisLabel: string;
  axisName: string;
  splitLine: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  zoomBg: string;
  zoomText: string;
  zoomHandle: string;
  pageIconInactive: string;
  pageIconActive: string;
  emphasisText: string;
  heatLow: string;
  heatMidLow: string;
  heatMid: string;
  heatMidHigh: string;
  heatHigh: string;
  positive: string;
  positiveSoft: string;
  negative: string;
  negativeSoft: string;
};

const fallbackTokens: ChartTokens = {
  axisLine: "rgba(255, 255, 255, 0.12)",
  axisLabel: "rgba(244, 239, 228, 0.72)",
  axisName: "rgba(244, 239, 228, 0.5)",
  splitLine: "rgba(255, 255, 255, 0.08)",
  tooltipBg: "rgba(15, 23, 42, 0.96)",
  tooltipBorder: "rgba(255, 255, 255, 0.08)",
  tooltipText: "#f8fafc",
  zoomBg: "rgba(255, 255, 255, 0.06)",
  zoomText: "rgba(244, 239, 228, 0.58)",
  zoomHandle: "#fde68a",
  pageIconInactive: "rgba(244, 239, 228, 0.28)",
  pageIconActive: "#fde68a",
  emphasisText: "rgba(244, 239, 228, 0.74)",
  heatLow: "#162033",
  heatMidLow: "#214c9a",
  heatMid: "#3aaed8",
  heatMidHigh: "#f59e0b",
  heatHigh: "#f43f5e",
  positive: "#22c55e",
  positiveSoft: "#4ade80",
  negative: "#f43f5e",
  negativeSoft: "#fb7185",
};

function readThemeToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

export function getChartTokens(): ChartTokens {
  if (typeof window === "undefined") {
    return fallbackTokens;
  }

  const styles = window.getComputedStyle(document.documentElement);
  return {
    axisLine: readThemeToken(styles, "--chart-axis-line", fallbackTokens.axisLine),
    axisLabel: readThemeToken(styles, "--chart-axis-label", fallbackTokens.axisLabel),
    axisName: readThemeToken(styles, "--chart-axis-name", fallbackTokens.axisName),
    splitLine: readThemeToken(styles, "--chart-split-line", fallbackTokens.splitLine),
    tooltipBg: readThemeToken(styles, "--chart-tooltip-bg", fallbackTokens.tooltipBg),
    tooltipBorder: readThemeToken(styles, "--chart-tooltip-border", fallbackTokens.tooltipBorder),
    tooltipText: readThemeToken(styles, "--chart-tooltip-text", fallbackTokens.tooltipText),
    zoomBg: readThemeToken(styles, "--chart-zoom-bg", fallbackTokens.zoomBg),
    zoomText: readThemeToken(styles, "--chart-zoom-text", fallbackTokens.zoomText),
    zoomHandle: readThemeToken(styles, "--chart-zoom-handle", fallbackTokens.zoomHandle),
    pageIconInactive: readThemeToken(
      styles,
      "--chart-page-icon-inactive",
      fallbackTokens.pageIconInactive,
    ),
    pageIconActive: readThemeToken(
      styles,
      "--chart-page-icon-active",
      fallbackTokens.pageIconActive,
    ),
    emphasisText: readThemeToken(styles, "--chart-emphasis-text", fallbackTokens.emphasisText),
    heatLow: readThemeToken(styles, "--chart-heat-low", fallbackTokens.heatLow),
    heatMidLow: readThemeToken(styles, "--chart-heat-mid-low", fallbackTokens.heatMidLow),
    heatMid: readThemeToken(styles, "--chart-heat-mid", fallbackTokens.heatMid),
    heatMidHigh: readThemeToken(styles, "--chart-heat-mid-high", fallbackTokens.heatMidHigh),
    heatHigh: readThemeToken(styles, "--chart-heat-high", fallbackTokens.heatHigh),
    positive: readThemeToken(styles, "--chart-positive", fallbackTokens.positive),
    positiveSoft: readThemeToken(styles, "--chart-positive-soft", fallbackTokens.positiveSoft),
    negative: readThemeToken(styles, "--chart-negative", fallbackTokens.negative),
    negativeSoft: readThemeToken(styles, "--chart-negative-soft", fallbackTokens.negativeSoft),
  };
}

export function getHeatmapPalette(tokens = getChartTokens()) {
  return [
    tokens.heatLow,
    tokens.heatMidLow,
    tokens.heatMid,
    tokens.heatMidHigh,
    tokens.heatHigh,
  ];
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createBaseChart(container: HTMLDivElement) {
  return echarts.init(container);
}

export function baseGrid(compact: boolean, extraRight = 18, extraBottom = 56) {
  return compact
    ? { left: 40, right: 18, top: 24, bottom: extraBottom }
    : { left: 52, right: extraRight, top: 24, bottom: 72 };
}

export function axisStyle(tokens = getChartTokens()) {
  return {
    axisLine: { lineStyle: { color: tokens.axisLine } },
    axisLabel: { color: tokens.axisLabel },
    splitLine: { lineStyle: { color: tokens.splitLine } },
  };
}

export function createBaseTooltip(
  formatter?: echarts.TooltipComponentOption["formatter"],
  tokens = getChartTokens(),
) {
  return {
    confine: true,
    backgroundColor: tokens.tooltipBg,
    borderColor: tokens.tooltipBorder,
    textStyle: { color: tokens.tooltipText },
    formatter,
  };
}

export function createMetricTooltip(metric: MetricKey, tokens = getChartTokens()) {
  return {
    ...createBaseTooltip((paramsRaw: unknown) => {
      const params = (Array.isArray(paramsRaw) ? paramsRaw : [paramsRaw]) as Array<{
        axisValueLabel?: string;
        data?: number;
        marker: string;
        seriesName: string;
      }>;
      const axisLabel = formatChartDateLabel(String(params[0]?.axisValueLabel ?? ""));
      const rows = params
        .filter((param) => typeof param.data === "number" && param.data > 0)
        .sort((left, right) => Number(right.data) - Number(left.data));

      return [
        `<strong>${escapeHtml(axisLabel)}</strong>`,
        ...rows.map(
          (param) =>
            `${param.marker}${escapeHtml(param.seriesName)}: ${formatMetricValue(Number(param.data))} ${formatMetricLabel(metric)}`,
        ),
      ].join("<br/>");
    }, tokens),
    trigger: "axis",
  };
}

export function formatChartDateLabel(value: string) {
  if (!value) {
    return "-";
  }

  return formatDateValue(value, undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatBumpRank(rank: number) {
  return translate("chart.bump.rank") + ` #${Math.round(rank)}`;
}
