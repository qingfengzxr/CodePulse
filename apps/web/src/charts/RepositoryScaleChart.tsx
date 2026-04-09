import { useEffect, useRef } from "react";

import * as echarts from "echarts";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildTotalLocSeriesFromQuery, formatMetricValue } from "../analysis-data";
import { axisStyle, baseGrid, createBaseChart } from "./chart-helpers";

type RepositoryScaleChartProps = {
  series: SeriesResponseDto;
};

export function RepositoryScaleChart({ series }: RepositoryScaleChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const { xAxis, values } = buildTotalLocSeriesFromQuery(series);
  const latestLoc = values.at(-1) ?? 0;
  const peakLoc = values.reduce((peak, value) => Math.max(peak, value), 0);

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
        },
        grid: baseGrid(compact),
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
            bottom: 18,
            borderColor: "transparent",
            backgroundColor: "rgba(255, 255, 255, 0.06)",
            fillerColor: "rgba(245, 158, 11, 0.18)",
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
            name: "总 LOC",
            type: "line",
            smooth: true,
            showSymbol: false,
            data: values,
            lineStyle: {
              width: 3,
              color: "#f59e0b",
            },
            areaStyle: {
              color: "rgba(245, 158, 11, 0.16)",
            },
          },
        ],
      } as echarts.EChartsOption,
      true,
    );

    chart.resize();
  }, [values, xAxis]);

  return (
    <div className="chart-panel">
      <div className="chart-toolbar">
        <div>
          <h3>仓库总 LOC 趋势</h3>
          <p className="chart-subtitle">
            回答“整体规模如何变化”，只展示总量，不在这里堆叠模块细节。
          </p>
        </div>
        <div className="chart-summary">
          <span className="chart-chip">当前 {formatMetricValue(latestLoc)}</span>
          <span className="chart-chip">峰值 {formatMetricValue(peakLoc)}</span>
        </div>
      </div>
      <div className="chart-surface" ref={containerRef} />
    </div>
  );
}
