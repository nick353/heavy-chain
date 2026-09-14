import type { Env } from './index.ts';
import { requireBrandRole } from './core.ts';
import { PROTECTED_IMAGE_EDIT_MODE, protectedImageSaveRequestId } from '../../../src/lib/protectedImageEditContract.ts';
import type { WorkspaceExecutionStep, WorkspaceExecutionStatus } from '../../../src/lib/workspaceExecution.ts';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
type Candidate = {
  requested_job_id: string; requested_params: string; request_id: string; source_job_id: string;
  input_metadata: string; candidate_index: number; image_id: string; state: string;
  attempted_at: string | null; sha256: string | null; content_bytes: number | null;
};
type FinalSave = { id: string; status: string; input_params: string; has_image: number };
const record = (text: string): Record<string, any> => {
  try { const value = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
};
const response = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
});

/** Reads only D1 evidence. Never reconciles, re-infers, writes, or reads private R2 bytes. */
export async function readWorkspaceExecutionSteps(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand_id');
  const ids = url.searchParams.getAll('job_id');
  if (!brandId || !ID.test(brandId) || !ids.length || ids.length > 100 || ids.some(id => !ID.test(id))) {
    return response({ error: 'invalid_execution_scope' }, 400);
  }
  const owner = await requireBrandRole(request, env, brandId, 'viewer');
  if (owner instanceof Response) return owner;
  const candidates = (await env.DB.prepare(`
    SELECT g.id AS requested_job_id, g.input_params AS requested_params,
      r.request_id, r.job_id AS source_job_id, r.input_metadata,
      c.candidate_index, c.image_id, c.state, c.attempted_at, c.sha256, c.content_bytes
    FROM generation_jobs g
    JOIN heavy_ai_requests r ON r.user_id=g.user_id AND r.brand_id=g.brand_id AND
      (r.job_id=g.id OR r.request_id=CASE WHEN json_valid(g.input_params) THEN json_extract(g.input_params,'$.imageAI.requestId') END)
    JOIN heavy_ai_candidates c ON c.request_id=r.request_id AND
      (r.job_id=g.id OR c.candidate_index=CASE WHEN json_valid(g.input_params) THEN json_extract(g.input_params,'$.imageAI.candidateIndex') END)
    WHERE g.user_id=? AND g.brand_id=? AND g.id IN (SELECT value FROM json_each(?))
    ORDER BY g.id,c.candidate_index
  `).bind(owner, brandId, JSON.stringify([...new Set(ids)])).all<Candidate>()).results ?? [];

  // The existing final-save identity is deterministic; do not adopt a row just
  // because its user-supplied metadata mentions a request ID.
  const finalIds = new Map<string, string>();
  for (const candidate of candidates) {
    if (record(candidate.input_metadata).metadata?.protectedEdit?.mode !== PROTECTED_IMAGE_EDIT_MODE) continue;
    const key = `${candidate.request_id}:${candidate.candidate_index}`;
    if (!finalIds.has(key)) finalIds.set(key, `wa-${await protectedImageSaveRequestId(candidate.request_id, candidate.candidate_index)}`);
  }
  const finalSaves = finalIds.size ? (await env.DB.prepare(`
    SELECT g.id,g.status,g.input_params,
      EXISTS(SELECT 1 FROM generated_images i WHERE i.id=g.id AND i.job_id=g.id
        AND i.user_id=g.user_id AND i.brand_id=g.brand_id AND i.storage_path='generated-images/'||g.id) AS has_image
    FROM generation_jobs g WHERE g.user_id=? AND g.brand_id=? AND g.id IN (SELECT value FROM json_each(?))
  `).bind(owner, brandId, JSON.stringify([...finalIds.values()])).all<FinalSave>()).results ?? [] : [];
  const savesById = new Map(finalSaves.map(save => [save.id, save]));
  const steps: WorkspaceExecutionStep[] = [];
  for (const c of candidates) {
    const key = `${c.request_id}:${c.candidate_index}`;
    const finalId = finalIds.get(key);
    if (c.requested_job_id !== c.source_job_id) {
      const params = record(c.requested_params);
      if (c.requested_job_id !== finalId || params.sourceJobId !== c.source_job_id) continue;
    }
    const hasResult = typeof c.sha256 === 'string' && /^[a-f0-9]{64}$/.test(c.sha256) && Number(c.content_bytes) > 0;
    const inference: WorkspaceExecutionStatus = ['storing','completed'].includes(c.state) ? hasResult ? 'completed' : 'unknown'
      : c.state === 'planned' ? 'queued' : c.state === 'running' ? 'processing'
      : c.state === 'failed' ? c.attempted_at ? 'failed' : 'not_started' : 'unknown';
    const storage: WorkspaceExecutionStatus = c.state === 'completed' ? hasResult ? 'completed' : 'unknown'
      : c.state === 'storing' ? 'processing' : hasResult ? 'unknown' : 'not_started';
    const add = (phase: number, label: string, status: WorkspaceExecutionStatus, imageId: string | null) => steps.push({
      id: `${key}:${phase}`, job_id: c.requested_job_id, image_id: imageId,
      task_code: `候補${c.candidate_index + 1}・${label}`, step_index: c.candidate_index * 3 + phase,
      status, basis: 'cloudflare_execution_ledger',
    });
    add(0, 'AI処理', inference, c.image_id);
    add(1, finalId ? '中間保存' : 'private保存', storage, c.image_id);
    if (finalId) {
      const save = savesById.get(finalId);
      const params = save ? record(save.input_params) : {};
      const exact = save && params.sourceJobId === c.source_job_id && params.imageAI?.requestId === c.request_id && params.imageAI?.candidateIndex === c.candidate_index;
      const status: WorkspaceExecutionStatus = !save ? 'not_started' : !exact ? 'unknown'
        : save.status === 'completed' ? save.has_image ? 'completed' : 'unknown'
        : save.status === 'failed' ? 'failed' : 'processing';
      add(2, '最終合成保存', status, finalId);
    }
  }
  return response(steps);
}
