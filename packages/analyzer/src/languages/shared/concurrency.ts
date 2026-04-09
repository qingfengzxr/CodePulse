export async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  concurrency: number,
) {
  if (tasks.length === 0) {
    return;
  }

  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const taskIndex = nextIndex;
      nextIndex += 1;
      await tasks[taskIndex]?.();
    }
  });

  await Promise.all(workers);
}
