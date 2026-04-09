import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

import type {
  AnalysisJob,
  AnalysisProgress,
  AnalysisResult,
  MetricPoint,
  RepositoryTarget,
  Snapshot,
} from "@code-dance/domain";

export type AnalysisMetric = "loc" | "added" | "deleted" | "churn";

export type AnalysisModuleSummary = {
  key: string;
  name: string;
  kind: string;
};

export type SnapshotSummary = {
  seq: number;
  commit: string;
  ts: string;
};

export type SeriesResult = {
  analysisId: string;
  metric: AnalysisMetric;
  timeline: SnapshotSummary[];
  series: Array<{
    moduleKey: string;
    moduleName: string;
    moduleKind: string;
    values: number[];
  }>;
};

export type DistributionResult = {
  analysisId: string;
  metric: AnalysisMetric;
  snapshot: SnapshotSummary;
  items: Array<{
    moduleKey: string;
    moduleName: string;
    moduleKind: string;
    value: number;
  }>;
};

export type RankingResult = {
  analysisId: string;
  metric: AnalysisMetric;
  snapshot: SnapshotSummary;
  limit: number;
  items: Array<{
    moduleKey: string;
    moduleName: string;
    moduleKind: string;
    value: number;
  }>;
};

export type AnalysisSummary = {
  job: AnalysisJob;
  progress: AnalysisProgress;
  snapshotCount: number;
  latestSnapshot: SnapshotSummary | null;
};

export interface RepositoryTargetStore {
  list(): Promise<RepositoryTarget[]>;
  create(repository: RepositoryTarget): Promise<RepositoryTarget>;
  getById(id: string): Promise<RepositoryTarget | null>;
  getByLocalPath(localPath: string): Promise<RepositoryTarget | null>;
  deleteById(id: string): Promise<boolean>;
}

export interface AnalysisJobStore {
  list(): Promise<AnalysisJob[]>;
  create(job: AnalysisJob): Promise<AnalysisJob>;
  getById(id: string): Promise<AnalysisJob | null>;
  upsertProgress(analysisId: string, progress: AnalysisProgress): Promise<void>;
  updateJob(
    id: string,
    updater: (current: AnalysisJob) => AnalysisJob,
  ): Promise<AnalysisJob | null>;
}

export interface AnalysisResultQueryStore {
  listAnalysisSummaries(): Promise<AnalysisSummary[]>;
  listAnalysisResults(): Promise<AnalysisResult[]>;
  getAnalysisResult(id: string): Promise<AnalysisResult | null>;
  listSnapshots(analysisId: string): Promise<SnapshotSummary[]>;
  listMetricPoints(analysisId: string): Promise<MetricPoint[]>;
  listModulesByAnalysis(analysisId: string): Promise<AnalysisModuleSummary[]>;
  querySeries(input: {
    analysisId: string;
    metric: AnalysisMetric;
    moduleKeys?: string[];
  }): Promise<SeriesResult | null>;
  queryDistribution(input: {
    analysisId: string;
    metric: AnalysisMetric;
    snapshot: "latest" | number;
  }): Promise<DistributionResult | null>;
  queryRanking(input: {
    analysisId: string;
    metric: AnalysisMetric;
    snapshot: "latest" | number;
    limit: number;
  }): Promise<RankingResult | null>;
}

export interface AnalysisPersistenceStore {
  replaceAnalysisResult(input: {
    analysisId: string;
    snapshots: Snapshot[];
    points: MetricPoint[];
  }): Promise<void>;
}

export type SqliteStorage = {
  repositories: RepositoryTargetStore;
  analysisJobs: AnalysisJobStore;
  query: AnalysisResultQueryStore;
  persistence: AnalysisPersistenceStore;
  close(): void;
  dbPath: string;
};

export function defaultDatabasePath(cwd = process.cwd()) {
  return resolve(cwd, ".code-dance/code-dance.sqlite");
}

export function createSqliteStorage(options?: { dbPath?: string }): SqliteStorage {
  const dbPath = resolve(options?.dbPath ?? defaultDatabasePath());
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initializeSchema(db);

  const repositories: RepositoryTargetStore = {
    async list() {
      const rows = db
        .prepare(
          `select id, name, source_type, local_path, remote_url, default_branch, detected_kinds, status, created_at
           from repository_targets
           order by created_at desc`,
        )
        .all() as RepositoryRow[];

      return rows.map(mapRepositoryRow);
    },
    async create(repository) {
      db.prepare(
        `insert into repository_targets (
          id, name, source_type, local_path, remote_url, default_branch, detected_kinds, status, created_at
        ) values (
          @id, @name, @source_type, @local_path, @remote_url, @default_branch, @detected_kinds, @status, @created_at
        )`,
      ).run(repositoryToRow(repository));

      return repository;
    },
    async getById(id) {
      const row = db
        .prepare(
          `select id, name, source_type, local_path, remote_url, default_branch, detected_kinds, status, created_at
           from repository_targets
           where id = ?`,
        )
        .get(id) as RepositoryRow | undefined;

      return row ? mapRepositoryRow(row) : null;
    },
    async getByLocalPath(localPath) {
      const row = db
        .prepare(
          `select id, name, source_type, local_path, remote_url, default_branch, detected_kinds, status, created_at
           from repository_targets
           where local_path = ?`,
        )
        .get(localPath) as RepositoryRow | undefined;

      return row ? mapRepositoryRow(row) : null;
    },
    async deleteById(id) {
      const transaction = db.transaction((repositoryId: string) => {
        const analysisIds = db
          .prepare(`select id from analysis_jobs where repository_id = ?`)
          .all(repositoryId) as Array<{ id: string }>;

        for (const analysis of analysisIds) {
          db.prepare(`delete from analysis_progress where analysis_id = ?`).run(analysis.id);
          db.prepare(`delete from snapshots where analysis_id = ?`).run(analysis.id);
          db.prepare(`delete from module_metrics where analysis_id = ?`).run(analysis.id);
          db.prepare(`delete from analysis_modules where analysis_id = ?`).run(analysis.id);
        }

        db.prepare(`delete from analysis_jobs where repository_id = ?`).run(repositoryId);
        return (
          db.prepare(`delete from repository_targets where id = ?`).run(repositoryId).changes > 0
        );
      });

      return transaction(id);
    },
  };

  const analysisJobs: AnalysisJobStore = {
    async list() {
      const rows = db
        .prepare(
          `select id, repository_id, branch, sampling, status, created_at, finished_at, error_message
           from analysis_jobs
           order by created_at desc`,
        )
        .all() as AnalysisJobRow[];

      return rows.map(mapAnalysisJobRow);
    },
    async create(job) {
      db.prepare(
        `insert into analysis_jobs (
          id, repository_id, branch, sampling, status, created_at, finished_at, error_message
        ) values (
          @id, @repository_id, @branch, @sampling, @status, @created_at, @finished_at, @error_message
        )`,
      ).run(analysisJobToRow(job));

      return job;
    },
    async getById(id) {
      const row = db
        .prepare(
          `select id, repository_id, branch, sampling, status, created_at, finished_at, error_message
           from analysis_jobs
           where id = ?`,
        )
        .get(id) as AnalysisJobRow | undefined;

      return row ? mapAnalysisJobRow(row) : null;
    },
    async upsertProgress(analysisId, progress) {
      db.prepare(
        `insert into analysis_progress (
          analysis_id, phase, percent, total_commits, sampled_commits, completed_snapshots, current_commit,
          current_module, current_files, processed_files, eta_seconds, started_at, updated_at
        ) values (
          @analysis_id, @phase, @percent, @total_commits, @sampled_commits, @completed_snapshots, @current_commit,
          @current_module, @current_files, @processed_files, @eta_seconds, @started_at, @updated_at
        )
        on conflict(analysis_id) do update set
          phase = excluded.phase,
          percent = excluded.percent,
          total_commits = excluded.total_commits,
          sampled_commits = excluded.sampled_commits,
          completed_snapshots = excluded.completed_snapshots,
          current_commit = excluded.current_commit,
          current_module = excluded.current_module,
          current_files = excluded.current_files,
          processed_files = excluded.processed_files,
          eta_seconds = excluded.eta_seconds,
          started_at = excluded.started_at,
          updated_at = excluded.updated_at`,
      ).run(analysisProgressToRow(analysisId, progress));
    },
    async updateJob(id, updater) {
      const current = await this.getById(id);
      if (!current) {
        return null;
      }

      const next = updater(current);
      db.prepare(
        `update analysis_jobs
         set repository_id = @repository_id,
             branch = @branch,
             sampling = @sampling,
             status = @status,
             created_at = @created_at,
             finished_at = @finished_at,
             error_message = @error_message
         where id = @id`,
      ).run(analysisJobToRow(next));

      return next;
    },
  };

  const query: AnalysisResultQueryStore = {
    async listAnalysisSummaries() {
      const rows = db
        .prepare(
          `select
             j.id,
             j.repository_id,
             j.branch,
             j.sampling,
             j.status,
             j.created_at,
             j.finished_at,
             j.error_message,
             p.phase,
             p.percent,
             p.total_commits,
             p.sampled_commits,
             p.completed_snapshots,
             p.current_commit,
             p.current_module,
             p.current_files,
             p.processed_files,
             p.eta_seconds,
             p.started_at,
             p.updated_at,
             count(s.seq) as snapshot_count,
             max(s.seq) as latest_snapshot_seq
           from analysis_jobs j
           left join analysis_progress p on p.analysis_id = j.id
           left join snapshots s on s.analysis_id = j.id
           group by
             j.id,
             j.repository_id,
             j.branch,
             j.sampling,
             j.status,
             j.created_at,
             j.finished_at,
             j.error_message,
             p.phase,
             p.percent,
             p.total_commits,
             p.sampled_commits,
             p.completed_snapshots,
             p.current_commit,
             p.current_module,
             p.current_files,
             p.processed_files,
             p.eta_seconds,
             p.started_at,
             p.updated_at
           order by j.created_at desc`,
        )
        .all() as AnalysisSummaryRow[];

      return rows.map((row) => {
        const job = mapAnalysisJobRow(row);
        const latestSnapshot =
          row.latest_snapshot_seq === null
            ? null
            : resolveSnapshot(db, row.id, row.latest_snapshot_seq);

        return {
          job,
          progress: row.phase
            ? mapAnalysisProgressRow(row as AnalysisProgressRow)
            : createFallbackProgress(job),
          snapshotCount: row.snapshot_count,
          latestSnapshot,
        };
      });
    },
    async listAnalysisResults() {
      const jobs = await analysisJobs.list();
      const results: AnalysisResult[] = [];

      for (const job of jobs) {
        const result = await this.getAnalysisResult(job.id);
        if (result) {
          results.push(result);
        }
      }

      return results;
    },
    async getAnalysisResult(id) {
      const job = await analysisJobs.getById(id);
      if (!job) {
        return null;
      }

      const progress = getAnalysisProgress(db, id) ?? createFallbackProgress(job);
      const snapshots = await this.listSnapshots(id);
      const points = await this.listMetricPoints(id);

      return {
        job,
        progress,
        snapshots: snapshots.map((snapshot) => ({
          analysisId: id,
          commit: snapshot.commit,
          ts: snapshot.ts,
        })),
        points,
      };
    },
    async listSnapshots(analysisId) {
      const rows = db
        .prepare(
          `select seq, commit_hash, ts
           from snapshots
           where analysis_id = ?
           order by seq asc`,
        )
        .all(analysisId) as SnapshotRow[];

      return rows.map(mapSnapshotSummaryRow);
    },
    async listMetricPoints(analysisId) {
      const rows = db
        .prepare(
          `select analysis_id, ts, commit_hash, module_key, module_name, module_kind, loc, added, deleted, churn
           from module_metrics
           where analysis_id = ?
           order by ts asc, module_key asc`,
        )
        .all(analysisId) as MetricPointRow[];

      return rows.map(mapMetricPointRow);
    },
    async listModulesByAnalysis(analysisId) {
      const rows = db
        .prepare(
          `select module_key, module_name, module_kind
           from analysis_modules
           where analysis_id = ?
           order by module_key asc`,
        )
        .all(analysisId) as AnalysisModuleRow[];

      return rows.map(mapAnalysisModuleRow);
    },
    async querySeries(input) {
      const timeline = await this.listSnapshots(input.analysisId);
      const analysis = await analysisJobs.getById(input.analysisId);
      if (!analysis) {
        return null;
      }

      const moduleKeys = input.moduleKeys && input.moduleKeys.length > 0 ? input.moduleKeys : null;
      const rows = readSeriesRows(db, input.analysisId, moduleKeys);
      const seqToIndex = new Map(timeline.map((snapshot, index) => [snapshot.seq, index]));
      const grouped = new Map<
        string,
        { moduleKey: string; moduleName: string; moduleKind: string; values: number[] }
      >();

      for (const row of rows) {
        const item = grouped.get(row.module_key) ?? {
          moduleKey: row.module_key,
          moduleName: row.module_name,
          moduleKind: row.module_kind,
          values: Array.from({ length: timeline.length }, () => 0),
        };
        const index = seqToIndex.get(row.snapshot_seq);
        if (index !== undefined) {
          item.values[index] = Number(row[input.metric]);
        }
        grouped.set(row.module_key, item);
      }

      return {
        analysisId: input.analysisId,
        metric: input.metric,
        timeline,
        series: Array.from(grouped.values()).sort((left, right) =>
          left.moduleKey.localeCompare(right.moduleKey),
        ),
      };
    },
    async queryDistribution(input) {
      const analysis = await analysisJobs.getById(input.analysisId);
      if (!analysis) {
        return null;
      }

      const snapshot = resolveSnapshot(db, input.analysisId, input.snapshot);
      if (!snapshot) {
        return null;
      }

      const rows = db
        .prepare(
          `select module_key, module_name, module_kind, ${input.metric} as value
           from module_metrics
           where analysis_id = ? and snapshot_seq = ?
           order by value desc, module_key asc`,
        )
        .all(input.analysisId, snapshot.seq) as MetricValueRow[];

      return {
        analysisId: input.analysisId,
        metric: input.metric,
        snapshot,
        items: rows.map(mapMetricValueRow),
      };
    },
    async queryRanking(input) {
      const distribution = await this.queryDistribution({
        analysisId: input.analysisId,
        metric: input.metric,
        snapshot: input.snapshot,
      });
      if (!distribution) {
        return null;
      }

      return {
        analysisId: distribution.analysisId,
        metric: distribution.metric,
        snapshot: distribution.snapshot,
        limit: input.limit,
        items: distribution.items.slice(0, input.limit),
      };
    },
  };

  const persistence: AnalysisPersistenceStore = {
    async replaceAnalysisResult(input) {
      const snapshotInsert = db.prepare(
        `insert into snapshots (analysis_id, seq, commit_hash, ts)
         values (?, ?, ?, ?)`,
      );
      const metricInsert = db.prepare(
        `insert into module_metrics (
          analysis_id, snapshot_seq, ts, commit_hash, module_key, module_name, module_kind, loc, added, deleted, churn
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const moduleInsert = db.prepare(
        `insert into analysis_modules (analysis_id, module_key, module_name, module_kind)
         values (?, ?, ?, ?)`,
      );

      const transaction = db.transaction(() => {
        db.prepare(`delete from snapshots where analysis_id = ?`).run(input.analysisId);
        db.prepare(`delete from module_metrics where analysis_id = ?`).run(input.analysisId);
        db.prepare(`delete from analysis_modules where analysis_id = ?`).run(input.analysisId);

        const snapshotSeqByKey = new Map<string, number>();

        for (const [index, snapshot] of input.snapshots.entries()) {
          const seq = index + 1;
          snapshotInsert.run(input.analysisId, seq, snapshot.commit, snapshot.ts);
          snapshotSeqByKey.set(toSnapshotKey(snapshot.ts, snapshot.commit), seq);
        }

        const seenModuleKeys = new Set<string>();

        for (const point of input.points) {
          const snapshotSeq = snapshotSeqByKey.get(toSnapshotKey(point.ts, point.commit));
          if (!snapshotSeq) {
            throw new Error(
              `metric point does not match a known snapshot: ${point.ts} ${point.commit}`,
            );
          }

          metricInsert.run(
            input.analysisId,
            snapshotSeq,
            point.ts,
            point.commit,
            point.moduleKey,
            point.moduleName,
            point.moduleKind,
            point.loc,
            point.added,
            point.deleted,
            point.churn,
          );

          if (!seenModuleKeys.has(point.moduleKey)) {
            moduleInsert.run(input.analysisId, point.moduleKey, point.moduleName, point.moduleKind);
            seenModuleKeys.add(point.moduleKey);
          }
        }
      });

      transaction();
    },
  };

  return {
    repositories,
    analysisJobs,
    query,
    persistence,
    close() {
      db.close();
    },
    dbPath,
  };
}

function initializeSchema(db: Database.Database) {
  db.exec(`
    create table if not exists repository_targets (
      id text primary key,
      name text not null,
      source_type text not null,
      local_path text,
      remote_url text,
      default_branch text,
      detected_kinds text not null,
      status text not null,
      created_at text not null
    );

    create table if not exists analysis_jobs (
      id text primary key,
      repository_id text not null,
      branch text not null,
      sampling text not null,
      status text not null,
      created_at text not null,
      finished_at text,
      error_message text
    );

    create table if not exists analysis_progress (
      analysis_id text primary key,
      phase text not null,
      percent real not null,
      total_commits integer not null,
      sampled_commits integer not null,
      completed_snapshots integer not null,
      current_commit text,
      current_module text,
      current_files integer,
      processed_files integer,
      eta_seconds integer,
      started_at text not null,
      updated_at text not null
    );

    create table if not exists snapshots (
      analysis_id text not null,
      seq integer not null,
      commit_hash text not null,
      ts text not null,
      primary key (analysis_id, seq)
    );

    create table if not exists analysis_modules (
      analysis_id text not null,
      module_key text not null,
      module_name text not null,
      module_kind text not null,
      primary key (analysis_id, module_key)
    );

    create table if not exists module_metrics (
      analysis_id text not null,
      snapshot_seq integer not null,
      ts text not null,
      commit_hash text not null,
      module_key text not null,
      module_name text not null,
      module_kind text not null,
      loc integer not null,
      added integer not null,
      deleted integer not null,
      churn integer not null,
      primary key (analysis_id, snapshot_seq, module_key)
    );

    create index if not exists idx_analysis_jobs_created_at
      on analysis_jobs (created_at desc);

    create index if not exists idx_snapshots_analysis_seq
      on snapshots (analysis_id, seq);

    create index if not exists idx_module_metrics_analysis_ts
      on module_metrics (analysis_id, ts, module_key);
  `);
}

function readSeriesRows(db: Database.Database, analysisId: string, moduleKeys: string[] | null) {
  if (!moduleKeys || moduleKeys.length === 0) {
    return db
      .prepare(
        `select snapshot_seq, module_key, module_name, module_kind, loc, added, deleted, churn
         from module_metrics
         where analysis_id = ?
         order by module_key asc, snapshot_seq asc`,
      )
      .all(analysisId) as SeriesRow[];
  }

  const placeholders = moduleKeys.map(() => "?").join(", ");
  return db
    .prepare(
      `select snapshot_seq, module_key, module_name, module_kind, loc, added, deleted, churn
       from module_metrics
       where analysis_id = ? and module_key in (${placeholders})
       order by module_key asc, snapshot_seq asc`,
    )
    .all(analysisId, ...moduleKeys) as SeriesRow[];
}

function resolveSnapshot(
  db: Database.Database,
  analysisId: string,
  snapshot: "latest" | number,
): SnapshotSummary | null {
  const row =
    snapshot === "latest"
      ? (db
          .prepare(
            `select seq, commit_hash, ts
             from snapshots
             where analysis_id = ?
             order by seq desc
             limit 1`,
          )
          .get(analysisId) as SnapshotRow | undefined)
      : (db
          .prepare(
            `select seq, commit_hash, ts
             from snapshots
             where analysis_id = ? and seq = ?`,
          )
          .get(analysisId, snapshot) as SnapshotRow | undefined);

  return row ? mapSnapshotSummaryRow(row) : null;
}

function getAnalysisProgress(db: Database.Database, analysisId: string): AnalysisProgress | null {
  const row = db
    .prepare(
      `select analysis_id, phase, percent, total_commits, sampled_commits, completed_snapshots, current_commit,
              current_module, current_files, processed_files, eta_seconds, started_at, updated_at
       from analysis_progress
       where analysis_id = ?`,
    )
    .get(analysisId) as AnalysisProgressRow | undefined;

  return row ? mapAnalysisProgressRow(row) : null;
}

function createFallbackProgress(job: AnalysisJob): AnalysisProgress {
  return {
    phase: job.status === "failed" ? "failed" : job.status === "done" ? "done" : "pending",
    percent: job.status === "done" ? 100 : 0,
    totalCommits: 0,
    sampledCommits: 0,
    completedSnapshots: 0,
    currentCommit: null,
    currentModule: null,
    currentFiles: null,
    processedFiles: null,
    etaSeconds: job.status === "done" ? 0 : null,
    startedAt: job.createdAt,
    updatedAt: job.finishedAt ?? job.createdAt,
  };
}

function repositoryToRow(repository: RepositoryTarget): RepositoryRow {
  return {
    id: repository.id,
    name: repository.name,
    source_type: repository.sourceType,
    local_path: repository.localPath,
    remote_url: repository.remoteUrl,
    default_branch: repository.defaultBranch,
    detected_kinds: JSON.stringify(repository.detectedKinds),
    status: repository.status,
    created_at: repository.createdAt,
  };
}

function mapRepositoryRow(row: RepositoryRow): RepositoryTarget {
  return {
    id: row.id,
    name: row.name,
    sourceType: row.source_type,
    localPath: row.local_path,
    remoteUrl: row.remote_url,
    defaultBranch: row.default_branch,
    detectedKinds: JSON.parse(row.detected_kinds) as RepositoryTarget["detectedKinds"],
    status: row.status,
    createdAt: row.created_at,
  };
}

function analysisJobToRow(job: AnalysisJob): AnalysisJobRow {
  return {
    id: job.id,
    repository_id: job.repositoryId,
    branch: job.branch,
    sampling: job.sampling,
    status: job.status,
    created_at: job.createdAt,
    finished_at: job.finishedAt ?? null,
    error_message: job.errorMessage ?? null,
  };
}

function mapAnalysisJobRow(row: AnalysisJobRow): AnalysisJob {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    branch: row.branch,
    sampling: row.sampling,
    status: row.status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
  };
}

function analysisProgressToRow(
  analysisId: string,
  progress: AnalysisProgress,
): AnalysisProgressRow {
  return {
    analysis_id: analysisId,
    phase: progress.phase,
    percent: progress.percent,
    total_commits: progress.totalCommits,
    sampled_commits: progress.sampledCommits,
    completed_snapshots: progress.completedSnapshots,
    current_commit: progress.currentCommit,
    current_module: progress.currentModule,
    current_files: progress.currentFiles,
    processed_files: progress.processedFiles,
    eta_seconds: progress.etaSeconds,
    started_at: progress.startedAt,
    updated_at: progress.updatedAt,
  };
}

function mapAnalysisProgressRow(row: AnalysisProgressRow): AnalysisProgress {
  return {
    phase: row.phase,
    percent: row.percent,
    totalCommits: row.total_commits,
    sampledCommits: row.sampled_commits,
    completedSnapshots: row.completed_snapshots,
    currentCommit: row.current_commit,
    currentModule: row.current_module,
    currentFiles: row.current_files,
    processedFiles: row.processed_files,
    etaSeconds: row.eta_seconds,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}

function mapSnapshotSummaryRow(row: SnapshotRow): SnapshotSummary {
  return {
    seq: row.seq,
    commit: row.commit_hash,
    ts: row.ts,
  };
}

function mapMetricPointRow(row: MetricPointRow): MetricPoint {
  return {
    analysisId: row.analysis_id,
    ts: row.ts,
    commit: row.commit_hash,
    moduleKey: row.module_key,
    moduleName: row.module_name,
    moduleKind: row.module_kind,
    loc: row.loc,
    added: row.added,
    deleted: row.deleted,
    churn: row.churn,
  };
}

function mapAnalysisModuleRow(row: AnalysisModuleRow): AnalysisModuleSummary {
  return {
    key: row.module_key,
    name: row.module_name,
    kind: row.module_kind,
  };
}

function mapMetricValueRow(row: MetricValueRow) {
  return {
    moduleKey: row.module_key,
    moduleName: row.module_name,
    moduleKind: row.module_kind,
    value: row.value,
  };
}

function toSnapshotKey(ts: string, commit: string) {
  return `${ts}\u0000${commit}`;
}

type RepositoryRow = {
  id: string;
  name: string;
  source_type: RepositoryTarget["sourceType"];
  local_path: string | null;
  remote_url: string | null;
  default_branch: string | null;
  detected_kinds: string;
  status: RepositoryTarget["status"];
  created_at: string;
};

type AnalysisJobRow = {
  id: string;
  repository_id: string;
  branch: string;
  sampling: AnalysisJob["sampling"];
  status: AnalysisJob["status"];
  created_at: string;
  finished_at: string | null;
  error_message: string | null;
};

type AnalysisProgressRow = {
  analysis_id: string;
  phase: AnalysisProgress["phase"];
  percent: number;
  total_commits: number;
  sampled_commits: number;
  completed_snapshots: number;
  current_commit: string | null;
  current_module: string | null;
  current_files: number | null;
  processed_files: number | null;
  eta_seconds: number | null;
  started_at: string;
  updated_at: string;
};

type AnalysisSummaryRow = AnalysisJobRow &
  Partial<AnalysisProgressRow> & {
    snapshot_count: number;
    latest_snapshot_seq: number | null;
  };

type SnapshotRow = {
  seq: number;
  commit_hash: string;
  ts: string;
};

type MetricPointRow = {
  analysis_id: string;
  ts: string;
  commit_hash: string;
  module_key: string;
  module_name: string;
  module_kind: string;
  loc: number;
  added: number;
  deleted: number;
  churn: number;
};

type AnalysisModuleRow = {
  module_key: string;
  module_name: string;
  module_kind: string;
};

type SeriesRow = {
  snapshot_seq: number;
  module_key: string;
  module_name: string;
  module_kind: string;
  loc: number;
  added: number;
  deleted: number;
  churn: number;
};

type MetricValueRow = {
  module_key: string;
  module_name: string;
  module_kind: string;
  value: number;
};
