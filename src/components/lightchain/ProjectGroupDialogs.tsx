import { useEffect, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { DESIGN_GROUP_NAME_LIMIT, readGroupCover, type DesignProjectGroup } from '../../lib/designProjectGroups';

const shell = 'fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4';
const panel = 'w-[520px] max-w-full rounded-xl border border-white/10 bg-[#25292b] p-6 text-white shadow-2xl';
const grayButton = 'h-8 rounded-lg bg-[#4a5052] px-4 text-sm text-white hover:bg-[#565d60]';
const primaryButton = 'h-8 rounded-lg bg-[#0bcabc] px-4 text-sm font-medium text-neutral-950 hover:bg-[#3dd8cc] disabled:bg-[#4a5052] disabled:text-neutral-400';

/** Light's 新規グループ作成: グループ名 (up to 50) and a required グループのカバー画像. */
export function CreateGroupDialog({ onCancel, onSave }: { onCancel: () => void; onSave: (name: string, cover: string) => void }) {
  const [name, setName] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const pick = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|avif)$/.test(file.type)) { setError('jpg、jpeg、png、webp の画像を選択してください'); return; }
    try { setCover(await readGroupCover(file)); setError(null); } catch { setError('画像を読み込めませんでした'); }
  };
  return <div className={shell} role="presentation" onClick={onCancel}>
    <div role="dialog" aria-modal="true" aria-label="新規グループ作成" data-testid="create-group-dialog" className={panel} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">新規グループ作成</h2>
        <button type="button" aria-label="閉じる" onClick={onCancel} className="text-neutral-400 hover:text-white"><X className="h-4 w-4" /></button></div>
      <label className="mt-6 block text-base">グループ名 *
        <span className="relative mt-2 block"><input autoFocus value={name} maxLength={DESIGN_GROUP_NAME_LIMIT} onChange={(event) => setName(event.target.value)} placeholder="グループ名を入力" aria-label="グループ名"
          className="h-8 w-full rounded-md border border-white/15 bg-transparent px-3 pr-16 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-[#0bcabc]" />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">{name.length} / {DESIGN_GROUP_NAME_LIMIT}</span></span></label>
      <p className="mt-5 text-base">グループのカバー画像 *</p>
      <input ref={input} type="file" accept=".png,.jpg,.jpeg,.webp,.avif" className="sr-only" aria-label="グループのカバー画像" onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ''; }} />
      <button type="button" onClick={() => input.current?.click()} className="mt-2 flex h-[100px] w-[160px] flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed border-white/15 bg-white/[0.04] text-xs text-neutral-300 hover:border-white/30">
        {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : <><Plus className="h-5 w-5" />画像をアップロード</>}</button>
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={grayButton}>キャンセル</button>
        <button type="button" disabled={!name.trim() || !cover} onClick={() => cover && onSave(name.trim(), cover)} className={primaryButton}>保存</button>
      </div>
    </div>
  </div>;
}

/** Light's 移動: pick a destination group under the ルートフォルダー, or make one with 新規グループ作成. */
export function MoveToGroupDialog({ groups, currentGroupId, onCancel, onConfirm, onCreate }: {
  groups: DesignProjectGroup[]; currentGroupId: string | null; onCancel: () => void;
  onConfirm: (groupId: string | null) => void; onCreate: (name: string, cover: string) => string;
}) {
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  useEffect(() => { setChoice(undefined); }, [currentGroupId]);
  const options = groups.filter((group) => group.id !== currentGroupId);
  return <>
    <div className={shell} role="presentation" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label="移動" data-testid="move-group-dialog" className={panel} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}>
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">移動</h2>
          <button type="button" aria-label="閉じる" onClick={onCancel} className="text-neutral-400 hover:text-white"><X className="h-4 w-4" /></button></div>
        <p className="mt-6 text-sm text-neutral-300">ルートフォルダー</p>
        <div role="listbox" aria-label="グループを選択" className="mt-3 grid max-h-[280px] gap-1 overflow-y-auto">
          {currentGroupId && <button type="button" role="option" aria-selected={choice === null} onClick={() => setChoice(null)}
            className={`flex h-10 items-center justify-between rounded-lg px-3 text-left text-sm ${choice === null ? 'bg-white/10 text-white' : 'text-neutral-300 hover:bg-white/5'}`}>ルートフォルダーに戻す{choice === null && <Check className="h-4 w-4 text-[#0bcabc]" />}</button>}
          {options.map((group) => <button key={group.id} type="button" role="option" aria-selected={choice === group.id} onClick={() => setChoice(group.id)}
            className={`flex h-12 items-center gap-3 rounded-lg px-3 text-left text-sm ${choice === group.id ? 'bg-white/10 text-white' : 'text-neutral-300 hover:bg-white/5'}`}>
            <img src={group.cover} alt="" className="h-8 w-8 rounded object-cover" /><span className="min-w-0 flex-1 truncate">{group.name}</span>{choice === group.id && <Check className="h-4 w-4 text-[#0bcabc]" />}</button>)}
          {options.length === 0 && !currentGroupId && <p className="py-6 text-center text-sm text-neutral-300">利用可能な移動先グループがありません</p>}
        </div>
        <div className="mt-6 flex items-center justify-between">
          <button type="button" onClick={() => setCreating(true)} className="h-8 rounded-lg border border-[#0bcabc]/70 px-4 text-sm text-white hover:bg-[#0bcabc]/10">新規グループ作成</button>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className={grayButton}>キャンセル</button>
            <button type="button" disabled={choice === undefined} onClick={() => onConfirm(choice ?? null)} className={primaryButton}>確認</button>
          </div>
        </div>
      </div>
    </div>
    {creating && <CreateGroupDialog onCancel={() => setCreating(false)} onSave={(name, cover) => { const id = onCreate(name, cover); setCreating(false); setChoice(id); }} />}
  </>;
}
