import { useEffect, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { AGENT_ATTACHMENT_LIMIT, AGENT_FILE_ACCEPT, AGENT_IMAGE_ACCEPT, AgentAttachmentError, readAgentFile, uploadAgentImage } from './agentAttachments';
import type { AgentAttachment } from './agentFlow';

/**
 * Light's 「添付を追加」 (＋) on the planning agent's inputs: a small menu with ファイル and 画像 (2026-11-12, both take
 * several files). Each pick is read or stored at once and comes back through `onAdd`; failures come back as one line.
 */
export function AgentAttachMenu({ brandId, disabled, count, onAdd, onError, onBusy, className = '' }: {
  brandId: string | null; disabled?: boolean; count: number; onAdd: (items: AgentAttachment[]) => void; onError: (message: string) => void;
  onBusy?: (busy: boolean) => void; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  const pick = async (files: FileList | null, kind: 'file' | 'image') => {
    if (!files?.length || !brandId) return;
    const room = Math.max(0, AGENT_ATTACHMENT_LIMIT - count);
    const list = Array.from(files).slice(0, room);
    if (!list.length) { onError(`添付は${AGENT_ATTACHMENT_LIMIT}件までです`); return; }
    setBusy(true); onBusy?.(true);
    const added: AgentAttachment[] = [];
    const failed: string[] = [];
    for (const file of list) {
      try { added.push(kind === 'file' ? await readAgentFile(brandId, file) : await uploadAgentImage(brandId, file)); }
      catch (error) { failed.push(error instanceof AgentAttachmentError ? error.message : `${file.name} を添付できませんでした`); }
    }
    setBusy(false); onBusy?.(false);
    if (added.length) onAdd(added);
    if (failed.length) onError(failed.join('／'));
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button type="button" aria-label="添付を追加" aria-haspopup="menu" aria-expanded={open} disabled={disabled || busy || !brandId} onClick={() => setOpen((value) => !value)}
        className="flex size-8 items-center justify-center rounded-md text-neutral-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <span aria-hidden="true" className="text-2xl font-normal leading-6">＋</span>}
      </button>
      {open && (
        <div role="menu" aria-label="添付を追加" className="absolute bottom-10 left-0 z-30 w-[166px] rounded-xl border border-white/10 bg-[#262a2b] p-2 shadow-xl">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); fileRef.current?.click(); }}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-base leading-5 text-neutral-300 transition hover:bg-white/10 hover:text-white">
            <FileText className="h-4 w-4" />ファイル
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); imageRef.current?.click(); }}
            className="mt-1 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-base leading-5 text-neutral-300 transition hover:bg-white/10 hover:text-white">
            <ImageIcon className="h-4 w-4" />画像
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" accept={AGENT_FILE_ACCEPT} multiple aria-label="添付するファイルを選択" className="sr-only" tabIndex={-1}
        onChange={(event) => { const files = event.target.files; void pick(files, 'file'); event.target.value = ''; }} />
      <input ref={imageRef} type="file" accept={AGENT_IMAGE_ACCEPT} multiple aria-label="添付する画像を選択" className="sr-only" tabIndex={-1}
        onChange={(event) => { const files = event.target.files; void pick(files, 'image'); event.target.value = ''; }} />
    </div>
  );
}

/** The attached files and images above an input, each removable until it is sent. */
export function AgentAttachmentChips({ items, onRemove }: { items: AgentAttachment[]; onRemove?: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-2" data-testid="agent-attachments">
      {items.map((item) => (
        <li key={item.id} className="flex max-w-[220px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-neutral-200">
          {item.kind === 'image' ? <ImageIcon className="h-3.5 w-3.5 flex-none text-cyan-300" /> : <FileText className="h-3.5 w-3.5 flex-none text-cyan-300" />}
          <span className="truncate">{item.name}</span>
          {onRemove && <button type="button" aria-label={`${item.name} を外す`} onClick={() => onRemove(item.id)} className="flex-none rounded p-0.5 text-neutral-400 hover:bg-white/10 hover:text-white"><X className="h-3 w-3" /></button>}
        </li>
      ))}
    </ul>
  );
}
