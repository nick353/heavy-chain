export type MailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

type EmailEnv = {
  EMAIL?: SendEmail;
};

function acceptedMessageId(receipt: unknown): string | null {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  const messageId = (receipt as { messageId?: unknown }).messageId;
  return typeof messageId === 'string' && messageId.trim() ? messageId.trim() : null;
}

/** Send one message through the native Cloudflare Email Service binding. */
export async function sendEmail(env: EmailEnv, message: MailMessage): Promise<{ messageId: string }> {
  if (typeof env.EMAIL?.send !== 'function') throw new Error('email_not_configured');
  const receipt = await env.EMAIL.send({
    to: message.to,
    from: message.from,
    subject: message.subject,
    text: message.text,
  });
  const messageId = acceptedMessageId(receipt);
  if (!messageId) throw new Error('email_acceptance_unconfirmed');
  return { messageId };
}
