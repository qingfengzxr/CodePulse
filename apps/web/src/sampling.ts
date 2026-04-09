import type { AnalysisSamplingDto } from "@code-dance/contracts";

export const samplingOptions = ["weekly", "daily", "per-commit"] as AnalysisSamplingDto[];

export function getSamplingLabel(sampling: AnalysisSamplingDto) {
  switch (sampling) {
    case "daily":
      return "Daily";
    case "per-commit":
      return "Per Commit";
    case "monthly":
      return "Monthly";
    case "tag-based":
      return "Tag Based";
    case "weekly":
    default:
      return "Weekly";
  }
}
