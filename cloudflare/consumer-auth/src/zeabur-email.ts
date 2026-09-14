/**
 * Historical compatibility surface only. The active auth path uses the native
 * Cloudflare Email Service binding from `src/email.ts`; this stub deliberately
 * has no transport, credentials, fallback or network behavior.
 */
export type MailMessage = { from: string; to: string; subject: string; text: string };

/** @deprecated Retained only so old imports fail closed instead of sending. */
export async function sendZeaburEmail(_env: unknown, _message: MailMessage): Promise<never> {
  throw new Error('legacy_email_transport_retired');
}
