import { z } from "zod";

export const moduleRuleSchema = z.object({
  name: z.string().min(1),
  include: z.array(z.string()).default([]),
  excludeFromLoc: z.boolean().default(false),
});

export const analysisConfigSchema = z.object({
  repository: z.object({
    branch: z.string().default("main"),
    sampling: z.enum(["daily", "weekly", "monthly", "tag-based", "per-commit"]).default("weekly"),
  }),
  modules: z.array(moduleRuleSchema).default([]),
});

export type AnalysisConfig = z.infer<typeof analysisConfigSchema>;
export type ModuleRule = z.infer<typeof moduleRuleSchema>;
