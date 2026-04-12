import type { AnalysisSamplingDto } from "@code-dance/contracts";

import { formatSamplingLabel } from "./display";

export const samplingOptions = ["weekly", "daily", "per-commit"] as AnalysisSamplingDto[];

export function getSamplingLabel(sampling: AnalysisSamplingDto) {
  return formatSamplingLabel(sampling);
}
