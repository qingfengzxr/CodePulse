import type { ModuleUnit, RepositoryKind } from "@code-dance/domain";
import { detectRustModules } from "@code-dance/git";

export type ModuleProviderContext = {
  localPath: string;
  detectedKinds: RepositoryKind[];
};

export interface ModuleProvider {
  kind: string;
  supports(ctx: ModuleProviderContext): boolean;
  detect(ctx: ModuleProviderContext): Promise<ModuleUnit[]>;
}

export class RustWorkspaceProvider implements ModuleProvider {
  kind = "rust-workspace";

  supports(ctx: ModuleProviderContext): boolean {
    return ctx.detectedKinds.includes("rust");
  }

  async detect(ctx: ModuleProviderContext): Promise<ModuleUnit[]> {
    return detectRustModules(ctx.localPath);
  }
}
