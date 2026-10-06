import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { cloudflareDataPlane } from '../../lib/cloudflareApi';
import { generateImage, editImageWithPrompt } from '../../lib/imageApi';
import { resolveGeneratedImageUrlWithStatus } from '../../lib/storage';
import { isHeavyWorkspaceRuntime, isHeavyWorkspaceBrandName } from '../../lib/heavyWorkspace';
import { panStudioViewport, zoomStudioViewport, type StudioViewport } from '../../lib/studioViewport';
import { createSessionStore } from './sessionStore';
import { createEntryDraftStore, type DesignEntryDraft } from './entryDraftStore';
import { createDialogueStore } from './dialogueStore';
import { createDesignDialogueController, type DesignDialogueClient, type DesignDialogueState } from './designDialogueController';
import { designCanvasClient } from './designCanvasAdapter';
import { DESIGN_ENTRY_DRAFT_DB, DESIGN_ENTRY_SESSION_DB, designEntryClient, type DesignEntryClient } from './designEntryCoordinator';

const api = () => { if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured'); return cloudflareDataPlane; };
export const designDialogueClient: DesignDialogueClient = {
  ...designCanvasClient,
  sendAssistant: (input, context) => api().sendDesignAssistantRequest(input, context),
  readAssistant: (input, context) => api().readDesignAssistantRequest(input, context),
  readImage: (requestId) => api().readImageAIRequest(requestId),
  acknowledgeImage: (receipt) => api().acknowledgeImageAction(receipt),
  resolveImage: resolveGeneratedImageUrlWithStatus,
  async generate(input) {
    input.assertContext();
    const auth = useAuthStore.getState();
    const ready = Boolean(auth.user?.id && auth.currentBrand?.id === input.brandId
      && (!isHeavyWorkspaceRuntime() || isHeavyWorkspaceBrandName(auth.currentBrand.name)));
    if (!ready) throw new Error('design_generation_context_stale');
    const urls: string[] = [];
    for (const reference of input.references) {
      input.assertContext();
      const resolved = await resolveGeneratedImageUrlWithStatus(reference.storagePath); input.assertContext();
      if (!resolved.ok) throw new Error('design_reference_unavailable');
      urls.push(resolved.url);
    }
    const options = { rightsConfirmed: ready, idempotencyKey: input.idempotencyKey, assertContext: input.assertContext,
      retainUntilAcknowledged: input.retainUntilAcknowledged, featureType: 'design-dialogue' };
    return urls.length ? editImageWithPrompt(urls[0], input.prompt, input.brandId, { ...options, referenceImageUrls: urls.slice(1) })
      : generateImage(input.prompt, input.brandId, options);
  },
};
type ViewState = { identity: string; draft?: DesignEntryDraft; dialogue?: DesignDialogueState; busy?: boolean; error?: boolean };

/** Dedicated document view: no global Canvas store or implicit editor mount. */
export default function DesignEntryDetailPage({ client = designEntryClient, dialogueClient = designDialogueClient }:
  { client?: DesignEntryClient; dialogueClient?: DesignDialogueClient }) {
  const { user, currentBrand } = useAuthStore();
  const location = useLocation();
  const userId = user?.id ?? '';
  const brandId = currentBrand?.id ?? '';
  const params = new URLSearchParams(location.search);
  const projectId = params.get('projectId') ?? '';
  const conversationId = params.get('conversationId') ?? '';
  const identity = JSON.stringify([userId, brandId, projectId, conversationId]);
  const brandReady = Boolean(userId && brandId && (!isHeavyWorkspaceRuntime() || isHeavyWorkspaceBrandName(currentBrand?.name)));
  const generation = useRef(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ViewState>({ identity: '' });
  const [prompt, setPrompt] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [move, setMove] = useState(false);
  const [view, setView] = useState<StudioViewport>({ zoom: 0.6, panX: 20, panY: 20 });
  const [previews, setPreviews] = useState<{ identity: string; urls: Record<string, string> }>({ identity: '', urls: {} });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const controller = useRef<ReturnType<typeof createDesignDialogueController> | null>(null);
  const sending = useRef(false);
  const stores = useMemo(() => ({ sessions: createSessionStore({ idb: window.indexedDB, dbName: DESIGN_ENTRY_SESSION_DB }),
    drafts: createEntryDraftStore({ idb: window.indexedDB, dbName: DESIGN_ENTRY_DRAFT_DB }), dialogues: createDialogueStore({ idb: window.indexedDB }) }), []);
  useEffect(() => {
    if (isHeavyWorkspaceRuntime() && userId && !brandReady) void useAuthStore.getState().ensureHeavyWorkspace();
  }, [brandReady, userId]);
  useEffect(() => {
    const epoch = ++generation.current;
    const scope = { userId, brandId };
    // A durable winning dispatch survives StrictMode effect cleanup in the SAME authenticated scope.
    // Publication is separately fenced by epoch; changing user or brand stops every external operation.
    const assertContext = () => {
      const auth = useAuthStore.getState();
      if (auth.user?.id !== userId || auth.currentBrand?.id !== brandId) throw new Error('design_entry_scope_stale');
    };
    const assertView = () => { assertContext(); if (generation.current !== epoch) throw new Error('design_entry_view_stale'); };
    controller.current = null;
    sending.current = false;
    setSelected(null); setPrompt(''); setState({ identity, busy: brandReady });
    if (!brandReady || !projectId || !conversationId) {
      if (brandReady) setState({ identity, busy: false, error: true });
      return () => { if (generation.current === epoch) generation.current++; };
    }
    void (async () => {
      const draft = await stores.drafts.get(scope, projectId, conversationId); assertView();
      if (!draft?.ready) throw new Error('design_entry_association_missing');
      const operation = createDesignDialogueController({ scope, projectId, conversationId, ...stores,
        client: { ...dialogueClient, getDocument: client.getDocument }, assertContext,
        publish: (dialogue) => { try { assertView(); setState((previous) => ({ ...previous, identity, dialogue })); } catch { /* obsolete view */ } } });
      // Verify remote ownership and the local project/conversation association before exposing any draft text.
      await operation.refresh(); assertView();
      controller.current = operation;
      setState({ identity, draft, busy: true });
      await operation.initialize(draft); assertView();
      setState((previous) => ({ ...previous, busy: false }));
    })().catch(() => {
      try { assertView(); setState((previous) => ({ ...previous, identity, busy: false, error: true })); } catch { /* obsolete view */ }
    });
    return () => { if (generation.current === epoch) generation.current++; };
  }, [brandId, brandReady, client, conversationId, dialogueClient, identity, projectId, retry, stores, userId]);
  const visible = state.identity === identity ? state : undefined;
  const sources = [...new Set([
    ...(visible?.draft?.references.map((reference) => reference.storagePath) ?? []),
    ...(visible?.dialogue?.document.snapshot.objects.flatMap((object) => object.type === 'image' && typeof object.src === 'string' ? [object.src] : []) ?? []),
    ...(visible?.dialogue?.outputs.map((output) => output.storagePath) ?? []),
  ])];
  const sourceKey = JSON.stringify(sources);
  useEffect(() => {
    let active = true;
    const authMatches = () => { const auth = useAuthStore.getState(); return auth.user?.id === userId && auth.currentBrand?.id === brandId; };
    setPreviews((previous) => previous.identity === identity ? previous : { identity, urls: {} });
    void Promise.all((JSON.parse(sourceKey) as string[]).map(async (source) => {
      if (!authMatches()) return;
      try {
        const resolved = await dialogueClient.resolveImage(source);
        if (active && authMatches() && resolved.ok && resolved.url) setPreviews((previous) => ({ identity,
          urls: { ...(previous.identity === identity ? previous.urls : {}), [source]: resolved.url! } }));
      } catch { /* Canonical source remains visible for a subsequent scoped refresh. */ }
    }));
    return () => { active = false; };
  }, [brandId, dialogueClient, identity, sourceKey, userId]);
  const urls = previews.identity === identity ? previews.urls : {};
  async function act(operation: (active: NonNullable<typeof controller.current>) => Promise<void>) {
    if (!controller.current || sending.current || visible?.busy) return;
    const active = controller.current;
    const epoch = generation.current;
    sending.current = true;
    setState((previous) => ({ ...previous, busy: true, error: false }));
    try { await operation(active); }
    catch { if (generation.current === epoch) setState((previous) => ({ ...previous, error: true })); }
    finally { if (generation.current === epoch) { sending.current = false; setState((previous) => ({ ...previous, busy: false })); } }
  }
  const imageObjects = visible?.dialogue?.document.snapshot.objects.filter((object) => object.type === 'image' && object.visible !== false) ?? [];
  const selectedObject = imageObjects.find((object) => object.id === selected);
  const selectedOutput = selectedObject && visible?.dialogue?.outputs.some((output) => (selectedObject.metadata as Record<string, unknown> | undefined)?.imageId === output.imageId);
  return <main className="flex h-[calc(100dvh-64px)] min-h-[540px] flex-col bg-[#171b1c] text-white" data-testid="design-entry-detail">
    <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-4">
      <div className="flex items-center gap-5"><Link to="/designProduction" className="text-sm text-neutral-400">← デザインワークスペース</Link><h1 className="font-semibold">デザイン</h1></div>
      {visible?.dialogue && <Link data-testid="design-full-editor" to={`/canvas/${encodeURIComponent(projectId)}`} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Canvasで編集</Link>}
    </header>
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row" data-testid={visible?.draft ? 'design-entry-draft' : undefined} data-project-id={visible?.draft?.projectId} data-conversation-id={visible?.draft?.conversationId}>
      <section aria-label="デザインCanvas" className="relative min-h-[300px] flex-1 overflow-hidden bg-[#202526]" data-testid="design-own-canvas"
        style={{ backgroundImage: 'radial-gradient(#ffffff14 1px, transparent 1px)', backgroundSize: '20px 20px', cursor: move ? 'grab' : 'default' }}
        onPointerDown={(event) => {
          if (event.button !== 1 && !(move && event.button === 0)) return;
          if ((event.target as HTMLElement).closest('button, a')) return;
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
        }} onPointerMove={(event) => {
          const previous = drag.current; if (!previous || previous.id !== event.pointerId) return;
          setView((current) => panStudioViewport(current, event.clientX - previous.x, event.clientY - previous.y));
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }} onPointerUp={(event) => { if (drag.current?.id === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
        onPointerCancel={() => { drag.current = null; }}
        onWheel={(event) => {
          if ((event.target as HTMLElement).closest('button, a')) return;
          const rect = event.currentTarget.getBoundingClientRect();
          setView((current) => event.ctrlKey || event.metaKey ? zoomStudioViewport(current, current.zoom * Math.exp(-event.deltaY * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top })
            : panStudioViewport(current, -event.deltaX, -event.deltaY));
        }}>
        <div className="absolute left-4 top-4 z-20 flex gap-2 rounded-xl border border-white/10 bg-[#171b1c] p-2 text-sm">
          <button type="button" aria-label="画像を選択" aria-pressed={!move} onClick={() => setMove(false)} className="rounded px-3 py-1">選択</button>
          <button type="button" aria-label="Canvasを移動" aria-pressed={move} onClick={() => setMove(true)} className="rounded px-3 py-1">移動</button>
          <button type="button" aria-label="縮小" onClick={() => setView((current) => zoomStudioViewport(current, current.zoom / 1.2, { x: 200, y: 200 }))}>−</button>
          <span data-testid="design-zoom" className="px-2">{Math.round(view.zoom * 100)}%</span>
          <button type="button" aria-label="拡大" onClick={() => setView((current) => zoomStudioViewport(current, current.zoom * 1.2, { x: 200, y: 200 }))}>＋</button>
          <button type="button" onClick={() => setView({ zoom: 0.6, panX: 20, panY: 20 })}>表示を戻す</button>
        </div>
        <div className="absolute origin-top-left" data-testid="design-canvas-world" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
          {imageObjects.map((object) => <button key={String(object.id)} type="button" data-testid="design-canvas-layer" data-object-id={String(object.id)} aria-label={String(object.label ?? 'デザイン画像')}
            aria-pressed={object.id === selected} onClick={() => { if (!move) setSelected(String(object.id)); }}
            className={`absolute overflow-hidden rounded-lg bg-white/5 ${object.id === selected ? 'ring-4 ring-[#b8dc58]' : 'ring-1 ring-white/10'}`}
            style={{ left: Number(object.x) || 0, top: Number(object.y) || 0, width: Number(object.width) || 440, height: Number(object.height) || 440,
              transform: `rotate(${Number(object.rotation) || 0}deg) scale(${Number(object.scaleX) || 1}, ${Number(object.scaleY) || 1})`, opacity: typeof object.opacity === 'number' ? object.opacity : 1, zIndex: Number(object.zIndex) || 0 }}>
            {typeof object.src === 'string' && urls[object.src] ? <img src={urls[object.src]} alt={String(object.label ?? 'デザイン画像')} className="h-full w-full object-contain" draggable={false} /> : <span className="text-sm text-neutral-400">画像を読み込んでいます</span>}
          </button>)}
        </div>
        {!imageObjects.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-neutral-400"><p>{visible?.busy ? 'デザインを作成しています' : '作成した画像がここに表示されます'}</p></div>}
      </section>
      <aside className="flex min-h-0 w-full shrink-0 flex-col border-l border-white/10 bg-[#171b1c] lg:w-[390px]" aria-label="デザインアシスタント">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <h2 className="mb-5 text-sm font-semibold">デザインアシスタント</h2>
          {visible?.draft && <ol className="mb-4 flex flex-wrap gap-2" aria-label="参考画像">{visible.draft.references.map((reference) => <li key={reference.order} data-testid="design-entry-reference" data-image-id={reference.imageId} data-storage-path={reference.storagePath} className="w-16">
            {urls[reference.storagePath] && <img src={urls[reference.storagePath]} alt={reference.name} className="h-16 w-16 rounded-lg object-contain bg-white/5" />}
            <span className="block truncate text-xs text-neutral-400">{reference.name}</span>
          </li>)}</ol>}
          {!visible?.dialogue?.attempts.length && visible?.draft && <p data-testid="design-entry-prompt" className="whitespace-pre-wrap rounded-xl bg-white/5 p-4 text-sm">{visible.draft.prompt}</p>}
          {visible?.dialogue?.attempts.map((attempt, index) => <article key={attempt.input.requestId} className="mb-5" data-testid="design-dialogue-attempt">
            <p data-testid={index === 0 ? 'design-entry-prompt' : 'design-user-message'} className="whitespace-pre-wrap rounded-xl bg-white/5 p-4 text-sm">{attempt.input.prompt}</p>
            {attempt.assistant.state === 'completed' ? <p data-testid="design-assistant-message" className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">{attempt.assistant.content}</p>
              : <p className="mt-3 text-sm text-neutral-400">{attempt.assistant.state === 'failed' ? '応答を取得できませんでした。指示を編集してもう一度送信できます。' : '応答の状態を確認しています。'}</p>}
            <div className="mt-3 flex flex-wrap gap-2" aria-label="生成画像">{visible.dialogue?.turns.find((turn) => turn.clientRequestKey === attempt.imageClientRequestKey)?.outputs.map((output) =>
              <div key={output.imageId} data-testid="design-generated-preview" data-image-id={output.imageId} className="w-24">
                {urls[output.storagePath] && <img src={urls[output.storagePath]} alt="生成したデザイン" className="h-28 w-24 rounded-lg bg-white/5 object-contain" />}
              </div>)}</div>
            {attempt.assistant.state === 'completed' && !attempt.imageAttempted && <button type="button" disabled={visible.busy} className="mt-3 text-sm text-[#b8dc58]" onClick={() => void act((active) => active.continueImage(attempt.input.requestId))}>画像を作成</button>}
            {attempt.imageAttempted && attempt.imageResult !== 'completed' && <p className="mt-3 text-sm text-neutral-400">{attempt.imageResult === 'failed' ? '画像を作成できませんでした。以前の画像はそのまま使用できます。'
              : attempt.imageResult === 'ack-deferred' ? '画像を保存しました。生成記録の確認を続けられます。' : '画像の作成・保存状態を確認しています。'}</p>}
            {(attempt.assistant.state === 'running' || attempt.assistant.state === 'unknown' || (attempt.imageAttempted && !['completed', 'failed'].includes(attempt.imageResult ?? '')))
              && <button type="button" data-testid="design-attempt-reconcile" disabled={visible.busy} className="mt-3 text-sm text-[#b8dc58]" onClick={() => void act((active) => active.reconcile(attempt.input.requestId))}>作成状態を再確認</button>}
          </article>)}
          {visible?.error && <div role="alert" data-testid="design-entry-recovery" className="my-4 rounded-lg bg-white/5 p-4 text-sm"><p>保存・作成状態を確認できませんでした。入力と以前の画像は保持されています。</p>
            <button type="button" disabled={visible.busy} className="mt-3 text-[#b8dc58]" onClick={() => setRetry((value) => value + 1)}>保存状態を再確認</button></div>}
          {!visible?.draft && <p role="status" className="text-sm text-neutral-400">保存状態を確認しています。</p>}
          {!!imageObjects.length && <section className="mt-6 border-t border-white/10 pt-4"><h2 className="mb-3 text-sm">レイヤー</h2><ol>{imageObjects.map((object) => <li key={String(object.id)}><button type="button" data-testid="design-layer-select" aria-pressed={selected === object.id}
            onClick={() => setSelected(String(object.id))} className={`mb-2 w-full rounded-lg px-3 py-2 text-left text-sm ${selected === object.id ? 'bg-white/10' : ''}`}>{String(object.label ?? 'デザイン画像')}</button></li>)}</ol></section>}
        </div>
        <form className="shrink-0 border-t border-white/10 p-4" onSubmit={(event) => { event.preventDefault(); const text = prompt; if (!text.trim()) return;
          void act(async (active) => { await active.send(text, selectedOutput ? [] : visible?.draft?.references ?? [], selectedOutput ? selected! : undefined); if (generation.current && controller.current === active) setPrompt(''); }); }}>
          {selectedOutput && <div className="mb-2 flex items-center justify-between text-xs text-[#b8dc58]"><span>選択した画像を参考に編集</span><button type="button" onClick={() => setSelected(null)} aria-label="選択を解除">×</button></div>}
          <textarea data-testid="design-followup-prompt" aria-label="デザインの指示" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={4000}
            placeholder="デザインの変更や追加の指示を入力" rows={3} className="w-full resize-none rounded-xl border border-white/10 bg-white/5 p-3 text-sm outline-none focus:border-[#b8dc58]" />
          <div className="mt-2 flex justify-end"><button type="submit" data-testid="design-followup-send" disabled={!prompt.trim() || visible?.busy || !visible?.dialogue}
            className="rounded-lg bg-[#b8dc58] px-5 py-2 text-sm font-semibold text-[#171b1c] disabled:opacity-40">{visible?.busy ? '作成中…' : '送信'}</button></div>
        </form>
      </aside>
    </div>
  </main>;
}
