const RETIREMENT_MESSAGE =
  'Zeabur safe readback is retired: this compatibility entrypoint is permanently fail-closed and performs no external reads.';

console.error(RETIREMENT_MESSAGE);
process.exit(2);

/*
 * HISTORICAL SOURCE — inert and retained for audit/rollback review only.
 * The retired helper sanitized service, deployment, and domain metadata while
 * deliberately excluding variable and secret values. It must not be executed
 * or treated as current deployment evidence.
 */
