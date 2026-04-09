import * as echarts from "echarts";

import { formatMetricLabel, formatMetricValue, type MetricKey } from "../analysis-data";

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

export function axisStyle() {
  return {
    axisLine: {
      lineStyle: {
        color: "rgba(255, 255, 255, 0.12)",
      },
    },
    axisLabel: {
      color: "rgba(244, 239, 228, 0.72)",
    },
    splitLine: {
      lineStyle: {
        color: "rgba(255, 255, 255, 0.08)",
      },
    },
  };
}

export function createMetricTooltip(metric: MetricKey) {
  return {
    trigger: "axis",
    confine: true,
    backgroundColor: "rgba(15, 23, 42, 0.96)",
    borderColor: "rgba(255, 255, 255, 0.08)",
    textStyle: {
      color: "#f8fafc",
    },
    formatter: (paramsRaw: unknown) => {
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
    },
  };
}
