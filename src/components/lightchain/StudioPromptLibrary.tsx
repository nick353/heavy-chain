import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, Pencil, Plus, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * 本家のプロンプトライブラリ（スタジオの入力欄と部分編集の「プロンプトライブラリ」「プロンプトを保存」。2026-11-13 本家で開いた形）。
 * 1280×800 の窓: 左 320px に「プロンプトライブラリ」＋、検索、題つきの一覧。右に「メッセージの詳細」（題・本文）と
 * 編集する／入力後に挿入／現在の内容を上書き。＋と保存は「プロンプトを追加」（プロンプト名 50字・カバー画像・プロンプトの内容 2000字・
 * キャンセル／保存）。本家はアカウントに残すが、Heavy はこれまでどおりこの端末（localStorage）に残す。
 */
import { STUDIO_PROMPT_TEXT_MAX, STUDIO_PROMPT_TITLE_MAX, readStudioPromptLibrary, withStudioPrompt, writeStudioPromptLibrary, type StudioPromptEntry } from '../../lib/studioPromptLibrary';

const COVER_EDGE = 240;

const readCover = (file: File) => new Promise<string>((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const ratio = Math.min(1, COVER_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url); resolve(canvas.toDataURL('image/jpeg', 0.85));
  };
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('studio_prompt_cover_unreadable')); };
  image.src = url;
});

type Mode = { kind: 'view' } | { kind: 'edit'; id: string | null };
export function StudioPromptLibrary({ initialText, onInsert, onReplace, onClose }: {
  /** 「プロンプトを保存」から開いたときの本文（「プロンプトを追加」で開く）。 */
  initialText?: string;
  /** 入力後に挿入（今の入力の後ろに足す）。 */
  onInsert: (text: string) => void;
  /** 現在の内容を上書き。 */
  onReplace: (text: string) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<StudioPromptEntry[]>(() => readStudioPromptLibrary());
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() => entries[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>(initialText !== undefined ? { kind: 'edit', id: null } : { kind: 'view' });
  const [title, setTitle] = useState('');
  const [text, setText] = useState(initialText ?? '');
  const [cover, setCover] = useState<string | undefined>(undefined);
  const coverInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return words ? entries.filter(item => `${item.title}\n${item.text}`.toLowerCase().includes(words)) : entries;
  }, [entries, query]);
  const selected = entries.find(item => item.id === selectedId) ?? null;
  const startEdit = (entry: StudioPromptEntry | null) => {
    setMode({ kind: 'edit', id: entry?.id ?? null });
    setTitle(entry?.title ?? ''); setText(entry?.text ?? ''); setCover(entry?.cover);
  };
  const save = () => {
    if (!title.trim()) { toast.error('プロンプト名を入力してください'); return; }
    if (!text.trim()) { toast.error('プロンプトの内容を入力してください'); return; }
    const id = mode.kind === 'edit' && mode.id ? mode.id : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const next = withStudioPrompt(entries, { id, title: title.trim().slice(0, STUDIO_PROMPT_TITLE_MAX), text: text.slice(0, STUDIO_PROMPT_TEXT_MAX), ...(cover ? { cover } : {}), updatedAt: Date.now() });
    if (!writeStudioPromptLibrary(next)) { toast.error('保存できませんでした（端末の保存領域がいっぱいです）'); return; }
    setEntries(next); setSelectedId(id); setMode({ kind: 'view' });
    toast.success('プロンプトを保存しました');
  };
  const remove = (id: string) => {
    const next = entries.filter(item => item.id !== id);
    writeStudioPromptLibrary(next); setEntries(next); setSelectedId(next[0]?.id ?? null); setMode({ kind: 'view' });
  };
  const counter = 'absolute bottom-3 right-4 text-xs text-white/50';
  const label = 'mb-2 block text-base font-medium text-white';
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" data-studio-chrome="" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="プロンプトライブラリ" data-testid="studio-prompt-library"
        className="flex h-[800px] max-h-[calc(100vh-32px)] w-[1280px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-white/10 bg-[#262a2b] text-white shadow-2xl">
        <aside className="flex w-[320px] shrink-0 flex-col border-r border-white/10 bg-[#2d3133]">
          <div className="flex items-center justify-between px-6 pb-4 pt-5">
            <h2 className="text-lg font-semibold">プロンプトライブラリ</h2>
            <button type="button" aria-label="プロンプトを追加" title="プロンプトを追加" onClick={() => startEdit(null)} className="flex size-8 items-center justify-center rounded text-white/80 hover:bg-white/[0.08]"><Plus className="h-5 w-5" /></button>
          </div>
          <label className="mx-4 mb-4 flex h-8 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs text-white/60">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="キーワードを入力して検索" aria-label="プロンプトを検索" className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-white/40" />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/10 px-3 py-3" role="listbox" aria-label="保存したプロンプト">
            {mode.kind === 'edit' && !mode.id && <div className="mb-1 rounded-xl bg-white/[0.12] px-3 py-3 text-sm"><p className="font-medium">{title.trim() || 'Untitled'}</p><p className="mt-1 line-clamp-2 text-white/70">{text.trim() || 'プロンプトの内容を入力してください。'}</p></div>}
            {shown.map(item => (
              <button key={item.id} type="button" role="option" aria-selected={item.id === selectedId && mode.kind === 'view'} onClick={() => { setSelectedId(item.id); setMode({ kind: 'view' }); }}
                className={`mb-1 flex w-full gap-3 rounded-xl px-3 py-3 text-left text-sm ${item.id === selectedId && mode.kind === 'view' ? 'bg-white/[0.12]' : 'hover:bg-white/[0.06]'}`}>
                {item.cover && <img src={item.cover} alt="" className="size-12 shrink-0 rounded-md object-cover" />}
                <span className="min-w-0"><span className="block truncate font-medium">{item.title}</span><span className="mt-1 line-clamp-3 whitespace-pre-line text-white/70">{item.text}</span></span>
              </button>
            ))}
            {!shown.length && mode.kind === 'view' && <p className="px-3 py-3 text-sm text-white/50">{entries.length ? '一致するプロンプトはありません' : '保存したプロンプトはまだありません'}</p>}
          </div>
        </aside>
        <section className="relative flex min-w-0 flex-1 flex-col px-6 pb-6 pt-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{mode.kind === 'edit' ? (mode.id ? 'プロンプトを編集' : 'プロンプトを追加') : 'メッセージの詳細'}</h2>
            <button type="button" aria-label="閉じる" onClick={onClose} className="flex size-8 items-center justify-center rounded text-white/80 hover:bg-white/[0.08]"><X className="h-5 w-5" /></button>
          </div>
          {mode.kind === 'edit' ? (
            <form className="mt-6 flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); save(); }}>
              <label className={label} htmlFor="studio-prompt-title">プロンプト名<span className="ml-1 text-[#f04438]">*</span></label>
              <div className="relative">
                <input id="studio-prompt-title" autoFocus value={title} maxLength={STUDIO_PROMPT_TITLE_MAX} onChange={event => setTitle(event.target.value)} placeholder="名前を入力してください"
                  className="h-10 w-full rounded-lg border border-white/15 bg-transparent px-3 pr-16 text-sm outline-none placeholder:text-white/40 focus:border-[#20d0c4]" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/50">{title.length}/{STUDIO_PROMPT_TITLE_MAX}</span>
              </div>
              <p className="mb-1 mt-6 text-base font-medium">カバー画像</p>
              <p className="mb-3 text-xs text-white/50">JPG、PNG、WebP、SVGに対応。画像1枚あたり20 MB以下</p>
              <input ref={coverInputRef} type="file" className="sr-only" accept=".jpg,.jpeg,.png,.webp,.svg" aria-label="カバー画像ファイル"
                onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > 20 * 1024 * 1024) { toast.error('画像1枚あたり20 MB以下にしてください'); return; } void readCover(file).then(setCover).catch(() => toast.error('画像を読み込めませんでした')); }} />
              <div className="flex items-end gap-3">
                <button type="button" onClick={() => coverInputRef.current?.click()} className="flex size-[120px] flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-xs text-white/80 hover:bg-white/[0.08]">
                  {cover ? <img src={cover} alt="カバー画像" className="h-full w-full object-cover" /> : <><ImagePlus aria-hidden="true" className="h-5 w-5" />画像をアップロード</>}
                </button>
                {cover && <button type="button" onClick={() => setCover(undefined)} className="text-xs text-white/60 underline">画像を外す</button>}
              </div>
              <label className={`${label} mt-6`} htmlFor="studio-prompt-text">プロンプトの内容<span className="ml-1 text-[#f04438]">*</span></label>
              <div className="relative min-h-[160px] flex-1">
                <textarea id="studio-prompt-text" value={text} maxLength={STUDIO_PROMPT_TEXT_MAX} onChange={event => setText(event.target.value)} placeholder="プロンプトの内容を入力してください。"
                  className="h-full w-full resize-none rounded-xl border border-white/15 bg-transparent p-3 text-sm leading-6 outline-none placeholder:text-white/40 focus:border-[#20d0c4]" />
                <span className={counter}>{text.length}/{STUDIO_PROMPT_TEXT_MAX}</span>
              </div>
              <div className="mt-6 flex items-center justify-end gap-3">
                {mode.id && <button type="button" onClick={() => remove(mode.id!)} className="mr-auto h-10 rounded-lg px-4 text-sm text-red-300 hover:bg-red-500/10">削除</button>}
                <button type="button" onClick={() => setMode({ kind: 'view' })} className="h-10 rounded-lg bg-[#505c5e] px-4 text-sm text-white">キャンセル</button>
                <button type="submit" className="h-10 rounded-lg bg-[#20d0c4] px-4 text-sm font-medium text-[#111817]">保存</button>
              </div>
            </form>
          ) : selected ? (
            <>
              <div className="mt-6 min-h-0 flex-1 overflow-y-auto text-sm leading-6">
                {selected.cover && <img src={selected.cover} alt="" className="mb-4 max-h-40 rounded-lg object-contain" />}
                <p className="font-medium">{selected.title}</p>
                <p className="mt-4 whitespace-pre-wrap text-white/90">{selected.text}</p>
              </div>
              <div className="mt-6 flex items-center justify-end gap-2">
                <button type="button" onClick={() => startEdit(selected)} className="flex h-10 items-center gap-1.5 rounded-lg border border-white/15 px-4 text-sm text-white hover:bg-white/[0.06]"><Pencil aria-hidden="true" className="h-4 w-4" />編集する</button>
                <button type="button" onClick={() => { onInsert(selected.text); onClose(); }} className="h-10 rounded-lg bg-[#505c5e] px-4 text-sm text-white">入力後に挿入</button>
                <button type="button" onClick={() => { onReplace(selected.text); onClose(); }} className="h-10 rounded-lg bg-[#20d0c4] px-4 text-sm font-medium text-[#111817]">現在の内容を上書き</button>
              </div>
            </>
          ) : <p className="mt-6 text-sm text-white/50">左の＋からプロンプトを追加できます</p>}
        </section>
      </div>
    </div>,
    document.body,
  );
}
