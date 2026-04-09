import * as echarts from "echarts";

import { formatMetricLabel, formatMetricValue, type MetricKey } from "../analysis-data";

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
  pageIconInactive: string;
  emphasisText: string;
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
  pageIconInactive: "rgba(244, 239, 228, 0.28)",
  emphasisText: "rgba(244, 239, 228, 0.74)",
};

function readThemeToken(
  styles: CSSStyleDeclaration,
  name: string,
  fallback: string,
): string {
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
    pageIconInactive: readThemeToken(
      styles,
      "--chart-page-icon-inactive",
      fallbackTokens.pageIconInactive,
    ),
    emphasisText: readThemeToken(styles, "--chart-emphasis-text", fallbackTokens.emphasisText),
  };
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
    ? {
        left: 40,
        right: 18,
        top: 24,
        bottom: extraBottom,
      }
    : {
        left: 52,
        right: extraRight,
        top: 24,
        bottom: 72,
      };
}

export function axisStyle(tokens = getChartTokens()) {
  return {
    axisLine: {
      lineStyle: {
        color: tokens.axisLine,
      },
    },
    axisLabel: {
      color: tokens.axisLabel,
    },
    splitLine: {
      lineStyle: {
        color: tokens.splitLine,
      },
    },
  };
}

export function createBaseTooltip(
  formatter: echarts.TooltipComponentOption["formatter"],
  tokens = getChartTokens(),
) {
  return {
    confine: true,
    backgroundColor: tokens.tooltipBg,
    borderColor: tokens.tooltipBorder,
    textStyle: {
      color: tokens.tooltipText,
    },
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
      const axisLabel = String(params[0]?.axisValueLabel ?? "").slice(0, 10);
      const rows = params
        .filter((param) => typeof param.data === "number" && param.data > 0)
        .sort((left, right) => Number(right.data) - Number(left.data));

      return [
        `<strong>${escapeHtml(axisLabel)}</strong>`,
        ...rows.map(
          (param) =>
          `${param.marker}${escapeHtml(param.seriesName)}: ${formatMetricValue(
              Number(param.data),
            )} ${formatMetricLabel(metric)}`,
        ),
      ].join("<br/>");
    }, tokens),
    trigger: "axis",
  };
}
