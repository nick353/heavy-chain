/**
 * Light's 添付を追加 on the planning agent (2026-11-12): a menu with ファイル (.xlsx .pdf .ppt .pptx .doc .docx) and 画像
 * (.jpg .jpeg .png .avif .webp), several at once. Heavy keeps what a file says (the text of Word / Excel / PowerPoint
 * read in the browser; a PDF read by Claude on the server) and stores an image so every later request sends it along.
 */
import { cloudflareDataPlane } from '../../lib/cloudflareApi';
import { officeText } from '../../lib/officeText';
import type { AgentAttachment } from './agentFlow';

export const AGENT_FILE_ACCEPT = '.xlsx,.pdf,.ppt,.pptx,.doc,.docx';
export const AGENT_IMAGE_ACCEPT = '.jpg,.jpeg,.png,.avif,.webp';
export const AGENT_ATTACHMENT_LIMIT = 12;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** The assistant accepts PNG, JPEG and WebP references up to 10MB; larger or other images are re-encoded as JPEG. */
const REFERENCE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 6000;

export class AgentAttachmentError extends Error {}
const extension = (name: string) => name.toLowerCase().split('.').pop() ?? '';
const api = () => { if (!cloudflareDataPlane) throw new AgentAttachmentError('添付を利用できません'); return cloudflareDataPlane; };

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(binary);
}

/** Reads one attached document into the text the planning requests quote. */
export async function readAgentFile(brandId: string, file: File): Promise<AgentAttachment> {
  const ext = extension(file.name);
  if (!AGENT_FILE_ACCEPT.split(',').includes(`.${ext}`)) throw new AgentAttachmentError(`${file.name} は添付できない形式です`);
  if (file.size > MAX_FILE_BYTES) throw new AgentAttachmentError(`${file.name} が大きすぎます（6MBまで）`);
  // The older binary Office formats have no readable text without a converter; say so instead of attaching nothing.
  if (ext === 'doc' || ext === 'ppt') throw new AgentAttachmentError(`${file.name} は読み取れません。.docx・.pptx・.pdf に保存し直して添付してください`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = '';
  if (ext === 'pdf') {
    const result = await api().invokeProviderAction<{ text?: string }>('profile-extract', { brandId, purpose: 'planning-material', files: [{ name: file.name.slice(0, 120), kind: 'pdf', data: toBase64(bytes) }] });
    text = typeof result?.text === 'string' ? result.text : '';
  } else {
    text = await officeText(bytes, ext);
  }
  if (!text.trim()) throw new AgentAttachmentError(`${file.name} から文字を読み取れませんでした`);
  return { id: crypto.randomUUID(), kind: 'file', name: file.name.slice(0, 120), size: file.size, at: new Date().toISOString(), text: text.trim().slice(0, MAX_TEXT_CHARS) };
}

/** AVIF and very large images become a JPEG of at most 2048px so the assistant can read them. */
async function referenceFile(file: File): Promise<File> {
  const type = file.type.toLowerCase();
  if ((type === 'image/png' || type === 'image/jpeg' || type === 'image/webp') && file.size <= REFERENCE_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new AgentAttachmentError(`${file.name} を読み込めませんでした`);
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new AgentAttachmentError(`${file.name} を読み込めませんでした`);
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally { bitmap.close(); }
}

/** Stores an attached image as the brand's own image so the assistant may read it as a reference. */
export async function uploadAgentImage(brandId: string, file: File): Promise<AgentAttachment> {
  const ext = extension(file.name);
  if (!AGENT_IMAGE_ACCEPT.split(',').includes(`.${ext}`)) throw new AgentAttachmentError(`${file.name} は添付できない形式です`);
  if (file.size > MAX_IMAGE_BYTES) throw new AgentAttachmentError(`${file.name} が大きすぎます（20MBまで）`);
  const upload = await referenceFile(file);
  const storagePath = await api().uploadBrandLogo(brandId, upload);
  const image = await api().createGeneratedImage({ brand_id: brandId, storage_path: storagePath, feature_type: 'lightchain-design-agent-attachment',
    prompt: file.name.slice(0, 120), metadata: { fileName: file.name.slice(0, 120) } as never });
  return { id: crypto.randomUUID(), kind: 'image', name: file.name.slice(0, 120), size: upload.size, at: new Date().toISOString(), imageId: image.id, storagePath };
}
