import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createServiceClient, createUserClient, requireBrandRole, requireUser } from '../_shared/auth.ts';
import { jsonResponse, readConnectionToken, runwayMcpListTools } from '../_shared/runwayMcpConnection.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse({ ok: true });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const userClient = createUserClient(req);
    const serviceClient = createServiceClient() as any;
    const user = await requireUser(userClient);
    const body = await req.json().catch(() => ({}));
    const brandId = typeof body.brandId === 'string' ? body.brandId : '';
    const verifyTools = body.verifyTools === true;
    if (!brandId) return jsonResponse({ error: 'brand_id_required' }, 400);

    const membership = await requireBrandRole(userClient, brandId, user.id, 'editor');
    const canViewConnectionDetails = ['admin', 'owner'].includes(membership.role);
    if (verifyTools && !canViewConnectionDetails) {
      return jsonResponse({ error: 'insufficient_brand_permissions' }, 403);
    }

    const { data: connection, error } = await serviceClient
      .from('runway_mcp_oauth_connections')
      .select('brand_id, status, connected_by, scope, token_type, expires_at, last_verified_at, last_error, updated_at')
      .eq('brand_id', brandId)
      .maybeSingle();
    if (error) throw error;

    let tools: unknown[] = [];
    let verificationError: string | null = null;
    if (connection?.status === 'connected' && verifyTools) {
      try {
        const token = await readConnectionToken(serviceClient, brandId);
        tools = await runwayMcpListTools(token);
        await serviceClient
          .from('runway_mcp_oauth_connections')
          .update({ last_verified_at: new Date().toISOString(), last_error: null })
          .eq('brand_id', brandId);
      } catch (verifyError) {
        verificationError = sanitizeError(verifyError);
        await serviceClient
          .from('runway_mcp_oauth_connections')
          .update({ status: 'reauthorization_required', last_error: verificationError, updated_at: new Date().toISOString() })
          .eq('brand_id', brandId);
      }
    }

    return jsonResponse({
      connected: connection?.status === 'connected' && !verificationError,
      connection: canViewConnectionDetails
        ? connection || null
        : connection
          ? {
              status: connection.status,
              updated_at: connection.updated_at,
            }
          : null,
      bridgeConfigured: Boolean(
        Deno.env.get('RUNWAY_MCP_BRIDGE_URL')?.trim()
        && Deno.env.get('RUNWAY_MCP_BRIDGE_TOKEN')?.trim()
      ),
      tools: tools.map(projectTool),
      verificationError: canViewConnectionDetails ? verificationError : null,
    });
  } catch (error) {
    return jsonResponse({ error: sanitizeError(error) }, 400);
  }
});

function projectTool(tool: unknown) {
  if (!tool || typeof tool !== 'object') return tool;
  const record = tool as Record<string, unknown>;
  return {
    name: typeof record.name === 'string' ? record.name : null,
    description: typeof record.description === 'string' ? record.description : null,
    inputSchema: record.inputSchema || null,
  };
}

function sanitizeError(error: unknown) {
  return String(error instanceof Error ? error.message : error || 'runway_mcp_status_failed')
    .replace(/access_token["=:]\s*["']?[^"',\s}]+/gi, 'access_token=[redacted]')
    .replace(/refresh_token["=:]\s*["']?[^"',\s}]+/gi, 'refresh_token=[redacted]')
    .slice(0, 400);
}
