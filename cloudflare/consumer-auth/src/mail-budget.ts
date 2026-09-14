/** Counters contain no user data and survive account deletion and UTC rollover. */
export interface MailBudgetEnv {
  AUTH_DB: D1Database;
  EMAIL_DAILY_ATTEMPT_LIMIT?: string;
  EMAIL_TOTAL_ATTEMPT_LIMIT?: string;
}

export class MailBudgetError extends Error {
  code: 'EMAIL_BUDGET_UNAVAILABLE' | 'EMAIL_BUDGET_EXHAUSTED';
  constructor(code: 'EMAIL_BUDGET_UNAVAILABLE' | 'EMAIL_BUDGET_EXHAUSTED') {
    super(code);
    this.code = code;
  }
}

function positiveLimit(value: string | undefined): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export function mailBudgetConfigured(env: MailBudgetEnv): boolean {
  return positiveLimit(env.EMAIL_DAILY_ATTEMPT_LIMIT) !== null
    && positiveLimit(env.EMAIL_TOTAL_ATTEMPT_LIMIT) !== null;
}

export async function reserveMailAttempt(env: MailBudgetEnv, now = Date.now()): Promise<void> {
  const daily = positiveLimit(env.EMAIL_DAILY_ATTEMPT_LIMIT);
  const total = positiveLimit(env.EMAIL_TOTAL_ATTEMPT_LIMIT);
  if (daily === null || total === null || !Number.isSafeInteger(now) || now < 0) {
    throw new MailBudgetError('EMAIL_BUDGET_UNAVAILABLE');
  }
  const day = Math.floor(now / 86_400_000);
  let admitted: { total_attempts: number } | null;
  try {
    // A single atomic statement; a missing row/schema or an unknown result must
    // never authorize a send. Clock rollback cannot reset or consume a new day.
    admitted = await env.AUTH_DB.prepare(`UPDATE auth_mail_budget SET
      day_attempts = CASE WHEN utc_day < ? THEN 1 ELSE day_attempts + 1 END,
      utc_day = ?, total_attempts = total_attempts + 1
      WHERE id = 1 AND utc_day <= ? AND total_attempts < ?
        AND (utc_day < ? OR day_attempts < ?)
      RETURNING total_attempts`).bind(day, day, day, total, day, daily)
      .first<{ total_attempts: number }>();
  } catch {
    throw new MailBudgetError('EMAIL_BUDGET_UNAVAILABLE');
  }
  if (!admitted) throw new MailBudgetError('EMAIL_BUDGET_EXHAUSTED');
  if (!Number.isSafeInteger(admitted.total_attempts) || admitted.total_attempts < 1) {
    throw new MailBudgetError('EMAIL_BUDGET_UNAVAILABLE');
  }
  // No refund, including provider rejection, timeout, unknown acceptance or crash.
}
