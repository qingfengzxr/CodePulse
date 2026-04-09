import { analyzeNodeHistory } from "./languages/node/index.js";
import { analyzeRustHistory } from "./languages/rust/index.js";
import type {
  AnalyzeRepositoryHistoryInput,
  AnalyzeRepositoryHistoryOutput,
} from "./languages/shared/types.js";
import type { MetricPoint, ModuleCandlePoint, Snapshot } from "@code-dance/domain";

export type {
  AnalyzeRepositoryHistoryInput,
  AnalyzeRepositoryHistoryOutput,
} from "./languages/shared/types.js";

export async function analyzeRepositoryHistory(
  input: AnalyzeRepositoryHistoryInput,
): Promise<AnalyzeRepositoryHistoryOutput> {
  const analyzers: Array<{
    name: string;
    run: (input: AnalyzeRepositoryHistoryInput) => Promise<AnalyzeRepositoryHistoryOutput>;
  }> = [];

  if (input.detectedKinds.includes("rust")) {
    analyzers.push({
      name: "rust",
      run: input.__testOverrides?.rust ?? analyzeRustHistory,
    });
  }

  if (input.detectedKinds.includes("node")) {
    analyzers.push({
      name: "node",
      run: input.__testOverrides?.node ?? analyzeNodeHistory,
    });
  }

  if (analyzers.length === 0) {
    throw new Error(
      `repository kinds are not supported for analysis: ${input.detectedKinds.join(", ")}`,
    );
  }

  const results: Array<{ name: string; output: AnalyzeRepositoryHistoryOutput }> = [];

  for (const analyzer of analyzers) {
    results.push({
      name: analyzer.name,
      output: await analyzer.run(input),
    });
  }

  return mergeAnalyzerResults(results);
}

function mergeAnalyzerResults(
  results: Array<{ name: string; output: AnalyzeRepositoryHistoryOutput }>,
): AnalyzeRepositoryHistoryOutput {
  const [firstResult, ...restResults] = results;
  if (!firstResult) {
    return {
      snapshots: [],
      points: [],
      candles: [],
    };
  }

  const baselineSnapshots = firstResult.output.snapshots;

  for (const result of restResults) {
    assertMatchingSnapshots(
      baselineSnapshots,
      result.output.snapshots,
      firstResult.name,
      result.name,
    );
  }

  return {
    snapshots: baselineSnapshots,
    points: results.flatMap((result) => result.output.points).sort(compareMetricPoints),
    candles: results.flatMap((result) => result.output.candles).sort(compareCandlePoints),
  };
}

function assertMatchingSnapshots(
  baseline: Snapshot[],
  candidate: Snapshot[],
  baselineAnalyzer: string,
  candidateAnalyzer: string,
) {
  if (baseline.length !== candidate.length) {
    throw new Error(
      `snapshot timeline mismatch between ${baselineAnalyzer} and ${candidateAnalyzer}: snapshot count differs`,
    );
  }

  for (let index = 0; index < baseline.length; index += 1) {
    const baselineSnapshot = baseline[index];
    const candidateSnapshot = candidate[index];

    if (
      !baselineSnapshot ||
      !candidateSnapshot ||
      baselineSnapshot.commit !== candidateSnapshot.commit ||
      baselineSnapshot.ts !== candidateSnapshot.ts
    ) {
      throw new Error(
        `snapshot timeline mismatch between ${baselineAnalyzer} and ${candidateAnalyzer} at index ${index}`,
      );
    }
  }
}

function compareMetricPoints(left: MetricPoint, right: MetricPoint) {
  const tsOrder = left.ts.localeCompare(right.ts);
  if (tsOrder !== 0) {
    return tsOrder;
  }

  return left.moduleKey.localeCompare(right.moduleKey);
}

function compareCandlePoints(left: ModuleCandlePoint, right: ModuleCandlePoint) {
  const tsOrder = left.ts.localeCompare(right.ts);
  if (tsOrder !== 0) {
    return tsOrder;
  }

  return left.moduleKey.localeCompare(right.moduleKey);
}
