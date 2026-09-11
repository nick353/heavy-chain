/** Read-only projection of persisted Cloudflare execution records, not input claims. */
export type WorkspaceExecutionStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'unknown' | 'not_started';

export interface WorkspaceExecutionStep {
  id: string;
  job_id: string;
  image_id: string | null;
  task_code: string;
  step_index: number;
  status: WorkspaceExecutionStatus;
  basis: 'cloudflare_execution_ledger';
}
