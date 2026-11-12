import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cloudflareDataPlane } from '../../lib/cloudflareApi';
import { saveWorkspaceArtifactBestEffort } from '../../lib/localWorkspaceArtifacts';
import { refreshSignedImageUrl } from '../../lib/storage';
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
      const dataUrl = await studioCollectImageDataUrl(await refreshSignedImageUrl(imageUrl));
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

  // 本家の見た目（2026-11-12 本家の本番で開いて並べ、画素で測った）: 幅520・角丸・枠なし、後ろは画面全体を約75%暗くする、題は14pxで太字にしない、
  // スペースは丸い切り替え（地は窓より明るい灰色・文字12px・選んだ側は薄い青緑の地に青緑の文字で太字にしない）、×は無い、「ホーム」は12pxの薄い文字、
  // フォルダは開いたフォルダの青緑の印で各行の下にごく薄い線、4行ぶんまでは窓が伸び縮みする、下の段は上に線、ボタンの文字は12px、
  // キャンセルは灰色の塗り（#545d62）、決定は選ぶまで灰色（#454a4d）。
  const tabClass = (active: boolean) => `h-7 rounded-full px-4 text-xs transition ${active ? 'bg-[#20d0c4]/15 text-[#20d0c4]' : 'text-white/60 hover:text-white'}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75" role="dialog" aria-modal="true" aria-label={TEXT.title} data-testid="studio-collect-dialog"
      onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="flex max-h-[80vh] w-[min(520px,calc(100vw-32px))] flex-col rounded-xl bg-[#26292b] text-white shadow-2xl">
        <div className="flex items-center gap-3 px-6 pb-3 pt-5">
          <h2 className="text-sm font-normal text-white/90">{TEXT.title}</h2>
          <div className="ml-auto flex items-center rounded-full bg-[#313538] p-1" role="tablist" aria-label="保存スペース">
            <button type="button" role="tab" aria-selected={space === 'personal'} className={tabClass(space === 'personal')} onClick={() => { setSpace('personal'); setSelectedId(null); }}>{TEXT.personal}</button>
            <button type="button" role="tab" aria-selected={space === 'team'} className={tabClass(space === 'team')} onClick={() => { setSpace('team'); setSelectedId(null); closeCreate(); }}>{TEXT.team}</button>
          </div>
        </div>
        <nav aria-label="フォルダの場所" className="flex flex-wrap items-center gap-1 px-6 pb-1 text-xs text-white/35">
          <button type="button" className="hover:text-white/70" onClick={() => openFolder(null)}>{TEXT.home}</button>
          {trail.map((folder, index) => (
            <span key={folder.id} className="flex items-center gap-1">
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
              <button type="button" className={index === trail.length - 1 ? 'text-white/80' : 'hover:text-white/70'} onClick={() => openFolder(folder.id)}>{folder.name}</button>
            </span>
          ))}
        </nav>
        <div className="mx-6 mb-7 mt-3 min-h-[176px] flex-1 overflow-y-auto" data-testid="studio-collect-folders">
          {space === 'team' ? (
            <p className="py-10 text-center text-sm text-white/50">{TEXT.teamEmpty}</p>
          ) : folders === null ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-white/50"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />読み込み中…</p>
          ) : (
            <ul role="listbox" aria-label="フォルダ">
              {shown.map(folder => (
                <li key={folder.id} className="flex items-center border-b border-white/[0.06]">
                  <button type="button" role="option" aria-selected={selectedId === folder.id} onClick={() => setSelectedId(folder.id)}
                    className={`flex min-w-0 flex-1 items-center gap-2 px-6 py-3 text-left text-sm transition ${selectedId === folder.id ? 'bg-[#20d0c4]/10 text-[#20d0c4]' : 'text-white/90 hover:bg-white/[0.05]'}`}>
                    <StudioFolderOpenIcon /><span className="truncate">{folder.name}</span>
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
        <div className="flex items-center gap-4 border-t border-white/10 px-6 py-4">
          <button type="button" disabled={space !== 'personal' || creating || busy !== null || !brandId || !cloudflareDataPlane} onClick={() => setCreating(true)}
            className="h-8 rounded-md bg-[#20d0c4] px-4 text-xs text-[#0f1718] disabled:opacity-40">{TEXT.newGroup}</button>
          <button type="button" disabled={busy !== null} onClick={onClose} className="ml-auto h-8 rounded-md bg-[#545d62] px-4 text-xs text-white hover:bg-[#5f686d] disabled:opacity-40">{TEXT.cancel}</button>
          <button type="button" disabled={!selected || busy !== null} onClick={() => void confirm()}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-[#20d0c4] px-4 text-xs text-[#0f1718] disabled:bg-[#454a4d] disabled:text-white/30">{busy === 'save' && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}{TEXT.confirm}</button>
        </div>
      </div>
    </div>
  );
}

/** 本家のフォルダの印（開いたフォルダ。奥の面は少し暗い青緑、手前の面は青緑の塗り。2026-11-12 本家の本番で拡大して見た）。 */
function StudioFolderOpenIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#20d0c4]" data-icon="folder-open-filled">
      <path fill="currentColor" opacity="0.6" d="M2 6.5A2.5 2.5 0 0 1 4.5 4h4.2l2 2.2h7.8A2.5 2.5 0 0 1 21 8.7V10H7.6a2.5 2.5 0 0 0-2.3 1.6L2 18.5z" />
      <path fill="currentColor" d="M7.6 11.6h14.2a1 1 0 0 1 .95 1.3l-2.3 6.6a2 2 0 0 1-1.9 1.4H3.4a1 1 0 0 1-.95-1.3l2.6-6.6a2.5 2.5 0 0 1 2.5-1.4z" />
    </svg>
  );
}
