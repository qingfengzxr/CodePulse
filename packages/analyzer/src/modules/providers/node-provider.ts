import type { ModuleUnit, RepositoryKind } from "@code-dance/domain";
import { detectNodeModules } from "@code-dance/git";

export type ModuleProviderContext = {
  localPath: string;
  detectedKinds: RepositoryKind[];
};

export interface ModuleProvider {
  kind: string;
  supports(ctx: ModuleProviderContext): boolean;
  detect(ctx: ModuleProviderContext): Promise<ModuleUnit[]>;
}

export class NodeWorkspaceProvider implements ModuleProvider {
  kind = "node-workspace";

  supports(ctx: ModuleProviderContext): boolean {
    return ctx.detectedKinds.includes("node");
  }

  async detect(ctx: ModuleProviderContext): Promise<ModuleUnit[]> {
    return detectNodeModules(ctx.localPath);
  }
}
