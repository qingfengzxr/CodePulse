import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";

import type { ModuleUnitDto, RepositoryTargetDto } from "@code-dance/contracts";

type RepositoryModulesPageProps = {
  moduleLoading: Record<string, boolean>;
  moduleResults: Record<string, ModuleUnitDto[] | undefined>;
  onLoadModules: (repositoryId: string) => Promise<void> | void;
  repositories: RepositoryTargetDto[];
};

export function RepositoryModulesPage({
  moduleLoading,
  moduleResults,
  onLoadModules,
  repositories,
}: RepositoryModulesPageProps) {
  const { repositoryId } = useParams();
  const repository = repositoryId
    ? repositories.find((candidate) => candidate.id === repositoryId)
    : undefined;
  const modules = repositoryId ? moduleResults[repositoryId] : undefined;
  const loading = repositoryId ? moduleLoading[repositoryId] : false;

  useEffect(() => {
    if (!repositoryId || modules) {
      return;
    }

    void onLoadModules(repositoryId);
  }, [modules, onLoadModules, repositoryId]);

  if (!repositoryId) {
    return (
      <main className="layout">
        <section className="panel">
          <p className="feedback error">仓库 ID 缺失。</p>
        </section>
      </main>
    );
  }

  if (!repository) {
    return (
      <main className="layout">
        <section className="panel">
          <div className="detail-header">
            <Link className="ghost-button detail-link-button" to="/">
              返回工作台
            </Link>
          </div>
          <p className="feedback error">未找到对应仓库。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="layout">
      <section className="panel detail-hero">
        <div className="detail-header">
          <div>
            <p className="panel-kicker">Module List</p>
            <h1 className="detail-title">{repository.name}</h1>
            <p className="hero-copy">
              独立查看技术模块清单，避免首页卡片因为模块探测结果而一次性全部展开。
            </p>
            <div className="detail-meta-strip">
              <span className="mono-badge">{repository.defaultBranch ?? "unknown"}</span>
              <span className="mono-badge">{repository.detectedKinds.join(", ")}</span>
              <span className="mono-badge">
                {modules ? `${modules.length} 个模块` : "尚未加载"}
              </span>
            </div>
          </div>
          <div className="detail-actions">
            <Link className="ghost-button detail-link-button" to="/">
              返回工作台
            </Link>
            <button
              className="ghost-button"
              onClick={() => void onLoadModules(repository.id)}
              type="button"
            >
              {loading ? "探测中..." : modules ? "刷新模块" : "探测模块"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Detected Modules</p>
            <h2>模块清单</h2>
            <p className="section-copy">当前按技术模块展示名称、类型、根路径与文件数量。</p>
          </div>
          <span className="stat-chip">{modules?.length ?? 0} 个模块</span>
        </div>

        {loading ? <p className="feedback">正在探测模块...</p> : null}
        {!loading && modules && modules.length === 0 ? (
          <p className="feedback">当前未探测到可用模块。</p>
        ) : null}

        {!loading && modules?.length ? (
          <div className="module-table">
            <div className="module-table-header">
              <span>模块</span>
              <span>路径</span>
              <span>文件数</span>
              <span>来源</span>
            </div>
            <div className="module-table-body">
              {modules.map((module) => (
                <article className="module-table-row" key={module.key}>
                  <div className="module-table-cell module-table-main">
                    <span className="repository-language">{module.kind}</span>
                    <strong>{module.name}</strong>
                  </div>
                  <div className="module-table-cell">
                    <code className="module-table-path">{module.rootPath}</code>
                  </div>
                  <div className="module-table-cell module-table-number">
                    {module.files.length}
                  </div>
                  <div className="module-table-cell">
                    <span className="mono-badge">{module.source}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
