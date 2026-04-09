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
      <main className="page-grid">
        <section className="surface-section">
          <div className="empty-state">
            <strong>仓库 ID 缺失</strong>
            <p>当前页面缺少目标仓库标识，无法加载模块清单。</p>
          </div>
        </section>
      </main>
    );
  }

  if (!repository) {
    return (
      <main className="page-grid">
        <section className="surface-section">
          <div className="section-heading section-heading-inline">
            <div>
              <p className="section-kicker">Modules</p>
              <h2>未找到对应仓库</h2>
            </div>
            <Link className="secondary-button" to="/">
              返回工作台
            </Link>
          </div>
          <div className="empty-state">
            <strong>仓库不存在</strong>
            <p>该仓库可能尚未接入工作台，或者已被删除。</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-grid">
      <section className="surface-section detail-summary-section">
        <div className="section-heading section-heading-inline">
          <div>
            <p className="section-kicker">Modules</p>
            <h2>{repository.name}</h2>
            <p className="section-description">这里专门查看模块结构，不把细节挤回工作台首页。</p>
          </div>
          <div className="detail-action-row">
            <Link className="secondary-button" to="/">
              返回工作台
            </Link>
            <button
              className="primary-button"
              onClick={() => void onLoadModules(repository.id)}
              type="button"
            >
              {loading ? "探测中..." : modules ? "刷新模块" : "探测模块"}
            </button>
          </div>
        </div>

        <div className="summary-grid summary-grid-compact">
          <article className="summary-card">
            <span>默认分支</span>
            <strong>{repository.defaultBranch ?? "unknown"}</strong>
            <p>当前仓库登记的默认分支。</p>
          </article>
          <article className="summary-card">
            <span>语言类型</span>
            <strong>{repository.detectedKinds.join(", ")}</strong>
            <p>仓库当前识别出的技术栈。</p>
          </article>
          <article className="summary-card">
            <span>模块数量</span>
            <strong>{modules?.length ?? 0}</strong>
            <p>已探测到的技术模块数量。</p>
          </article>
        </div>
      </section>

      <section className="surface-section">
        <div className="section-heading section-heading-inline">
          <div>
            <p className="section-kicker">Structure</p>
            <h2>模块清单</h2>
            <p className="section-description">重点看名称、路径、文件数和来源，避免额外装饰干扰阅读。</p>
          </div>
          <span className="meta-chip">{modules?.length ?? 0} 个模块</span>
        </div>

        {loading ? (
          <div className="empty-state">
            <strong>正在探测模块</strong>
            <p>模块分析完成后会自动显示在下方表格中。</p>
          </div>
        ) : null}

        {!loading && modules && modules.length === 0 ? (
          <div className="empty-state">
            <strong>当前未探测到可用模块</strong>
            <p>可以重新探测一次，或检查仓库目录结构是否完整。</p>
          </div>
        ) : null}

        {!loading && modules?.length ? (
          <div className="module-table-wrap">
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
                      <span className="repository-kind">{module.kind}</span>
                      <strong>{module.name}</strong>
                    </div>
                    <div className="module-table-cell">
                      <code className="module-table-path">{module.rootPath}</code>
                    </div>
                    <div className="module-table-cell module-table-number">{module.files.length}</div>
                    <div className="module-table-cell">
                      <span className="meta-chip">{module.source}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
