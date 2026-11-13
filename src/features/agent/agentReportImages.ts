/**
 * A downloaded report keeps its pictures. The reports show Heavy's generated images through signed read URLs
 * (/v1/media/read?token=…) that expire within an hour, so a saved テーマ企画書 / 執行書 / デザイン案 opened later showed empty
 * frames (found 2026-11-13 on production: テーマ企画書.html 5f5f71f6 and 図案執行書.html 147398e5 held 6 and 15 such URLs).
 * On download each of those images is read once and written into the file as a data URL; one that cannot be read keeps its
 * address. Other images (data URLs, real products' pictures from the shop) are left as they are. Pure: the reader is passed in.
 */

/** Heavy's signed read URL of a generated image (the media gateway with its token). */
export function isSignedMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/v1/media/read' && Boolean(parsed.searchParams.get('token'));
  } catch {
    return false;
  }
}

const decodeAttribute = (value: string) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The report with every signed image written in; `read` returns a data URL or null (then the address stays). */
export async function inlineReportImages(html: string, read: (url: string) => Promise<string | null>): Promise<{ html: string; inlined: number; failed: number }> {
  const pattern = /(<img\b[^>]*?\ssrc=")([^"]+)(")/g;
  const wanted = new Map<string, string>();
  for (const match of html.matchAll(pattern)) {
    const url = decodeAttribute(match[2]);
    if (isSignedMediaUrl(url)) wanted.set(match[2], url);
  }
  const results = new Map<string, string | null>();
  await Promise.all([...wanted].map(async ([raw, url]) => {
    let data: string | null = null;
    try { data = await read(url); } catch { data = null; }
    results.set(raw, data && data.startsWith('data:image/') ? data : null);
  }));
  const out = html.replace(pattern, (whole, head: string, raw: string, tail: string) => {
    const data = results.get(raw);
    return data ? `${head}${data}${tail}` : whole;
  });
  const inlined = [...results.values()].filter(Boolean).length;
  return { html: out, inlined, failed: results.size - inlined };
}
