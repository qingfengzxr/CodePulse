import { useEffect, useRef } from "react";

import * as echarts from "echarts";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildTotalLocSeriesFromQuery, formatMetricValue } from "../analysis-data";
import { useI18n } from "../i18n";
import { useThemeMode } from "../theme";
import { axisStyle, baseGrid, createBaseChart, createBaseTooltip, getChartTokens } from "./chart-helpers";

type RepositoryScaleChartProps = {
  series: SeriesResponseDto;
  showHeader?: boolean;
};

export function RepositoryScaleChart({ series, showHeader = true }: RepositoryScaleChartProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const themeMode = useThemeMode();
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
    const tokens = getChartTokens();

    chart.setOption(
      {
        backgroundColor: "transparent",
        tooltip: {
          ...createBaseTooltip(undefined, tokens),
          trigger: "axis",
        },
        grid: baseGrid(compact),
        xAxis: {
          ...axisStyle(tokens),
          type: "category",
          data: xAxis,
          boundaryGap: false,
          axisLabel: {
            color: tokens.axisLabel,
            formatter: (value: string) => value.slice(0, 10),
          },
        },
        yAxis: {
          ...axisStyle(tokens),
          type: "value",
          name: "LOC",
          nameTextStyle: {
            color: tokens.axisName,
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
            backgroundColor: tokens.zoomBg,
            fillerColor: "rgba(245, 158, 11, 0.18)",
            textStyle: {
              color: tokens.zoomText,
            },
            handleStyle: {
              color: tokens.zoomHandle,
              borderColor: "transparent",
            },
          },
        ],
        series: [
          {
            name: t("chart.repoScale.series.totalLoc"),
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
  }, [t, themeMode, values, xAxis]);

  return (
    <div className="chart-panel">
      <div className="chart-toolbar">
        {showHeader ? (
          <div>
            <h3>{t("chart.repoScale.title")}</h3>
            <p className="chart-subtitle">{t("chart.repoScale.description")}</p>
          </div>
        ) : null}
        <div className="chart-summary">
          <span className="chart-chip">
            {t("chart.repoScale.summary.current", { value: formatMetricValue(latestLoc) })}
          </span>
          <span className="chart-chip">
            {t("chart.repoScale.summary.peak", { value: formatMetricValue(peakLoc) })}
          </span>
        </div>
      </div>
      <div className="chart-surface" ref={containerRef} />
    </div>
  );
}
