import { useEffect, useRef, useState } from "react";

import * as echarts from "echarts";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildHeatmapSeriesFromQuery, formatMetricValue } from "../analysis-data";
import { axisStyle, baseGrid, createBaseChart, escapeHtml } from "./chart-helpers";

type ModuleChurnHeatmapChartProps = {
  series: SeriesResponseDto;
};

type FocusMode = 12 | 24 | "all";

export function ModuleChurnHeatmapChart({ series }: ModuleChurnHeatmapChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const [focusMode, setFocusMode] = useState<FocusMode>(12);
  const { xAxis, yAxis, data, maxValue } = buildHeatmapSeriesFromQuery(series, focusMode);

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

    chart.setOption(
      {
        backgroundColor: "transparent",
        tooltip: {
          position: "top",
          confine: true,
          formatter: (paramsRaw: unknown) => {
            const params = paramsRaw as {
              data?: [number, number, number];
            };
            const point = params.data ?? [0, 0, 0];
            const ts = xAxis[point[0] ?? 0] ?? "-";
            const moduleName = yAxis[point[1] ?? 0] ?? "-";
            return [
              `<strong>${escapeHtml(moduleName)}</strong>`,
              escapeHtml(ts.slice(0, 10)),
              `Churn: ${formatMetricValue(point[2] ?? 0)}`,
            ].join("<br/>");
          },
        },
        grid: baseGrid(compact, 18, 110),
        xAxis: {
          ...axisStyle(),
          type: "category",
          data: xAxis,
          splitArea: { show: false },
          axisLabel: {
            color: "rgba(244, 239, 228, 0.72)",
            formatter: (value: string) => value.slice(0, 10),
          },
        },
        yAxis: {
          ...axisStyle(),
          type: "category",
          data: yAxis,
          splitArea: { show: false },
          axisLabel: {
            color: "rgba(244, 239, 228, 0.72)",
            width: compact ? 120 : 180,
            overflow: "truncate",
          },
        },
        visualMap: {
          min: 0,
          max: Math.max(maxValue, 1),
          calculable: true,
          orient: compact ? "horizontal" : "vertical",
          left: compact ? "center" : "right",
          bottom: compact ? 20 : 90,
          textStyle: {
            color: "rgba(244, 239, 228, 0.72)",
          },
          inRange: {
            color: ["#0f172a", "#1d4ed8", "#22c55e", "#f59e0b", "#f43f5e"],
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
            backgroundColor: "rgba(255, 255, 255, 0.06)",
            fillerColor: "rgba(59, 130, 246, 0.18)",
            textStyle: {
              color: "rgba(244, 239, 228, 0.58)",
            },
            handleStyle: {
              color: "#fde68a",
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
                borderColor: "rgba(255,255,255,0.8)",
                borderWidth: 1,
              },
            },
          },
        ],
      } as echarts.EChartsOption,
      true,
    );

    chart.resize();
  }, [data, maxValue, xAxis, yAxis]);

  return (
    <div className="chart-panel">
      <div className="chart-toolbar">
        <div>
          <h3>Churn 热力图</h3>
          <p className="chart-subtitle">
            横轴看时间，纵轴看模块，颜色越热表示该阶段模块 churn 越高，适合扫描热点迁移。
          </p>
        </div>
        <div className="chart-toolbar-inline">
          <div className="chart-summary">
            <span className="chart-chip">最大 Churn {formatMetricValue(maxValue)}</span>
            <span className="chart-chip">{yAxis.length} 个模块</span>
          </div>
          <div className="chart-focus-switch">
            {[12, 24, "all"].map((option) => (
              <button
                aria-pressed={focusMode === option}
                className={`chart-toggle-button ${focusMode === option ? "active" : ""}`}
                key={String(option)}
                onClick={() => setFocusMode(option as FocusMode)}
                type="button"
              >
                {option === "all" ? "全部" : `前 ${option}`}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-surface chart-surface-tall" ref={containerRef} />
    </div>
  );
}
