import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cloudflareDataPlane } from '../../lib/cloudflareApi';
import { saveWorkspaceArtifactBestEffort } from '../../lib/localWorkspaceArtifacts';
import { useAuthStore } from '../../stores/authStore';
import {
  STUDIO_COLLECT_TEXT as TEXT, buildStudioCollectArtifact, studioCollectChildren, studioCollectFolders, studioCollectGroupName, studioCollectImageDataUrl,
  studioCollectTrail, type StudioCollectFolder,
} from '../../lib/studioCollect';

type Space = 'personal' | 'team';

/**
 * スタジオの帯の「お気に入り」で開く窓（本家「收藏至资源库」）。題「お気に入りに追加」、右上に
 * パーソナルスペース｜チームスペース、「ホーム」の道しるべ、フォルダの一覧（押すと選択）、
 * 下に「新規グループ作成」・「キャンセル」・「決定」（選ぶまで押せない）。
 * フォルダはライブラリー画面と同じ /v1/folders。決定でライブラリーへ保存し、お知らせを出して閉じる。
 */
export function StudioCollectDialog({ imageUrl, title, sourceStoragePath, onClose }: {
  imageUrl: string;
  title?: string;
  /** 生成結果の保存先（あればプリントデザインと同じく metadata.sourceStoragePath に残す）。 */
  sourceStoragePath?: string;
  onClose(): void;
}) {
  const { user, currentBrand } = useAuthStore();
  const brandId = currentBrand?.id ?? '';
  const userId = user?.id ?? '';
  const [space, setSpace] = useState<Space>('personal');
  const [folders, setFolders] = useState<StudioCollectFolder[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState<'create' | 'save' | null>(null);
  const pendingFolderId = useRef<string | null>(null);

  useEffect(() => {
    setFolders(null); setLoadFailed(false); setParentId(null); setSelectedId(null);
    if (!brandId || !cloudflareDataPlane) { setFolders([]); return; }
    let cancelled = false;
    void cloudflareDataPlane.listFolders(brandId)
      .then(rows => { if (!cancelled) setFolders(studioCollectFolders(rows)); })
      .catch(() => { if (!cancelled) { setFolders([]); setLoadFailed(true); } });
    return () => { cancelled = true; };
  }, [brandId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const shown = space === 'personal' && folders ? studioCollectChildren(folders, parentId) : [];
  const trail = space === 'personal' && folders ? studioCollectTrail(folders, parentId) : [];
  const hasChildren = (id: string) => Boolean(folders?.some(folder => folder.parentId === id));
  const selected = space === 'personal' ? folders?.find(folder => folder.id === selectedId) ?? null : null;

  const openFolder = (id: string | null) => { setParentId(id); setSelectedId(null); };
  const closeCreate = () => { setCreating(false); setGroupName(''); pendingFolderId.current = null; };
  const createGroup = async () => {
    const name = studioCollectGroupName(groupName);
    if (!name || !brandId || !cloudflareDataPlane || busy) return;
    // 送り直しても同じ id（サーバーは 409 を返し、グループを2つ作らない。ライブラリー画面と同じ）。
    const id = pendingFolderId.current ?? crypto.randomUUID();
    pendingFolderId.current = id;
    setBusy('create');
    try {
      let created: { id: string; name: string; parent_folder_id?: string | null } | undefined;
      try {
        created = await cloudflareDataPlane.createFolder({ id, brand_id: brandId, name, parent_folder_id: parentId });
      } catch {
        created = (await cloudflareDataPlane.listFolders(brandId)).find(folder => folder.id === id);
        if (!created) throw new Error('studio_collect_group_create_failed');
      }
      const folder: StudioCollectFolder = { id: created.id, name: created.name, parentId: created.parent_folder_id ?? parentId };
      setFolders(current => [...(current ?? []).filter(item => item.id !== folder.id), folder]);
      setSelectedId(folder.id);
      closeCreate();
    } catch {
      toast.error('グループを作成できませんでした');
    } finally {
      setBusy(null);
    }
  };
  const confirm = async () => {
    if (!selected || !brandId || !userId || busy) return;
    setBusy('save');
    try {
      const dataUrl = await studioCollectImageDataUrl(imageUrl);
      const persistenceContext = await cloudflareDataPlane?.captureArtifactPersistenceContext();
      const result = await saveWorkspaceArtifactBestEffort(
        buildStudioCollectArtifact({ brandId, userId, imageUrl: dataUrl, title, folder: selected, sourceStoragePath }),
        { persistenceContext },
      );
      if (!result.localPersisted || (cloudflareDataPlane && !result.remote)) throw new Error('library_save_unconfirmed');
      toast.success(TEXT.saved);
      onClose();
    } catch {
      toast.error(TEXT.failed);
    } finally {
      setBusy(null);
    }
  };

  const tabClass = (active: boolean) => `px-1 text-sm transition ${active ? 'text-white' : 'text-white/45 hover:text-white/80'}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label={TEXT.title} data-testid="studio-collect-dialog"
      onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="flex max-h-[80vh] w-[min(560px,calc(100vw-32px))] flex-col rounded-2xl border border-white/10 bg-[#1d2224] text-white shadow-2xl">
        <div className="flex items-center gap-3 px-6 pb-3 pt-5">
          <h2 className="text-base font-semibold">{TEXT.title}</h2>
          <div className="ml-auto flex items-center gap-2" role="tablist" aria-label="保存スペース">
            <button type="button" role="tab" aria-selected={space === 'personal'} className={tabClass(space === 'personal')} onClick={() => { setSpace('personal'); setSelectedId(null); }}>{TEXT.personal}</button>
            <span aria-hidden="true" className="h-3.5 w-px bg-white/20" />
            <button type="button" role="tab" aria-selected={space === 'team'} className={tabClass(space === 'team')} onClick={() => { setSpace('team'); setSelectedId(null); closeCreate(); }}>{TEXT.team}</button>
          </div>
          <button type="button" aria-label="閉じる" disabled={busy !== null} onClick={onClose} className="ml-2 rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <nav aria-label="フォルダの場所" className="flex flex-wrap items-center gap-1 px-6 pb-2 text-sm text-white/60">
          <button type="button" className={trail.length ? 'hover:text-white' : 'text-white'} onClick={() => openFolder(null)}>{TEXT.home}</button>
          {trail.map((folder, index) => (
            <span key={folder.id} className="flex items-center gap-1">
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
              <button type="button" className={index === trail.length - 1 ? 'text-white' : 'hover:text-white'} onClick={() => openFolder(folder.id)}>{folder.name}</button>
            </span>
          ))}
        </nav>
        <div className="mx-6 min-h-[220px] flex-1 overflow-y-auto border-t border-white/10" data-testid="studio-collect-folders">
          {space === 'team' ? (
            <p className="py-10 text-center text-sm text-white/50">{TEXT.teamEmpty}</p>
          ) : folders === null ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-white/50"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />読み込み中…</p>
          ) : (
            <ul role="listbox" aria-label="フォルダ" className="divide-y divide-white/10">
              {shown.map(folder => (
                <li key={folder.id} className="flex items-center">
                  <button type="button" role="option" aria-selected={selectedId === folder.id} onClick={() => setSelectedId(folder.id)}
                    className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-3 text-left text-sm transition ${selectedId === folder.id ? 'bg-[#5fd0c8]/15 text-[#5fd0c8]' : 'text-white/90 hover:bg-white/[0.05]'}`}>
                    <Folder aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="truncate">{folder.name}</span>
                  </button>
                  {hasChildren(folder.id) && <button type="button" aria-label={`${folder.name}を開く`} onClick={() => openFolder(folder.id)} className="px-2 py-3 text-white/50 hover:text-white"><ChevronRight className="h-4 w-4" /></button>}
                </li>
              ))}
              {shown.length === 0 && !creating && <li className="py-10 text-center text-sm text-white/50">{loadFailed ? 'グループを読み込めませんでした' : TEXT.empty}</li>}
            </ul>
          )}
          {creating && space === 'personal' && (
            <form className="flex items-center gap-2 border-t border-white/10 px-2 py-3" onSubmit={(event) => { event.preventDefault(); void createGroup(); }}>
              <Folder aria-hidden="true" className="h-4 w-4 shrink-0 text-white/60" />
              <input autoFocus aria-label="新しいグループ名" value={groupName} maxLength={50} placeholder={TEXT.newGroupPlaceholder} onChange={(event) => setGroupName(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border border-white/15 bg-black/20 px-2 text-sm text-white outline-none focus:border-[#5fd0c8]" />
              <button type="submit" disabled={!studioCollectGroupName(groupName) || busy !== null} className="h-8 rounded-md bg-[#5fd0c8] px-3 text-sm text-slate-950 disabled:opacity-40">{busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : TEXT.create}</button>
              <button type="button" disabled={busy !== null} onClick={closeCreate} className="h-8 rounded-md px-3 text-sm text-white/70 hover:bg-white/10">{TEXT.cancel}</button>
            </form>
          )}
        </div>
        <div className="flex items-center gap-3 px-6 pb-5 pt-4">
          <button type="button" disabled={space !== 'personal' || creating || busy !== null || !brandId || !cloudflareDataPlane} onClick={() => setCreating(true)}
            className="h-9 rounded-lg bg-[#5fd0c8] px-4 text-sm text-slate-950 disabled:opacity-40">{TEXT.newGroup}</button>
          <button type="button" disabled={busy !== null} onClick={onClose} className="ml-auto h-9 rounded-lg border border-white/15 px-4 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40">{TEXT.cancel}</button>
          <button type="button" disabled={!selected || busy !== null} onClick={() => void confirm()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#5fd0c8] px-4 text-sm text-slate-950 disabled:opacity-40">{busy === 'save' && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}{TEXT.confirm}</button>
        </div>
      </div>
    </div>
  );
}
