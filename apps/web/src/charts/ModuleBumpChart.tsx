import { useEffect, useRef, useState } from "react";

import * as echarts from "echarts";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildBumpChartSeriesFromQuery, formatMetricLabel, type MetricKey } from "../analysis-data";
import { axisStyle, baseGrid, createBaseChart, escapeHtml } from "./chart-helpers";

type ModuleBumpChartProps = {
  seriesByMetric: Partial<Record<MetricKey, SeriesResponseDto>>;
};

type FocusMode = 8 | 16 | "all";
type BumpMetric = "loc" | "churn";

export function ModuleBumpChart({ seriesByMetric }: ModuleBumpChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const [metric, setMetric] = useState<BumpMetric>("loc");
  const [focusMode, setFocusMode] = useState<FocusMode>(8);
  const activeSeries = seriesByMetric[metric] ?? seriesByMetric.loc ?? null;
  const data = activeSeries
    ? buildBumpChartSeriesFromQuery(activeSeries, focusMode)
    : { xAxis: [], maxRank: 0, modules: [] };

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
          trigger: "axis",
          confine: true,
          formatter: (paramsRaw: unknown) => {
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
                  `${param.marker}${escapeHtml(param.seriesName)}: 第 ${Math.round(Number(param.data))} 名`,
              ),
            ].join("<br/>");
          },
        },
        legend: {
          type: "scroll",
          bottom: compact ? 0 : 8,
          icon: "circle",
          textStyle: {
            color: "rgba(244, 239, 228, 0.74)",
          },
        },
        grid: baseGrid(compact, compact ? 18 : 120, compact ? 96 : 92),
        xAxis: {
          ...axisStyle(),
          type: "category",
          data: data.xAxis,
          boundaryGap: false,
          axisLabel: {
            color: "rgba(244, 239, 228, 0.72)",
            formatter: (value: string) => value.slice(0, 10),
          },
        },
        yAxis: {
          ...axisStyle(),
          type: "value",
          name: "排名",
          min: 1,
          max: Math.max(data.maxRank, 1),
          inverse: true,
          minInterval: 1,
          axisLabel: {
            color: "rgba(244, 239, 228, 0.72)",
            formatter: (value: number) => `#${value}`,
          },
          nameTextStyle: {
            color: "rgba(244, 239, 228, 0.5)",
            padding: [0, 0, 8, 0],
          },
        },
        dataZoom: [
          { type: "inside" },
          {
            type: "slider",
            height: 18,
            bottom: compact ? 44 : 20,
            borderColor: "transparent",
            backgroundColor: "rgba(255, 255, 255, 0.06)",
            fillerColor: "rgba(168, 85, 247, 0.18)",
            textStyle: {
              color: "rgba(244, 239, 228, 0.58)",
            },
            handleStyle: {
              color: "#fde68a",
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
            color: "rgba(244, 239, 228, 0.76)",
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
  }, [data]);

  return (
    <div className="chart-panel">
      <div className="chart-toolbar chart-toolbar-stacked">
        <div>
          <h3>Top N 模块 Bump Chart</h3>
          <p className="chart-subtitle">
            不看绝对值，只看排名变化。谁在上升，谁在掉队，这张图比普通折线更直观。
          </p>
        </div>
        <div className="chart-toolbar-inline">
          <div className="metric-switch">
            {(["loc", "churn"] as const).map((candidate) => (
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
                onClick={() => setFocusMode(option as FocusMode)}
                type="button"
              >
                {option === "all" ? "全部" : `前 ${option}`}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-summary">
        <span className="chart-chip">{data.modules.length} 条排名轨迹</span>
        <span className="chart-chip chart-chip-muted">
          当前按 {formatMetricLabel(metric)} 维度比较地位变化
        </span>
      </div>
      <div className="chart-surface chart-surface-tall" ref={containerRef} />
    </div>
  );
}
