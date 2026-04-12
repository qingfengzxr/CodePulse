import type { ModuleUnit, RepositoryKind } from "@code-dance/domain";
import { detectGoModules } from "@code-dance/git";

export type ModuleProviderContext = {
  localPath: string;
  detectedKinds: RepositoryKind[];
};

export interface ModuleProvider {
  kind: string;
  supports(ctx: ModuleProviderContext): boolean;
  detect(ctx: ModuleProviderContext): Promise<ModuleUnit[]>;
}

export class GoWorkspaceProvider implements ModuleProvider {
  kind = "go-workspace";

  supports(ctx: ModuleProviderContext): boolean {
    return ctx.detectedKinds.includes("go");
  }

  async detect(ctx: ModuleProviderContext): Promise<ModuleUnit[]> {
    return detectGoModules(ctx.localPath);
  }
}
