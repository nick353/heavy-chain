import { EmailMessage } from 'cloudflare:email';
import { alertBody, mimeMessage, shouldAlert, windowBounds, type AlertCounts } from './alerts';

interface Env {
  DB: D1Database;
  ALERT_EMAIL: SendEmail;
  ALERT_FROM: string;
  ALERT_TO: string;
  ALERT_TEST_TOKEN?: string;
}

/** Read-only: counts image AI request failures in the production D1 database. */
const readCounts = async (db: D1Database, now: Date): Promise<AlertCounts> => {
  const b = windowBounds(now);
  const [hour, window, stuck, recent] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM heavy_ai_requests WHERE state = 'failed' AND updated_at >= ?").bind(b.hourAgo),
    db.prepare("SELECT COUNT(*) AS n FROM heavy_ai_requests WHERE state = 'failed' AND updated_at >= ?").bind(b.windowStart),
    db.prepare("SELECT COUNT(*) AS n FROM heavy_ai_requests WHERE state = 'running' AND created_at >= ? AND created_at < ?").bind(b.stuckFrom, b.stuckTo),
    db.prepare("SELECT action, error_code, updated_at FROM heavy_ai_requests WHERE state = 'failed' AND updated_at >= ? ORDER BY updated_at DESC LIMIT 5").bind(b.hourAgo),
  ]);
  const n = (result: D1Result) => Number((result.results[0] as { n?: number } | undefined)?.n ?? 0);
  return {
    failedLastHour: n(hour),
    failedLastWindow: n(window),
    newlyStuck: n(stuck),
    recentErrors: (recent.results as Array<{ action: string; error_code: string | null; updated_at: string }>)
      .map((row) => ({ action: row.action, errorCode: row.error_code, createdAt: row.updated_at })),
  };
};

const send = async (env: Env, subject: string, text: string, now: Date) => {
  await env.ALERT_EMAIL.send(new EmailMessage(env.ALERT_FROM, env.ALERT_TO, mimeMessage(env.ALERT_FROM, env.ALERT_TO, subject, text, now)));
};

export default {
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = new Date();
    const counts = await readCounts(env.DB, now);
    if (!shouldAlert(counts)) return;
    const { subject, text } = alertBody(counts, now);
    await send(env, subject, text, now);
  },
  // POST /test with the secret token sends one test email with the current counts; nothing else is exposed.
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/test' || !env.ALERT_TEST_TOKEN
      || request.headers.get('authorization') !== `Bearer ${env.ALERT_TEST_TOKEN}`) {
      return new Response('Not found', { status: 404 });
    }
    const now = new Date();
    const counts = await readCounts(env.DB, now);
    const { text } = alertBody(counts, now);
    await send(env, '[Heavy Chain] 失敗通知のテスト', `これは失敗通知のテストメールです。\n\n${text}`, now);
    return Response.json({ sent: true, counts });
  },
} satisfies ExportedHandler<Env>;
