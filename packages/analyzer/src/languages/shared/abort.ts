export class AnalysisAbortedError extends Error {
  constructor(message = "analysis aborted") {
    super(message);
    this.name = "AnalysisAbortedError";
  }
}

export function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new AnalysisAbortedError();
  }
}
