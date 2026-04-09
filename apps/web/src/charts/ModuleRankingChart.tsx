import { useEffect, useRef, useState } from "react";

import * as echarts from "echarts";

import type { RankingResponseDto } from "@code-dance/contracts";
import {
  buildCurrentRankingFromQuery,
  formatMetricLabel,
  formatMetricValue,
  type MetricKey,
} from "../analysis-data";
import { axisStyle, baseGrid, createBaseChart } from "./chart-helpers";

type ModuleRankingChartProps = {
  analysisId: string;
};

type ApiError = {
  error: string;
  message: string;
};

const rankingMetrics: MetricKey[] = ["loc", "added", "deleted", "churn"];

export function ModuleRankingChart({ analysisId }: ModuleRankingChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const [metric, setMetric] = useState<MetricKey>("loc");
  const [visibleCount, setVisibleCount] = useState<8 | 16>(8);
  const [rankingResponse, setRankingResponse] = useState<RankingResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranking = rankingResponse ? buildCurrentRankingFromQuery(rankingResponse) : [];

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
    let cancelled = false;

    async function loadRanking() {
      setError(null);

      try {
        const query = new URLSearchParams({
          analysisId,
          metric,
          snapshot: "latest",
          limit: String(visibleCount),
        });
        const response = await fetch(`/api/ranking?${query.toString()}`);
        if (!response.ok) {
          const payload = (await response.json()) as ApiError;
          throw new Error(payload.message);
        }

        const payload = (await response.json()) as RankingResponseDto;
        if (!cancelled) {
          setRankingResponse(payload);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "failed to load ranking");
        }
      }
    }

    void loadRanking();

    return () => {
      cancelled = true;
    };
  }, [analysisId, metric, visibleCount]);

  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;

    if (!chart || !container) {
      return;
    }

    const compact = container.clientWidth < 720;
    const reversed = [...ranking].reverse();

    chart.setOption(
      {
        backgroundColor: "transparent",
        tooltip: {
          trigger: "axis",
          axisPointer: {
            type: "shadow",
          },
          formatter: (paramsRaw: unknown) => {
            const params = (Array.isArray(paramsRaw) ? paramsRaw[0] : paramsRaw) as
              | { name?: string; value?: number }
              | undefined;

            return [
              `<strong>${params?.name ?? "-"}</strong>`,
              `${formatMetricLabel(metric)}: ${formatMetricValue(Number(params?.value ?? 0))}`,
            ].join("<br/>");
          },
        },
        grid: baseGrid(compact, 18, 22),
        xAxis: {
          ...axisStyle(),
          type: "value",
        },
        yAxis: {
          ...axisStyle(),
          type: "category",
          data: reversed.map((entry) => entry.name),
          axisLabel: {
            color: "rgba(244, 239, 228, 0.72)",
            width: compact ? 120 : 180,
            overflow: "truncate",
          },
        },
        series: [
          {
            type: "bar",
            data: reversed.map((entry) => entry.value),
            barWidth: 18,
            itemStyle: {
              borderRadius: [0, 8, 8, 0],
              color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
                { offset: 0, color: "#38bdf8" },
                { offset: 1, color: "#f59e0b" },
              ]),
            },
          },
        ],
      } as echarts.EChartsOption,
      true,
    );

    chart.resize();
  }, [metric, ranking]);

  const total = ranking.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <div className="chart-panel">
      <div className="chart-toolbar chart-toolbar-stacked">
        <div>
          <h3>当前时间点模块排行</h3>
          <p className="chart-subtitle">
            横向条形图适合回答“谁最大、谁最活跃”，这里直接读取 ranking 查询接口。
          </p>
        </div>
        <div className="chart-toolbar-inline">
          <div className="metric-switch">
            {rankingMetrics.map((candidate) => (
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
            {[8, 16].map((count) => (
              <button
                aria-pressed={visibleCount === count}
                className={`chart-toggle-button ${visibleCount === count ? "active" : ""}`}
                key={count}
                onClick={() => setVisibleCount(count as 8 | 16)}
                type="button"
              >
                前 {count}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-summary">
        <span className="chart-chip">Top 合计 {formatMetricValue(total)}</span>
      </div>
      <div className="chart-surface chart-surface-tall" ref={containerRef} />
      {error ? <p className="feedback error">{error}</p> : null}
    </div>
  );
}
