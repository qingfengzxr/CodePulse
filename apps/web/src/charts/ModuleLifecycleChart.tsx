import { useMemo, useState } from "react";

import type { SeriesResponseDto } from "@code-dance/contracts";
import { buildLifecycleSeriesFromQuery, formatMetricValue, type LifecycleStage } from "../analysis-data";
import { useI18n } from "../i18n";

type ModuleLifecycleChartProps = {
  series: SeriesResponseDto;
  showHeader?: boolean;
};

type SortMode = "latest-loc" | "active-span" | "recency";

const stageOrder: LifecycleStage[] = ["new", "growth", "stable", "decline", "dormant"];

export function ModuleLifecycleChart({ series, showHeader = true }: ModuleLifecycleChartProps) {
  const { t } = useI18n();
  const [stageFilter, setStageFilter] = useState<LifecycleStage | "all">("all");
  const [sortMode, setSortMode] = useState<SortMode>("latest-loc");
  const modules = buildLifecycleSeriesFromQuery(series);
  const maxIndex = Math.max(series.timeline.length - 1, 1);

  const filteredModules = useMemo(() => {
    const next = stageFilter === "all" ? modules : modules.filter((module) => module.stage === stageFilter);

    return [...next].sort((left, right) => {
      if (sortMode === "active-span" && right.activeSpan !== left.activeSpan) {
        return right.activeSpan - left.activeSpan;
      }

      if (sortMode === "recency" && right.lastActiveIndex !== left.lastActiveIndex) {
        return right.lastActiveIndex - left.lastActiveIndex;
      }

      if (right.latestLoc !== left.latestLoc) {
        return right.latestLoc - left.latestLoc;
      }

      return left.name.localeCompare(right.name);
    });
  }, [modules, sortMode, stageFilter]);

  const groups = stageFilter === "all"
    ? stageOrder.map((stage) => ({
        stage,
        modules: filteredModules.filter((module) => module.stage === stage),
      }))
    : [{ stage: stageFilter, modules: filteredModules }];

  return (
    <div className="chart-panel">
      <div className="chart-toolbar chart-toolbar-stacked">
        {showHeader ? (
          <div>
            <h3>{t("chart.lifecycle.title")}</h3>
            <p className="chart-subtitle">{t("chart.lifecycle.description")}</p>
          </div>
        ) : null}
        <div className="chart-toolbar-inline">
          <div className="chart-focus-switch">
            <button
              aria-pressed={stageFilter === "all"}
              className={`chart-toggle-button ${stageFilter === "all" ? "active" : ""}`}
              onClick={() => setStageFilter("all")}
              type="button"
            >
              {t("chart.lifecycle.filter.all")}
            </button>
            {stageOrder.map((stage) => (
              <button
                aria-pressed={stageFilter === stage}
                className={`chart-toggle-button ${stageFilter === stage ? "active" : ""}`}
                key={stage}
                onClick={() => setStageFilter(stage)}
                type="button"
              >
                {t(`chart.lifecycle.stage.${stage}` as const)}
              </button>
            ))}
          </div>
          <div className="chart-focus-switch">
            {(["latest-loc", "active-span", "recency"] as const).map((option) => (
              <button
                aria-pressed={sortMode === option}
                className={`chart-toggle-button ${sortMode === option ? "active" : ""}`}
                key={option}
                onClick={() => setSortMode(option)}
                type="button"
              >
                {t(`chart.lifecycle.sort.${option}` as const)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-summary">
        <span className="chart-chip">{t("chart.summary.loadedAll", { count: String(modules.length) })}</span>
        <span className="chart-chip chart-chip-muted">{t("chart.lifecycle.summary.rules")}</span>
      </div>
      <div className="lifecycle-board">
        {groups.map((group) => (
          <section className="lifecycle-group" key={group.stage}>
            <header className="lifecycle-group-header">
              <h4>{t(`chart.lifecycle.stage.${group.stage}` as const)}</h4>
              <span className="chart-chip">{group.modules.length}</span>
            </header>
            <div className="lifecycle-list">
              {group.modules.map((module) => {
                const left = (module.firstActiveIndex / maxIndex) * 100;
                const width = (Math.max(1, module.activeSpan) / (maxIndex + 1)) * 100;
                return (
                  <article className={`lifecycle-row lifecycle-stage-${module.stage}`} key={module.key}>
                    <div className="lifecycle-row-main">
                      <strong>{module.name}</strong>
                      <span>{module.kind}</span>
                    </div>
                    <div className="lifecycle-track">
                      <div className="lifecycle-track-line" />
                      <div className="lifecycle-track-bar" style={{ left: `${left}%`, width: `${width}%` }} />
                    </div>
                    <div className="lifecycle-row-meta">
                      <span>{t("chart.lifecycle.meta.latestLoc", { value: formatMetricValue(module.latestLoc) })}</span>
                      <span>{t("chart.lifecycle.meta.peakLoc", { value: formatMetricValue(module.peakLoc) })}</span>
                    </div>
                  </article>
                );
              })}
              {group.modules.length === 0 ? <p className="feedback">{t("feedback.searchNoMatches")}</p> : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
