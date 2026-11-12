import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

/**
 * 「送る」で開いた画面の受け取り口。本家と同じく `<行き先>?imgUrl=<画像の住所>` で開かれる
 * （本家 34vt0w060bmsy.js: window.open(`${path}?${qs.stringify({ imgUrl })}`, '_blank')）。
 *
 * 読める住所は Heavy が配る画像だけ: heavychain.app（と同じ画面の住所）、API の署名つきの住所
 * （/v1/media/read?token=…）、画像の data: と同じ画面の blob:。外の任意の住所は受けない。
 */
export const INCOMING_IMAGE_PARAM = 'imgUrl';
/** 行き先の画面の入り口と同じ上限（20MB）。 */
export const INCOMING_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const INCOMING_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
/** 20MB の画像を base64 にした data: の長さ（約26.7MB）まで。 */
const MAX_RAW_LENGTH = 28 * 1024 * 1024;
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|webp|avif)(?:;[a-z0-9=._+-]+)*;base64,/i;
const HEAVY_HOST = 'heavychain.app';
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' };

export type IncomingImageUrlContext = {
  /** 今の画面の origin（window.location.origin）。 */
  origin: string;
  /** 画像を配る API の origin（VITE_CLOUDFLARE_API_BASE_URL・VITE_MEDIA_GATEWAY_URL）。 */
  apiOrigins?: readonly string[];
};

const httpsOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
};

/** 画像を配る API の origin（本番は heavy-chain-api.…workers.dev）。 */
export const incomingImageApiOrigins = (): string[] => {
  const env = (import.meta as { env?: Record<string, unknown> }).env ?? {};
  return [...new Set([env.VITE_CLOUDFLARE_API_BASE_URL, env.VITE_MEDIA_GATEWAY_URL].map(httpsOrigin).filter((value): value is string => Boolean(value)))];
};

const isHeavyHost = (hostname: string) => hostname === HEAVY_HOST || hostname.endsWith(`.${HEAVY_HOST}`);

/** 読んでよい住所なら URL を、ほかは null を返す。 */
export function parseIncomingImageUrl(raw: string | null | undefined, context: IncomingImageUrlContext): URL | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > MAX_RAW_LENGTH) return null;
  if (/^data:/i.test(value)) {
    if (!DATA_IMAGE.test(value)) return null;
    try { return new URL(value); } catch { return null; }
  }
  let url: URL;
  try { url = new URL(value, context.origin); } catch { return null; }
  if (url.username || url.password) return null;
  if (url.protocol === 'blob:') return url.origin === context.origin ? url : null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.origin === context.origin) return url;
  if (url.protocol === 'https:' && isHeavyHost(url.hostname)) return url;
  if (url.protocol === 'https:' && (context.apiOrigins ?? []).includes(url.origin)
    && url.pathname === '/v1/media/read' && Boolean(url.searchParams.get('token'))) return url;
  return null;
}

/** 受け取った画像のファイル名（同じ画面の画像ならその名前、ほかは「送られた画像」）。 */
export function incomingImageFileName(url: URL, type: string): string {
  const last = url.protocol === 'data:' || url.protocol === 'blob:' ? '' : decodeURIComponent(url.pathname.split('/').pop() ?? '');
  if (/^[\w.() -]{1,120}\.(?:png|jpe?g|webp|avif)$/i.test(last)) return last;
  return `送られた画像.${EXTENSIONS[type] ?? 'png'}`;
}

export type IncomingImageFetch = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'headers' | 'blob'>>;

/** 住所の画像を File にする。画像でない・20MB を超える・読めないときは投げる。 */
export async function fetchIncomingImageFile(url: URL, options: { fetchImpl?: IncomingImageFetch; maxBytes?: number; signal?: AbortSignal } = {}): Promise<File> {
  const maxBytes = options.maxBytes ?? INCOMING_IMAGE_MAX_BYTES;
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const response = await fetchImpl(url.href, { credentials: 'omit', cache: 'no-store', signal: options.signal });
  if (!response.ok) throw new Error('incoming_image_unavailable');
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('incoming_image_too_large');
  const blob = await response.blob();
  const type = (blob.type || response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!INCOMING_IMAGE_TYPES.includes(type)) throw new Error('incoming_image_type');
  if (blob.size === 0) throw new Error('incoming_image_empty');
  if (blob.size > maxBytes) throw new Error('incoming_image_too_large');
  return new File([blob], incomingImageFileName(url, type), { type });
}

/** 受け取った File を data: にする（data: で画像を持つ入り口へ渡すとき）。 */
export function incomingFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('incoming_image_read_failed')));
    reader.onerror = () => reject(reader.error ?? new Error('incoming_image_read_failed'));
    reader.readAsDataURL(file);
  });
}

/** `imgUrl` を消した search（`?…` か空）。 */
export function searchWithoutIncomingImage(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(INCOMING_IMAGE_PARAM);
  const next = params.toString();
  return next ? `?${next}` : '';
}

type TakenImage = { pathname: string; raw: string; file: Promise<File>; at: number };
/**
 * 受け取った画像は、画面の部品の外に1件だけ置く。ログインやブランドの読み込みで画面が作り直されても
 * （生地プリントなどは利用者の確定で作り直す）、同じ道の作り直した部品が引き継いで1回だけ渡す。
 */
let taken: TakenImage | null = null;
const ADOPT_MS = 2 * 60_000;

export type UseIncomingImageFileOptions = {
  /** 受け取り先の準備ができたら true（下書きの復元・ブランドの読み込みの後）。それまで渡さずに待つ。 */
  ready?: boolean;
};

/**
 * `?imgUrl=` で送られた画像を File にして、画面の既存の画像の入り口（onFile）へ1回だけ渡す。
 * 開いたらすぐ URL から imgUrl を消す（再読み込みや戻るで同じ画像をもう一度入れない）。渡すのは、
 * 消した URL に画面が切り替わり、ready になってから（下書きの復元が受け取った画像を上書きしないように）。
 */
export function useIncomingImageFile(onFile: (file: File) => unknown, options: UseIncomingImageFileOptions = {}): void {
  const { ready = true } = options;
  const location = useLocation();
  const navigate = useNavigate();
  const raw = new URLSearchParams(location.search).get(INCOMING_IMAGE_PARAM);
  const [entry, setEntry] = useState<TakenImage | null>(null);
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;

  useEffect(() => {
    if (raw === null) {
      if (taken && taken.pathname === location.pathname && Date.now() - taken.at < ADOPT_MS) setEntry(taken);
      return;
    }
    navigate({ pathname: location.pathname, search: searchWithoutIncomingImage(location.search), hash: location.hash }, { replace: true, state: location.state });
    if (taken && taken.raw === raw && taken.pathname === location.pathname) { setEntry(taken); return; }
    const url = typeof window === 'undefined' ? null : parseIncomingImageUrl(raw, { origin: window.location.origin, apiOrigins: incomingImageApiOrigins() });
    if (!url) {
      taken = null;
      toast.error('この住所の画像は読み込めません');
      return;
    }
    const next: TakenImage = { pathname: location.pathname, raw, file: fetchIncomingImageFile(url), at: Date.now() };
    next.file.catch(() => undefined);
    taken = next;
    setEntry(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, location.pathname]);

  useEffect(() => {
    if (!entry || !ready || raw !== null) return;
    let active = true;
    void entry.file.then(
      (file) => {
        if (!active || taken !== entry) return;
        taken = null;
        return onFileRef.current(file);
      },
      () => {
        if (!active || taken !== entry) return;
        taken = null;
        toast.error('送られた画像を読み込めませんでした');
      },
    ).catch(() => toast.error('送られた画像を入れられませんでした'));
    return () => { active = false; };
  }, [entry, ready, raw]);
}
