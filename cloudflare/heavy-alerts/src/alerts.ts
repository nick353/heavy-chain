/** Decides whether the last window of image AI requests needs an email. Pure, so it is unit tested. */
export type AlertCounts = {
  failedLastHour: number;
  failedLastWindow: number;
  newlyStuck: number;
  recentErrors: Array<{ action: string; errorCode: string | null; createdAt: string }>;
};

export const FAILED_PER_HOUR_THRESHOLD = 3;
export const STUCK_AFTER_MINUTES = 20;
export const WINDOW_MINUTES = 15;

export const shouldAlert = (counts: AlertCounts): boolean => (
  // Repeats at most once per window while failures keep arriving; silent once they stop.
  (counts.failedLastHour >= FAILED_PER_HOUR_THRESHOLD && counts.failedLastWindow > 0) || counts.newlyStuck > 0
);

export const windowBounds = (now: Date) => {
  const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  return {
    hourAgo: iso(60),
    windowStart: iso(WINDOW_MINUTES),
    stuckFrom: iso(STUCK_AFTER_MINUTES + WINDOW_MINUTES),
    stuckTo: iso(STUCK_AFTER_MINUTES),
  };
};

export const alertBody = (counts: AlertCounts, now: Date): { subject: string; text: string } => {
  const parts: string[] = [];
  if (counts.failedLastHour >= FAILED_PER_HOUR_THRESHOLD) parts.push(`失敗 ${counts.failedLastHour}件/1時間`);
  if (counts.newlyStuck > 0) parts.push(`${STUCK_AFTER_MINUTES}分以上止まっている生成 ${counts.newlyStuck}件`);
  const lines = [
    `Heavy Chain の画像生成で問題が起きています（${now.toISOString()} 時点）。`,
    '',
    `・直近1時間の失敗: ${counts.failedLastHour}件（うち直近${WINDOW_MINUTES}分: ${counts.failedLastWindow}件）`,
    `・${STUCK_AFTER_MINUTES}分以上「生成中」のまま: ${counts.newlyStuck}件`,
    '',
    '最近の失敗:',
    ...(counts.recentErrors.length
      ? counts.recentErrors.map((row) => `  ${row.createdAt}  ${row.action}  ${row.errorCode ?? '(コードなし)'}`)
      : ['  なし']),
    '',
    `この通知は${WINDOW_MINUTES}分ごとに確認し、問題が続く間だけ送られます。`,
  ];
  return { subject: `[Heavy Chain] ${parts.join(' / ')}`, text: lines.join('\n') };
};

/** Minimal RFC 5322 message; UTF-8 subject and body. */
export const mimeMessage = (from: string, to: string, subject: string, text: string, now: Date): string => {
  const encodedSubject = `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject)))}?=`;
  const body = btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/.{76}/g, '$&\r\n');
  return [
    `From: Heavy Chain Alerts <${from}>`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
};

/** New feedback is mailed once per aligned 15-minute window, so each submission lands in exactly one email even if the cron fires late. */
export type FeedbackRow = { created_at: string; email: string; pathname: string; message: string;
  screenshot_path: string | null; audio_path: string | null };

export const feedbackWindow = (now: Date) => {
  const step = WINDOW_MINUTES * 60_000;
  const end = Math.floor(now.getTime() / step) * step;
  return { start: new Date(end - step).toISOString(), end: new Date(end).toISOString() };
};

const jst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');

export const feedbackBody = (rows: FeedbackRow[], adminUrl: string): { subject: string; text: string } => ({
  subject: `[Heavy Chain] フィードバックが${rows.length}件届きました`,
  text: [
    `新しいフィードバックが${rows.length}件あります。スクショと音声は管理画面で確認できます。`,
    adminUrl,
    '',
    ...rows.flatMap((row, index) => [
      `■ ${index + 1}. ${jst(row.created_at)}（日本時間）  ${row.email}`,
      `  画面: ${row.pathname}`,
      `  添付: ${[row.screenshot_path ? 'スクショ' : '', row.audio_path ? '音声メモ' : ''].filter(Boolean).join('・') || 'なし'}`,
      ...row.message.slice(0, 600).split('\n').map((line) => `  ${line}`),
      ...(row.message.length > 600 ? ['  …（続きは管理画面で）'] : []),
      '',
    ]),
  ].join('\n'),
});
