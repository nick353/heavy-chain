/** True when the image API refused admission because too many jobs are running (nothing was created). */
export const isImageAdmissionLimitError = (error: unknown) => (
  error instanceof Error && /429.*concurrency|image_quota_or_concurrency_limit/.test(error.message)
);

/**
 * Runs tasks with a small concurrency cap, retrying a task that the server refused at admission.
 * The image API admits only a few running jobs per user, so firing every request at once loses the extras.
 */
export async function runAdmissionLimitedTasks<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  options: {
    concurrency?: number;
    retries?: number;
    retryDelayMs?: (attempt: number) => number;
    isRetryable?: (error: unknown) => boolean;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<PromiseSettledResult<T>[]> {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const retries = Math.max(0, options.retries ?? 4);
  const retryDelayMs = options.retryDelayMs ?? ((attempt) => 2000 * 2 ** attempt);
  const isRetryable = options.isRetryable ?? isImageAdmissionLimitError;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      for (let attempt = 0; ; attempt++) {
        try {
          results[index] = { status: 'fulfilled', value: await tasks[index]() };
          break;
        } catch (error) {
          if (attempt >= retries || !isRetryable(error)) {
            results[index] = { status: 'rejected', reason: error };
            break;
          }
          await sleep(retryDelayMs(attempt));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}
