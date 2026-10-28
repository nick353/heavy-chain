/** The visible text inside DOCX / XLSX / PPTX files (ZIPs of XML), read with the browser's own inflate and no extra library. */

/** Reads the named entries of a ZIP (DOCX / XLSX / PPTX are ZIPs of XML) with the browser's own inflate. */
async function readZipEntries(bytes: Uint8Array, wanted: (path: string) => boolean): Promise<Array<{ path: string; text: string }>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  if (end < 0) throw new Error('office_zip_unreadable');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: Array<{ path: string; text: string }> = [];
  for (let index = 0; index < count && at + 46 <= bytes.length; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true); const extraLength = view.getUint16(at + 30, true); const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const path = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!wanted(path)) continue;
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + size);
    let data: Uint8Array;
    if (method === 0) data = raw;
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else continue;
    out.push({ path, text: new TextDecoder().decode(data) });
  }
  return out;
}

const decodeXml = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const xmlTexts = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((match) => decodeXml(match[1]));
const slideOrder = (path: string) => Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);

/** The visible text of a Word, Excel or PowerPoint file: paragraphs, shared cell strings and slide text. */
export async function officeText(bytes: Uint8Array, ext: string): Promise<string> {
  if (ext === 'docx') {
    const [doc] = await readZipEntries(bytes, (path) => path === 'word/document.xml');
    return doc ? doc.text.split(/<\/w:p>/).map((paragraph) => xmlTexts(paragraph, 'w:t').join('')).filter(Boolean).join('\n') : '';
  }
  if (ext === 'pptx') {
    const slides = await readZipEntries(bytes, (path) => /^ppt\/slides\/slide\d+\.xml$/.test(path));
    return slides.sort((a, b) => slideOrder(a.path) - slideOrder(b.path))
      .map((slide, index) => `[スライド${index + 1}]\n${slide.text.split(/<\/a:p>/).map((paragraph) => xmlTexts(paragraph, 'a:t').join('')).filter(Boolean).join('\n')}`).join('\n');
  }
  const entries = await readZipEntries(bytes, (path) => path === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(path));
  const shared = (entries.find((entry) => entry.path === 'xl/sharedStrings.xml')?.text.split(/<\/si>/) ?? []).map((item) => xmlTexts(item, 't').join(''));
  return entries.filter((entry) => entry.path.startsWith('xl/worksheets/')).sort((a, b) => slideOrder(a.path) - slideOrder(b.path)).map((sheet) =>
    sheet.text.split(/<\/row>/).map((row) => [...row.matchAll(/<c\b([^>]*)>(?:<f>[^<]*<\/f>)?(?:<v>([^<]*)<\/v>|<is>([\s\S]*?)<\/is>)?<\/c>/g)].map((cell) => {
      if (cell[3]) return xmlTexts(cell[3], 't').join('');
      const value = cell[2] ?? '';
      return /\bt="s"/.test(cell[1]) ? shared[Number(value)] ?? '' : decodeXml(value);
    }).filter(Boolean).join(',')).filter(Boolean).join('\n')).join('\n');
}
