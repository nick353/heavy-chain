import { useCallback,useEffect,useRef,useState } from 'react';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { useAuthStore } from '../stores/authStore';
import type { PendingProtectedImageSummary } from '../lib/cloudflareImageInputCache';

export function ProtectedImageRecoveryPanel(props:{
  canvasProjectId?:string|null;
  canvasProjectAliases?:string[];
  onResume(entry:PendingProtectedImageSummary):Promise<string>;
  destination:'canvas'|'gallery';
}) {
  const {user,currentBrand} = useAuthStore();
  const [entries,setEntries] = useState<PendingProtectedImageSummary[]>([]);
  const [busy,setBusy] = useState<string|null>(null); const [message,setMessage] = useState('');
  const epoch = useRef(0); const listSequence = useRef(0);
  const refresh = useCallback(async()=>{
    if (!cloudflareDataPlane || !currentBrand?.id || !user?.id) { setEntries([]); return; }
    const current = epoch.current; const sequence = ++listSequence.current;
    try {
      const list = await cloudflareDataPlane.listPendingProtectedImageEdits(currentBrand.id);
      if (epoch.current === current && listSequence.current === sequence) setEntries(list);
    } catch {
      if (epoch.current === current && listSequence.current === sequence) setMessage('中断した編集の入力を読み出せません。保存領域を消さず、再読み込みして確認してください。');
    }
  },[currentBrand?.id,user?.id]);
  useEffect(()=>{
    const epochRef = epoch;
    epochRef.current++; setEntries([]); setBusy(null); setMessage(''); void refresh();
    const listener = () => void refresh();
    window.addEventListener('heavy-image-inputs-changed',listener); window.addEventListener('storage',listener);
    return()=>{epochRef.current++;window.removeEventListener('heavy-image-inputs-changed',listener);window.removeEventListener('storage',listener);};
  },[refresh,props.canvasProjectId]);
  const visible = props.destination === 'canvas' ? entries.filter(entry=>entry.canvasProjectId === props.canvasProjectId ||
    (entry.canvasProjectId&&props.canvasProjectAliases?.includes(entry.canvasProjectId))) : entries;
  if (!cloudflareDataPlane || (!visible.length && !message)) return null;
  const resume = async(entry:PendingProtectedImageSummary)=>{
    if (busy) return; const current = epoch.current; setBusy(entry.requestId); setMessage('同じ依頼を照合しています…');
    try { const result = await props.onResume(entry); if (epoch.current === current) setMessage(result); }
    catch (error) {
      if (epoch.current === current) setMessage(error instanceof Error && /^(image_|protected_|cloudflare_|生成依頼)/.test(error.message)
        ? `復旧は未完了です（${error.message.slice(0,180)}）。入力と依頼IDを保持しています。`
        : '復旧を完了できませんでした。入力と依頼IDを保持しています。');
    } finally { if (epoch.current === current) {setBusy(null);void refresh();} }
  };
  return <section className="relative z-20 m-2 max-h-48 shrink-0 overflow-auto rounded-lg border border-amber-300/30 bg-amber-950/90 p-3 text-sm text-amber-100" aria-label="中断した範囲編集の復旧">
    {visible.length > 0 && <>
      <p>未保存の範囲編集 {visible.length}件。同じ依頼を照合し、生成済みなら合成・保存のみ再開します。</p>
      <p className="mt-1 text-xs">{props.destination === 'canvas' ? 'このCanvasの元画像に対応する結果だけを復旧します。配置後は「保存」で確定してください。' : 'Galleryへの保存を確定します。元のCanvasへの配置はCanvas画面から復旧できます。'}</p>
      <ul className="mt-2 space-y-2">{visible.map(entry=><li key={entry.requestId} className="flex flex-wrap items-center gap-2">
        <span className="max-w-md truncate">{entry.prompt || entry.featureType}</span>
        <span className="text-xs">{new Date(entry.createdAt).toLocaleString()} · {entry.requestId.slice(0,8)}</span>
        <button type="button" className="rounded border border-amber-200/40 px-2 py-1 disabled:opacity-50" disabled={!!busy} onClick={()=>void resume(entry)}>
          {busy === entry.requestId ? '復旧中…' : props.destination === 'canvas' ? 'このCanvasへ復旧' : entry.canvasProjectId ? 'Galleryで結果を確認' : '復旧してGalleryへ保存'}
        </button>
      </li>)}</ul>
    </>}
    {message && <p role="status" className="mt-2">{message}</p>}
  </section>;
}
