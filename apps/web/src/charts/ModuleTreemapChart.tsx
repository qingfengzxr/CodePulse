import { useEffect, useMemo, useRef } from "react";

import * as echarts from "echarts";

import type { ModuleUnitDto } from "@code-dance/contracts";
import { formatModuleSource } from "../display";
import { useI18n } from "../i18n";
import { useThemeMode } from "../theme";
import { createBaseChart, createBaseTooltip, escapeHtml, getChartTokens } from "./chart-helpers";

type ModuleTreemapChartProps = {
  modules: ModuleUnitDto[];
};

function buildTreemapData(modules: ModuleUnitDto[]) {
  const groups = new Map<string, ModuleUnitDto[]>();

  for (const module of modules) {
    const current = groups.get(module.kind) ?? [];
    current.push(module);
    groups.set(module.kind, current);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, kindModules]) => ({
      name: kind,
      value: kindModules.reduce((sum, module) => sum + module.files.length, 0),
      children: kindModules
        .slice()
        .sort((left, right) => right.files.length - left.files.length || left.name.localeCompare(right.name))
        .map((module) => ({
          name: module.name,
          value: Math.max(module.files.length, 1),
          kind: module.kind,
          rootPath: module.rootPath,
          source: module.source,
          fileCount: module.files.length,
        })),
    }));
}

export function ModuleTreemapChart({ modules }: ModuleTreemapChartProps) {
  const { t, formatNumber } = useI18n();
  const themeMode = useThemeMode();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const data = useMemo(() => buildTreemapData(modules), [modules]);

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

    chart.setOption(
      {
        backgroundColor: "transparent",
        animation: false,
        tooltip: {
          ...createBaseTooltip((paramsRaw: unknown) => {
            const params = paramsRaw as {
              data?: {
                name?: string;
                kind?: string;
                rootPath?: string;
                source?: string;
                fileCount?: number;
              };
              treePathInfo?: Array<{ name: string }>;
            };
            const item = params.data;
            if (!item) {
              return "";
            }

            const path = params.treePathInfo?.map((entry) => entry.name).filter(Boolean).join(" / ");
            if (!item.rootPath) {
              return `<strong>${escapeHtml(path || item.name || "-")}</strong>`;
            }

            return [
              `<strong>${escapeHtml(item.name ?? "-")}</strong>`,
              escapeHtml(item.kind ?? "-"),
              `${escapeHtml(t("label.files"))}: ${formatNumber(item.fileCount ?? 0)}`,
              `${escapeHtml(t("label.path"))}: ${escapeHtml(item.rootPath)}`,
              `${escapeHtml(t("label.source"))}: ${escapeHtml(formatModuleSource(item.source === "manual" ? "manual" : "auto"))}`,
            ].join("<br/>");
          }, tokens),
        },
        series: [
          {
            type: "treemap",
            roam: false,
            nodeClick: false,
            breadcrumb: {
              show: false,
            },
            label: {
              show: true,
              formatter: (params: { data?: { name?: string; fileCount?: number; rootPath?: string } }) =>
                params.data?.rootPath
                  ? `${params.data.name}\n${formatNumber(params.data.fileCount ?? 0)}`
                  : params.data?.name ?? "",
              color: tokens.tooltipText,
              fontSize: 13,
              lineHeight: 18,
            },
            upperLabel: {
              show: true,
              height: 22,
              color: tokens.tooltipText,
            },
            itemStyle: {
              borderColor: tokens.axisLine,
              borderWidth: 2,
              gapWidth: 2,
            },
            levels: [
              {
                color: ["#2856c8", "#0f766e", "#9333ea", "#ca8a04", "#dc2626"],
                itemStyle: {
                  borderColor: tokens.axisLine,
                  borderWidth: 3,
                  gapWidth: 4,
                },
                upperLabel: {
                  show: true,
                },
              },
              {
                colorSaturation: [0.28, 0.78],
                itemStyle: {
                  borderColorSaturation: 0.5,
                  gapWidth: 2,
                  borderWidth: 2,
                },
              },
            ],
            data,
          },
        ],
      } as echarts.EChartsOption,
      {
        notMerge: false,
        lazyUpdate: true,
      },
    );
  }, [data, formatNumber, t, themeMode]);

  return <div className="chart-surface chart-surface-tall" ref={containerRef} />;
}
