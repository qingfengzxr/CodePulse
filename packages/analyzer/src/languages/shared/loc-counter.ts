import { readTextFileAtRevision } from "@code-dance/git";

type ModuleWithFiles = {
  key: string;
  files: string[];
};

export type CountModuleLocAtRevisionInput = {
  localPath: string;
  revision: string;
  modules: ModuleWithFiles[];
  concurrency?: number;
  onFileProcessed?: (context: {
    moduleKey: string;
    filePath: string;
    loc: number;
  }) => void | Promise<void>;
};

export async function countModuleLocAtRevision(
  input: CountModuleLocAtRevisionInput,
): Promise<Map<string, number>> {
  const locByModule = new Map<string, number>();
  const tasks = input.modules.flatMap((module) =>
    module.files.map((filePath) => async () => {
      const loc = await countFileLocAtRevision(input.localPath, input.revision, filePath);

      locByModule.set(module.key, (locByModule.get(module.key) ?? 0) + loc);

      await input.onFileProcessed?.({
        moduleKey: module.key,
        filePath,
        loc,
      });
    }),
  );

  await runWithConcurrency(tasks, normalizeConcurrency(input.concurrency));

  return locByModule;
}

async function countFileLocAtRevision(
  localPath: string,
  revision: string,
  filePath: string,
): Promise<number> {
  const content = await readTextFileAtRevision(localPath, revision, filePath);
  if (content === null || isBinaryText(content)) {
    return 0;
  }

  return content.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function isBinaryText(content: string): boolean {
  return content.includes("\u0000");
}

function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined) {
    return 6;
  }

  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

async function runWithConcurrency(tasks: Array<() => Promise<void>>, concurrency: number) {
  if (tasks.length === 0) {
    return;
  }

  let nextIndex = 0;

  const workers = Array.from(
    {
      length: Math.min(concurrency, tasks.length),
    },
    async () => {
      while (nextIndex < tasks.length) {
        const taskIndex = nextIndex;
        nextIndex += 1;
        await tasks[taskIndex]?.();
      }
    },
  );

  await Promise.all(workers);
}
