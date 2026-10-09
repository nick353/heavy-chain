import { EmailMessage } from 'cloudflare:email';
import { alertBody, feedbackBody, feedbackWindow, mimeMessage, shouldAlert, windowBounds, type AlertCounts, type FeedbackRow } from './alerts';
import { backupDatabase, pruneBackups } from './backup';

export const BACKUP_CRON = '0 18 * * *'; // 03:00 JST

interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
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

const ADMIN_FEEDBACK_URL = 'https://heavychain.app/admin?tab=feedback';
/** Read-only: feedback created in the last aligned window. */
const readFeedback = async (db: D1Database, now: Date): Promise<FeedbackRow[]> => {
  const w = feedbackWindow(now);
  const result = await db.prepare(`SELECT created_at, email, pathname, message, screenshot_path, audio_path FROM feedback_submissions
    WHERE created_at >= ? AND created_at < ? ORDER BY created_at LIMIT 50`).bind(w.start, w.end).all<FeedbackRow>();
  return result.results;
};

const send = async (env: Env, subject: string, text: string, now: Date) => {
  await env.ALERT_EMAIL.send(new EmailMessage(env.ALERT_FROM, env.ALERT_TO, mimeMessage(env.ALERT_FROM, env.ALERT_TO, subject, text, now)));
};

export default {
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    const now = new Date();
    if (event.cron === BACKUP_CRON) {
      try {
        await backupDatabase(env.DB, env.BACKUPS, now);
        await pruneBackups(env.BACKUPS, now);
      } catch (error) {
        await send(env, '[Heavy Chain] データベースのバックアップに失敗しました',
          `毎日のデータベースのバックアップ（${now.toISOString()}）が失敗しました。\n\n${String(error).slice(0, 500)}`, now);
      }
      return;
    }
    const feedback = await readFeedback(env.DB, now);
    if (feedback.length) {
      const mail = feedbackBody(feedback, ADMIN_FEEDBACK_URL);
      await send(env, mail.subject, mail.text, now);
    }
    const counts = await readCounts(env.DB, now);
    if (!shouldAlert(counts)) return;
    const { subject, text } = alertBody(counts, now);
    await send(env, subject, text, now);
  },
  // With the secret token: POST /test sends one test email, POST /backup runs the daily backup now. Nothing else is exposed.
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || !['/test', '/backup'].includes(url.pathname) || !env.ALERT_TEST_TOKEN
      || request.headers.get('authorization') !== `Bearer ${env.ALERT_TEST_TOKEN}`) {
      return new Response('Not found', { status: 404 });
    }
    const now = new Date();
    if (url.pathname === '/backup') return Response.json({ backup: await backupDatabase(env.DB, env.BACKUPS, now) });
    const counts = await readCounts(env.DB, now);
    const { text } = alertBody(counts, now);
    await send(env, '[Heavy Chain] 失敗通知のテスト', `これは失敗通知のテストメールです。\n\n${text}`, now);
    return Response.json({ sent: true, counts });
  },
} satisfies ExportedHandler<Env>;
