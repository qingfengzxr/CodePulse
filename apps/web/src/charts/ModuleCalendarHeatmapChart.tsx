import { useEffect, useMemo, useRef } from "react";

import * as echarts from "echarts";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildCalendarHeatmapFromQuery, formatMetricValue } from "../analysis-data";
import { useI18n } from "../i18n";
import { useThemeMode } from "../theme";
import { createBaseChart, createBaseTooltip, escapeHtml, getChartTokens } from "./chart-helpers";

type ModuleCalendarHeatmapChartProps = {
  series: SeriesResponseDto;
  showHeader?: boolean;
};

export function ModuleCalendarHeatmapChart({
  series,
  showHeader = true,
}: ModuleCalendarHeatmapChartProps) {
  const { t } = useI18n();
  const themeMode = useThemeMode();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const data = buildCalendarHeatmapFromQuery(series);
  const years = useMemo(() => (data.years.length > 0 ? data.years : [new Date().getUTCFullYear().toString()]), [data.years]);

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
    if (!chart) {
      return;
    }

    const tokens = getChartTokens();
    const palette = [
      "rgba(34, 197, 94, 0.08)",
      "rgba(74, 222, 128, 0.18)",
      "#86efac",
      "#4ade80",
      "#16a34a",
    ];

    chart.setOption(
      {
        backgroundColor: "transparent",
        tooltip: {
          ...createBaseTooltip((paramsRaw: unknown) => {
            const params = paramsRaw as { data?: [string, number, number] };
            const point = params.data;
            if (!point) {
              return "";
            }

            return [
              `<strong>${escapeHtml(point[0])}</strong>`,
              `${escapeHtml(t("metric.churn"))}: ${formatMetricValue(point[1])}`,
              `${escapeHtml(t("chart.calendar.tooltip.snapshots"))}: ${point[2]}`,
            ].join("<br/>");
          }, tokens),
        },
        visualMap: {
          min: 0,
          max: Math.max(data.maxValue, 1),
          orient: "horizontal",
          left: "center",
          bottom: 0,
          textStyle: {
            color: tokens.axisLabel,
          },
          inRange: {
            color: palette,
          },
        },
        calendar: years.map((year, index) => ({
          top: 32 + index * 170,
          left: 48,
          right: 24,
          cellSize: ["auto", 18],
          range: year,
          splitLine: {
            show: false,
          },
          itemStyle: {
            borderColor: tokens.axisLine,
          },
          yearLabel: {
            color: tokens.axisName,
          },
          monthLabel: {
            color: tokens.axisLabel,
          },
          dayLabel: {
            color: tokens.axisLabel,
          },
        })),
        series: years.map((year, index) => ({
          type: "heatmap",
          coordinateSystem: "calendar",
          calendarIndex: index,
          data: data.entries
            .filter((entry) => entry.date.startsWith(year))
            .map((entry) => [entry.date, entry.value, entry.snapshotCount]),
        })),
      } as echarts.EChartsOption,
      true,
    );
  }, [data.entries, data.maxValue, t, themeMode, years]);

  return (
    <div className="chart-panel">
      <div className="chart-toolbar chart-toolbar-stacked">
        {showHeader ? (
          <div>
            <h3>{t("chart.calendar.title")}</h3>
            <p className="chart-subtitle">{t("chart.calendar.description")}</p>
          </div>
        ) : null}
      </div>
      <div className="chart-summary">
        <span className="chart-chip">{t("chart.summary.points", { count: String(data.entries.length) })}</span>
        <span className="chart-chip chart-chip-muted">{t("chart.calendar.summary.sampled")}</span>
      </div>
      <div
        className="chart-surface chart-surface-calendar"
        ref={containerRef}
        style={{ height: `${Math.max(260, years.length * 170 + 60)}px` }}
      />
    </div>
  );
}
