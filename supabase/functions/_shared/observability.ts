import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { UsageReservation } from './usage.ts';

type RpcClient = SupabaseClient<any>;
type EdgeRunStatus = 'started' | 'succeeded' | 'failed';

export function requestIdFrom(req: Request) {
  return req.headers.get('x-request-id') || crypto.randomUUID();
}

export function durationSince(startedAt: number) {
  return Math.max(Date.now() - startedAt, 0);
}

export async function recordEdgeFunctionRun(
  supabase: RpcClient,
  params: {
    reservation?: UsageReservation | null;
    brandId?: string | null;
    userId?: string | null;
    functionName: string;
    status: EdgeRunStatus;
    requestId?: string | null;
    durationMs?: number | null;
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const { data, error } = await supabase.rpc('service_record_edge_function_run', {
    p_usage_event_id: params.reservation?.usageEventId ?? null,
    p_brand_id: params.brandId ?? null,
    p_user_id: params.userId ?? null,
    p_function_name: params.functionName,
    p_status: params.status,
    p_request_id: params.requestId ?? null,
    p_duration_ms: params.durationMs ?? null,
    p_error_message: params.errorMessage ?? null,
    p_metadata: params.metadata ?? {},
  });

  if (error) {
    console.log('Edge run observability warning:', error.message);
    return null;
  }

  return data as string | null;
}

export function sanitizeError(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed';
}
