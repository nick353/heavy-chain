import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type UsageStatus = 'succeeded' | 'failed' | 'released';

export type UsageReservation = {
  usageEventId: string;
  monthlyQuota: number;
  usedUnits: number;
  remainingUnits: number;
};

type RpcClient = SupabaseClient<any>;

export async function reserveBrandUsage(
  supabase: RpcClient,
  params: {
    brandId: string;
    userId: string;
    functionName: string;
    units?: number;
    requestId?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<UsageReservation> {
  const { data, error } = await supabase.rpc('service_reserve_brand_usage', {
    p_brand_id: params.brandId,
    p_user_id: params.userId,
    p_function_name: params.functionName,
    p_units: params.units ?? 1,
    p_idempotency_key: params.idempotencyKey ?? null,
    p_request_id: params.requestId ?? null,
    p_metadata: params.metadata ?? {},
  });

  if (error) {
    throw new Error(error.message || 'Usage quota reservation failed');
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.usage_event_id) {
    throw new Error('Usage quota reservation returned no event');
  }

  return {
    usageEventId: row.usage_event_id,
    monthlyQuota: Number(row.monthly_quota ?? 0),
    usedUnits: Number(row.used_units ?? 0),
    remainingUnits: Number(row.remaining_units ?? 0),
  };
}

export async function completeBrandUsage(
  supabase: RpcClient,
  reservation: UsageReservation | null,
  status: UsageStatus,
  metadata: Record<string, unknown> = {},
) {
  if (!reservation) return;

  const { error } = await supabase.rpc('service_complete_usage_event', {
    p_usage_event_id: reservation.usageEventId,
    p_status: status,
    p_metadata: metadata,
  });

  if (error) {
    console.log('Usage completion warning:', error.message);
  }
}

export async function getBrandUsageSummary(supabase: RpcClient, brandId: string) {
  const { data, error } = await supabase.rpc('service_get_brand_usage_summary', {
    p_brand_id: brandId,
  });

  if (error) {
    throw new Error(error.message || 'Usage summary unavailable');
  }

  return Array.isArray(data) ? data[0] : data;
}
