export function projectBrand(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    owner_id: row.owner_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function projectSubscription(row) {
  if (!row) return null;
  const plan = Array.isArray(row.plans) ? row.plans[0] : row.plans;
  return {
    brand_id: row.brand_id,
    status: row.status,
    current_period_start: row.current_period_start,
    current_period_end: row.current_period_end,
    quota_override: row.quota_override,
    plan: plan ? {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      monthly_quota: plan.monthly_quota,
      is_active: plan.is_active,
      runway_mcp_generation: plan.features?.runway_mcp_generation === true,
    } : null,
  };
}

export function isEligibleRunwaySubscription(subscription, capturedAt) {
  if (!subscription?.plan) return false;
  const nowMs = capturedAt.getTime();
  const periodStart = Date.parse(subscription.current_period_start || '');
  const periodEnd = Date.parse(subscription.current_period_end || '');
  return ['trialing', 'active'].includes(subscription.status)
    && Number.isFinite(periodStart)
    && Number.isFinite(periodEnd)
    && periodStart <= nowMs
    && periodEnd > nowMs
    && subscription.plan.is_active === true
    && subscription.plan.runway_mcp_generation === true;
}

export function projectRemoteSecretInspection({ projectRef, status, stdout = '', stderr = '' }) {
  if (!projectRef) {
    return {
      ok: false,
      names: [],
      check: { error: 'missing project ref' },
      blocker: remoteSecretInspectionBlocker('Supabase project ref could not be resolved.'),
    };
  }

  if (status !== 0) {
    return {
      ok: false,
      names: [],
      check: {
        status,
        stderr: redact(stderr).slice(0, 1000),
        stdout: redact(stdout).slice(0, 1000),
      },
      blocker: remoteSecretInspectionBlocker('Supabase CLI secrets list failed before secret presence could be verified.'),
    };
  }

  try {
    const parsed = JSON.parse(stdout);
    const rows = Array.isArray(parsed) ? parsed : parsed?.secrets;
    if (!Array.isArray(rows)) {
      return {
        ok: false,
        names: [],
        check: { error: 'unexpected JSON shape', stdout: redact(stdout).slice(0, 1000) },
        blocker: remoteSecretInspectionBlocker('Supabase CLI secrets list returned JSON in an unexpected shape.'),
      };
    }

    const names = rows
      .map((secret) => secret?.name)
      .filter((name) => typeof name === 'string');

    return {
      ok: true,
      names,
      check: { count: names.length },
      blocker: null,
    };
  } catch (error) {
    return {
      ok: false,
      names: [],
      check: {
        error: error.message,
        stdout: redact(stdout).slice(0, 1000),
      },
      blocker: remoteSecretInspectionBlocker('Supabase CLI secrets list output could not be parsed as JSON.'),
    };
  }
}

export function requiredSecretPresence(names, requiredNames) {
  const nameSet = new Set(names);
  return Object.fromEntries(requiredNames.map((name) => [name, nameSet.has(name)]));
}

export function dbReadbackBlocker(table, error) {
  if (!error) return null;
  const message = error.message || String(error);
  return {
    code: 'production_runway_db_readback_failed',
    message: `Supabase production ${table} readback failed, so readiness cannot classify product state for that resource: ${message}`,
    next_action: 'Fix Supabase production DB readback access or query errors, then rerun npm run verify:runway-readiness before changing product-state blockers.',
  };
}

export function dateStamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function remoteSecretInspectionBlocker(message) {
  return {
    code: 'production_runway_mcp_secret_inspection_failed',
    message,
    next_action: 'Fix Supabase project ref/CLI JSON secret inspection, then rerun npm run verify:runway-readiness before classifying bridge secret presence.',
  };
}

export function redactObject(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, redactObject(entryValue)]),
    );
  }
  return value;
}

export function redact(value) {
  return String(value)
    .replaceAll(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[redacted-jwt]')
    .replaceAll(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [redacted]')
    .replaceAll(/access_token["=:]\s*["']?[^"',\s}]+/gi, 'access_token=[redacted]')
    .replaceAll(/refresh_token["=:]\s*["']?[^"',\s}]+/gi, 'refresh_token=[redacted]')
    .replaceAll(/RUNWAY_MCP_BRIDGE_TOKEN["=:]\s*["']?[^"',\s}]+/gi, 'RUNWAY_MCP_BRIDGE_TOKEN=[redacted]')
    .replaceAll(/RUNWAY_MCP_BRIDGE_URL["=:]\s*["']?[^"',\s}]+/gi, 'RUNWAY_MCP_BRIDGE_URL=[redacted]');
}
