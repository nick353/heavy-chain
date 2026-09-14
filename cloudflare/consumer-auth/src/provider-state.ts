export const PROVIDER_CHECK_INTERVAL = 24 * 60 * 60_000;

/** Non-reversible generation marker; credentials never enter the state table. */
export async function credentialFingerprint(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
