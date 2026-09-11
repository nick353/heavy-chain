/** Shared browser/Worker contract; no SDK, DOM, secret or network dependency. */
export const PROTECTED_IMAGE_EDIT_MODE = 'reference-guide-protected-composite-v1' as const;
export type ProtectedImageEditPlan = {
  mode: typeof PROTECTED_IMAGE_EDIT_MODE;
  sourceWidth: number;
  sourceHeight: number;
  sourceSha256: string;
  maskSha256: string;
  guideIndex: number;
  coveragePercent: number;
};

export async function protectedImageDigest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
}

/** One deterministic workspace save per actual provider candidate. */
export async function protectedImageSaveRequestId(requestId: string,candidateIndex: number): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
      !Number.isSafeInteger(candidateIndex) || candidateIndex < 0 || candidateIndex > 3) throw new Error('protected_image_save_identity_invalid');
  const hex = (await protectedImageDigest(`${PROTECTED_IMAGE_EDIT_MODE}:${requestId.toLowerCase()}:${candidateIndex}`)).slice(0,32).split('');
  hex[12] = '4'; hex[16] = ((parseInt(hex[16],16) & 3) | 8).toString(16);
  const value = hex.join(''); return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}
