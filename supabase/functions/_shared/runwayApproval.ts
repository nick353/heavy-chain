import type { AppSupabaseClient } from './auth.ts';

export async function requireRunwayMcpConnectionApproval(
  supabase: AppSupabaseClient,
  brandId: string,
) {
  const { data, error } = await supabase
    .from('runway_mcp_connection_approvals')
    .select('status, approved_at')
    .eq('brand_id', brandId)
    .maybeSingle();

  if (error) {
    throw new Error('runway_mcp_connection_status_unavailable');
  }

  if (data?.status !== 'approved' || !data.approved_at) {
    throw new Error('runway_mcp_connection_not_approved');
  }
}
