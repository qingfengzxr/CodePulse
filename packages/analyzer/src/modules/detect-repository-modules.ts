import type { ModuleUnit } from "@code-dance/domain";

import {
  GoWorkspaceProvider,
} from "./providers/go-provider.js";
import {
  RustWorkspaceProvider,
  type ModuleProvider,
  type ModuleProviderContext,
} from "./providers/rust-provider.js";
import { NodeWorkspaceProvider } from "./providers/node-provider.js";

export type { ModuleProvider, ModuleProviderContext } from "./providers/rust-provider.js";

export async function detectRepositoryModules(ctx: ModuleProviderContext): Promise<ModuleUnit[]> {
  const providers: ModuleProvider[] = [
    new RustWorkspaceProvider(),
    new NodeWorkspaceProvider(),
    new GoWorkspaceProvider(),
  ];
  const modules: ModuleUnit[] = [];

  for (const provider of providers) {
    if (!provider.supports(ctx)) {
      continue;
    }

    modules.push(...(await provider.detect(ctx)));
  }

  return modules.sort((left, right) => left.key.localeCompare(right.key));
}
