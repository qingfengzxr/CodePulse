import { useEffect, useMemo, useRef, useState } from "react";

import * as echarts from "echarts";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildCandlestickSeriesFromQueries, formatMetricValue } from "../analysis-data";
import { axisStyle, baseGrid, createBaseChart, escapeHtml } from "./chart-helpers";

type ModuleCandlestickChartProps = {
  seriesByMetric: {
    loc: SeriesResponseDto;
    added?: SeriesResponseDto;
    deleted?: SeriesResponseDto;
  };
};

type FocusMode = 8 | 16 | "all";

export function ModuleCandlestickChart({ seriesByMetric }: ModuleCandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const [focusMode, setFocusMode] = useState<FocusMode>(8);
  const [selectedModuleKey, setSelectedModuleKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const data = useMemo(
    () =>
      buildCandlestickSeriesFromQueries({
        loc: seriesByMetric.loc,
        added: seriesByMetric.added,
        deleted: seriesByMetric.deleted,
      }),
    [seriesByMetric],
  );

  const rankedModules = [...data.modules].sort((left, right) => {
    const leftClose = left.closes.at(-1) ?? 0;
    const rightClose = right.closes.at(-1) ?? 0;
    if (rightClose !== leftClose) {
      return rightClose - leftClose;
    }

    return left.name.localeCompare(right.name);
  });
  const visibleModules = focusMode === "all" ? rankedModules : rankedModules.slice(0, focusMode);
  const filteredModules = visibleModules.filter((module) =>
    module.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );
  const selectedModule =
    visibleModules.find((module) => module.key === selectedModuleKey) ?? visibleModules[0] ?? null;

  useEffect(() => {
    setSelectedModuleKey(visibleModules[0]?.key ?? null);
  }, [focusMode, seriesByMetric.loc.analysisId, visibleModules[0]?.key]);

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
    const currentModuleLabel = selectedModule ? `${selectedModule.name} / LOC` : "crate / LOC";

    if (!chart || !container || !selectedModule) {
      return;
    }

    const compact = container.clientWidth < 720;
    chart.setOption(
      {
        backgroundColor: "transparent",
        animation: false,
        tooltip: {
          trigger: "axis",
          confine: true,
          formatter: (paramsRaw: unknown) => {
            const params = (Array.isArray(paramsRaw) ? paramsRaw[0] : paramsRaw) as
              | {
                  axisValueLabel?: string;
                  data?: [number, number, number, number];
                }
              | undefined;
            const candle = params?.data ?? [0, 0, 0, 0];

            return [
              `<strong>${escapeHtml(String(params?.axisValueLabel ?? "").slice(0, 10))}</strong>`,
              `Open: ${formatMetricValue(candle[0] ?? 0)}`,
              `Close: ${formatMetricValue(candle[1] ?? 0)}`,
              `Low: ${formatMetricValue(candle[2] ?? 0)}`,
              `High: ${formatMetricValue(candle[3] ?? 0)}`,
            ].join("<br/>");
          },
        },
        grid: baseGrid(compact, 18, 92),
        xAxis: {
          ...axisStyle(),
          type: "category",
          data: data.xAxis,
          boundaryGap: true,
          axisLabel: {
            color: "rgba(244, 239, 228, 0.72)",
            formatter: (value: string) => value.slice(0, 10),
          },
        },
        yAxis: {
          ...axisStyle(),
          type: "value",
          name: currentModuleLabel,
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
            fillerColor: "rgba(251, 113, 133, 0.18)",
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
            type: "candlestick",
            data: selectedModule.candles,
            itemStyle: {
              color: "#22c55e",
              color0: "#f43f5e",
              borderColor: "#4ade80",
              borderColor0: "#fb7185",
            },
            emphasis: {
              itemStyle: {
                borderWidth: 2,
              },
            },
          },
        ],
      } as echarts.EChartsOption,
      true,
    );

    chart.resize();
  }, [data.xAxis, selectedModule]);

  return (
    <div className="chart-panel">
      <div className="chart-toolbar chart-toolbar-stacked">
        <div>
          <h3>{selectedModule ? `${selectedModule.name} / LOC K 线图` : "crate / LOC K 线图"}</h3>
          <p className="chart-subtitle">
            把模块当成交易对来玩。Open 是上一个采样点 LOC，Close 是当前 LOC，High / Low 用 added /
            deleted 推导区间。
          </p>
        </div>
        <div className="chart-toolbar-inline">
          <div className="chart-summary">
            <span className="chart-chip">
              当前交易对 {selectedModule ? selectedModule.name : "-"}
            </span>
            <span className="chart-chip">
              收盘 {formatMetricValue(selectedModule?.closes.at(-1) ?? 0)}
            </span>
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

      <div className="chart-filter-bar">
        <div className="chart-summary">
          <span className="chart-chip">{visibleModules.length} 个候选 crate</span>
          <span className="chart-chip chart-chip-muted">只是好玩，但看起来还真像那么回事</span>
        </div>
        <label className="chart-search">
          <span>搜索模块</span>
          <input
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="按模块名过滤交易对"
            type="search"
            value={searchQuery}
          />
        </label>
      </div>

      <div className="module-selector">
        {filteredModules.map((module) => (
          <button
            aria-pressed={selectedModule?.key === module.key}
            className={`module-selector-pill ${selectedModule?.key === module.key ? "active" : ""}`}
            key={module.key}
            onClick={() => setSelectedModuleKey(module.key)}
            type="button"
          >
            <strong>{module.name}</strong>
            <span>{module.kind}</span>
            <span>Close {formatMetricValue(module.closes.at(-1) ?? 0)}</span>
          </button>
        ))}
        {filteredModules.length === 0 ? <p className="feedback">当前搜索没有命中交易对。</p> : null}
      </div>

      <div className="chart-surface" ref={containerRef} />
    </div>
  );
}
