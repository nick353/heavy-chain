export type SettledComposition =
  | { ok: true; imageUrl: string }
  | { ok: false; error: Error };

export const settleComposition = (composition: Promise<string>): Promise<SettledComposition> => composition.then(
  (imageUrl) => ({ ok: true, imageUrl }),
  (reason) => ({
    ok: false,
    error: reason instanceof Error ? reason : new Error(String(reason || '生成に失敗しました')),
  }),
);

type DisplayImage = {
  src: string;
  complete: boolean;
  naturalWidth: number;
  decode?: () => Promise<void>;
  onload: (() => void) | null;
  onerror: (() => void) | null;
};

export async function waitForDisplayableImage(
  imageUrl: string,
  options: {
    timeoutMs?: number;
    createImage?: () => DisplayImage;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const image = options.createImage?.() ?? new Image();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('generated_image_decode_failed'));
    image.src = imageUrl;
    if (image.complete) {
      queueMicrotask(() => {
        if (image.naturalWidth > 0) resolve();
        else reject(new Error('generated_image_decode_failed'));
      });
    }
  });
  const decoded = typeof image.decode === 'function'
    ? image.decode().catch(() => loaded)
    : loaded;
  try {
    await Promise.race([
      decoded,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('generated_image_decode_timeout')), timeoutMs);
      }),
    ]);
    if (image.naturalWidth <= 0) throw new Error('generated_image_decode_failed');
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    image.onload = null;
    image.onerror = null;
  }
}
