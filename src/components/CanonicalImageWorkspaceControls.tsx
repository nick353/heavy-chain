import type { CanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';

/** Additional editing controls leave the canonical empty upload canvas intact. */
export function CanonicalImageWorkspaceControls({workspace,onSourceEdit,statusOnly=false}: {workspace:CanonicalImageWorkspace;onSourceEdit?:()=>void;statusOnly?:boolean}) {
  if (!workspace.jobId && !workspace.slots.primary && !workspace.pendingId) return null;
  const locked = workspace.status==='running' || workspace.status==='loading' || Boolean(workspace.pendingId);
  // Pages that already have their own input form only need the request status, not a second form.
  if (statusOnly) {
    // While a request is in flight the page shows its own progress; only a request left unresolved needs this box.
    const unresolved = Boolean(workspace.pendingId) && workspace.status!=='running';
    if (!unresolved && !workspace.error) return null;
    return <section className="absolute bottom-4 right-4 z-20 w-[280px] rounded-xl border border-white/10 bg-[#202426] p-3 text-sm text-neutral-200" data-testid="canonical-image-workspace-controls">
      {workspace.error && <p role="alert" className="text-amber-200">{workspace.error}</p>}
      {unresolved && <p>前回の依頼の結果をまだ受け取れていません。</p>}
      {unresolved && <button type="button" onClick={()=>void workspace.reconcile()} className="mt-2 rounded bg-white/10 px-3 py-2 disabled:opacity-40">同じ依頼を照合</button>}
    </section>;
  }
  return <section className="absolute right-4 top-6 z-20 w-[280px] rounded-xl border border-white/10 bg-[#202426] p-3 text-sm text-neutral-200" data-testid="canonical-image-workspace-controls">
    <p className="font-semibold">入力と生成</p>
    <div className="mt-3 space-y-3">
      {workspace.slots.primary && <div><p className="truncate text-xs">{workspace.slots.primary.name}</p><img src={workspace.slots.primary.imageUrl} alt="現在の主素材" data-source-slot="primary" data-source-image-id={workspace.slots.primary.sourceImageId??''} data-source-storage-path={workspace.slots.primary.sourceStoragePath??''} className="h-16 w-full object-contain" /></div>}
      <label className="block">依頼<textarea disabled={locked} aria-label="依頼" value={workspace.brief} onChange={e=>workspace.setBrief(e.target.value)} className="mt-1 h-20 w-full rounded bg-black/20 p-2" /></label>
      <label className="block">参考メモ<textarea disabled={locked} aria-label="参考メモ" value={workspace.referenceNote} onChange={e=>workspace.setReferenceNote(e.target.value)} className="mt-1 h-16 w-full rounded bg-black/20 p-2" /></label>
      <label className="block">追加の参考画像<input disabled={locked} type="file" accept="image/*" aria-label="追加の参考画像" onChange={e=>{const file=e.target.files?.[0];if(file){onSourceEdit?.();void workspace.upload('secondary',file);}e.target.value='';}} className="mt-1 w-full text-xs" /></label>
      {workspace.slots.secondary && <img src={workspace.slots.secondary.imageUrl} alt="追加の参考画像" data-source-slot="secondary" data-source-image-id={workspace.slots.secondary.sourceImageId??''} data-source-storage-path={workspace.slots.secondary.sourceStoragePath??''} className="h-16 w-full object-contain" />}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={locked||!workspace.brief.trim()} onClick={()=>void workspace.generate()} className="rounded bg-cyan-700 px-3 py-2 disabled:opacity-40">生成</button>
        <button type="button" disabled={locked||!workspace.brief.trim()||!workspace.slots.primary} onClick={()=>void workspace.editSource()} className="rounded bg-white/10 px-3 py-2 disabled:opacity-40">素材を編集</button>
        <button type="button" disabled={locked||!workspace.brief.trim()||!workspace.result?.storagePath} onClick={()=>void workspace.editResult()} className="rounded bg-white/10 px-3 py-2 disabled:opacity-40">保存結果を編集</button>
        {workspace.pendingId && <button type="button" disabled={workspace.status==='running'} onClick={()=>void workspace.reconcile()} className="rounded bg-white/10 px-3 py-2 disabled:opacity-40">同じ依頼を照合</button>}
      </div>
      {workspace.status==='saved' && <p role="status">保存済み</p>}
      {workspace.status==='running' && <p role="status">処理中</p>}
      {workspace.error && <p role="alert" className="text-amber-200">{workspace.error}</p>}
      {workspace.result && <img src={workspace.result.imageUrl} alt="保存された生成結果" className="max-h-40 w-full rounded object-contain" />}
    </div>
  </section>;
}
