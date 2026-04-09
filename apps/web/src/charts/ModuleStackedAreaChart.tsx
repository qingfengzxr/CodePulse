import { useEffect, useRef, useState } from "react";

import * as echarts from "echarts";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildStackedAreaSeriesFromQuery, formatMetricValue } from "../analysis-data";
import { axisStyle, baseGrid, createBaseChart, createMetricTooltip } from "./chart-helpers";

type ModuleStackedAreaChartProps = {
  series: SeriesResponseDto;
};

type FocusMode = 8 | 16 | "all";

export function ModuleStackedAreaChart({ series }: ModuleStackedAreaChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const [focusMode, setFocusMode] = useState<FocusMode>(8);
  const { xAxis, modules, collapsedCount } = buildStackedAreaSeriesFromQuery(
    series,
    focusMode,
  );
  const latestTotal = modules.reduce((sum, module) => sum + (module.values.at(-1) ?? 0), 0);

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
        tooltip: createMetricTooltip("loc"),
        legend: {
          type: "scroll",
          bottom: compact ? 0 : 8,
          icon: "circle",
          textStyle: {
            color: "rgba(244, 239, 228, 0.74)",
          },
        },
        grid: baseGrid(compact, 18, compact ? 96 : 92),
        xAxis: {
          ...axisStyle(),
          type: "category",
          data: xAxis,
          boundaryGap: false,
          axisLabel: {
            color: "rgba(244, 239, 228, 0.72)",
            formatter: (value: string) => value.slice(0, 10),
          },
        },
        yAxis: {
          ...axisStyle(),
          type: "value",
          name: "LOC",
          nameTextStyle: {
            color: "rgba(244, 239, 228, 0.5)",
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
            backgroundColor: "rgba(255, 255, 255, 0.06)",
            fillerColor: "rgba(56, 189, 248, 0.18)",
            textStyle: {
              color: "rgba(244, 239, 228, 0.58)",
            },
            handleStyle: {
              color: "#fde68a",
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
  }, [focusMode, modules, xAxis]);

  const focusOptions: FocusMode[] = [];
  if (series.series.length > 0) {
    focusOptions.push(8, 16, "all");
  }

  return (
    <div className="chart-panel">
      <div className="chart-toolbar">
        <div>
          <h3>模块堆叠面积图</h3>
          <p className="chart-subtitle">默认折叠长尾模块，先看结构占比和整体构成，再进入聚焦层做模块细查。</p>
        </div>
        <div className="chart-toolbar-inline">
          <div className="chart-summary">
            <span className="chart-chip">总 LOC {formatMetricValue(latestTotal)}</span>
            {collapsedCount > 0 ? (
              <span className="chart-chip chart-chip-muted">Others 吸收 {collapsedCount} 个模块</span>
            ) : null}
          </div>
          <div className="chart-focus-switch">
            {focusOptions.map((option) => (
              <button
                aria-pressed={focusMode === option}
                className={`chart-toggle-button ${focusMode === option ? "active" : ""}`}
                key={String(option)}
                onClick={() => setFocusMode(option)}
                type="button"
              >
                {option === "all" ? "全部" : `前 ${option}`}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-surface" ref={containerRef} />
    </div>
  );
}
