import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Funnel, Loader2, SquareMousePointer, SquarePlus, Trash2, Upload, X, ZoomIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { foundImageFile, type FoundImage } from '../../features/designDetail/referenceImageSearch';
import { FOUND_IMAGE_SOURCES_NOTE, FoundImageCredit } from '../../features/designDetail/FoundImageCredit';
import {
  STUDIO_IMAGE_SEARCH_ANALYSIS_EDGE, STUDIO_IMAGE_SEARCH_CATEGORIES, STUDIO_IMAGE_SEARCH_MIN_ANALYSIS_MS, STUDIO_IMAGE_SEARCH_NOTE_MAX,
  STUDIO_IMAGE_SEARCH_QUERIES_PER_ROUND, STUDIO_IMAGE_SEARCH_SIZE, STUDIO_IMAGE_SEARCH_STORED_EDGE, STUDIO_IMAGE_SEARCH_TEXT as T,
  loadStudioSearchConversations, nextStudioSearchQueries, removeStudioSearchConversation, saveStudioSearchConversations, searchStudioAccessoryRound,
  shownStudioSearchImages, studioSearchAskText, studioSearchHistoryStamp, studioSearchId, studioSearchMoreDisabled, upsertStudioSearchConversation,
  type StudioImageSearchCategory, type StudioSearchConversation, type StudioSearchTurn,
} from '../../lib/studioImageSearch';
import { planStudioAccessories, studioImagePayloads, studioPayloadFromDataUrl } from '../../lib/studioImageSearchApi';

export type StudioImageSearchRequest = { id: string; imageUrl: string };
export type StudioImageSearchPanelProps = {
  projectId: string;
  brandId: string;
  /** 帯の「画像検索」を押すたびに新しい id で渡す（本家の analysisImage）。 */
  request: StudioImageSearchRequest | null;
  /** 結果を押したとき（本家の「キャンバスに送信」）。File は取り込める画像、image は作者とライセンス。 */
  onSendToCanvas(file: File, image: FoundImage): void | Promise<void>;
  expanded?: boolean;
  onExpandedChange?(open: boolean): void;
  /** 本家の「キャンバスから選択」: キャンバスで画像を1枚選ばせ、その画像の住所を返す（選ばなければ null）。無ければ押せない。 */
  onSelectFromCanvas?(): Promise<string | null | undefined>;
  /** 本家はポイントの表示を欄の左に付けている（欄の幅が変わると一緒に動く）。 */
  pointsSlot?: ReactNode;
  className?: string;
};

type Step = 'upload' | 'analysis' | 'conversation';
const storage = () => { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 本家の agent_icon（丸い虫眼鏡に「AI」、青緑から紫）。 */
function AgentIcon({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <defs><linearGradient id="studio-search-agent" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse"><stop stopColor="#00E7DA" /><stop offset="1" stopColor="#B78AFF" /></linearGradient></defs>
    <circle cx="10.5" cy="10.5" r="7.5" stroke="url(#studio-search-agent)" strokeWidth="2" />
    <path d="M16.2 16.2 21 21" stroke="url(#studio-search-agent)" strokeWidth="2.2" strokeLinecap="round" />
    <text x="10.5" y="13.4" textAnchor="middle" fontSize="7.6" fontWeight="700" fontFamily="system-ui, sans-serif" fill="url(#studio-search-agent)">AI</text>
  </svg>;
}

/** 本家の conversation_list（3本の線と時計）。 */
function HistoryIcon() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M3 5h11M3 9.5h6M3 14h4" /><circle cx="14" cy="13.5" r="3.6" /><path d="M14 11.8v1.8l1.2.8" />
  </svg>;
}

export function StudioImageSearchPanel({ projectId, brandId, request, onSendToCanvas, expanded, onExpandedChange, onSelectFromCanvas, pointsSlot, className }: StudioImageSearchPanelProps) {
  const [ownExpanded, setOwnExpanded] = useState(false);
  const open = expanded ?? ownExpanded;
  const setOpen = useCallback((next: boolean) => { if (expanded === undefined) setOwnExpanded(next); onExpandedChange?.(next); }, [expanded, onExpandedChange]);
  const [conversations, setConversations] = useState<StudioSearchConversation[]>(() => loadStudioSearchConversations(storage(), projectId));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('upload');
  const [busy, setBusy] = useState(false);
  const [precise, setPrecise] = useState(false);
  const [category, setCategory] = useState<StudioImageSearchCategory>(STUDIO_IMAGE_SEARCH_CATEGORIES[0].value);
  const [note, setNote] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [preview, setPreview] = useState<FoundImage | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  /** 縮小が読めなかった画像（Openverse の縮小は混むと返らない）は出さない。 */
  const [brokenIds, setBrokenIds] = useState<ReadonlySet<string>>(() => new Set());
  const stepRef = useRef<Step>('upload');
  const conversationsRef = useRef(conversations);
  const handledRequest = useRef<string | null>(null);
  const runRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const active = useMemo(() => conversations.find((item) => item.id === activeId) ?? null, [conversations, activeId]);

  const goStep = useCallback((next: Step) => { stepRef.current = next; setStep(next); }, []);
  /** 会話を書き換えて、この端末に残す（同じ会話の最新の形を ref からも引けるようにする）。 */
  const commit = useCallback((conversation: StudioSearchConversation) => {
    const next = saveStudioSearchConversations(storage(), projectId, upsertStudioSearchConversation(conversationsRef.current, conversation));
    conversationsRef.current = next;
    setConversations(next);
  }, [projectId]);
  const latest = useCallback((id: string) => conversationsRef.current.find((item) => item.id === id) ?? null, []);

  // プロジェクトが変わったら、そのプロジェクトの会話を読み直して最初の画面へ。
  useEffect(() => {
    runRef.current?.abort();
    const list = loadStudioSearchConversations(storage(), projectId);
    conversationsRef.current = list;
    setConversations(list);
    setActiveId(null); goStep('upload'); setBusy(false); setPrecise(false); setNote('');
  }, [projectId, goStep]);
  useEffect(() => () => runRef.current?.abort(), []);
  // 本家: 高精度検索を切ると説明を消す。
  useEffect(() => { if (!precise) setNote(''); }, [precise]);
  // 新しい吹き出しや結果が来たら下まで送る。
  useEffect(() => { const box = scrollRef.current; if (box) box.scrollTop = box.scrollHeight; }, [active?.turns.length, busy, step]);
  // 一覧の外を押したら閉じる。
  useEffect(() => {
    if (!historyOpen) return;
    const close = (event: PointerEvent) => { if (!historyRef.current?.contains(event.target as Node)) setHistoryOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [historyOpen]);

  /** 1回分（12枚）を探して、会話の最後に足す。 */
  const runRound = useCallback(async (conversationId: string, queries: string[], signal: AbortSignal) => {
    const base = latest(conversationId);
    if (!base) return;
    let images: FoundImage[] = [];
    try { images = await searchStudioAccessoryRound(queries, { shown: shownStudioSearchImages(base), signal }); }
    catch (error) { if (signal.aborted) return; console.warn('studio image search failed', error); toast.error(T.failed); }
    if (signal.aborted) return;
    const now = latest(conversationId);
    if (!now) return;
    commit({ ...now, updatedAt: Date.now(), turns: [...now.turns, { id: studioSearchId('results'), kind: 'results', images }] });
  }, [commit, latest]);

  /** 本家の analysisImage: 欄を開いて「画像を解析中…」→ 新しい会話。失敗したら最初の画面へ戻してお知らせ。 */
  const analyse = useCallback(async (imageUrl: string) => {
    if (stepRef.current === 'analysis') return;
    runRef.current?.abort();
    const controller = new AbortController();
    runRef.current = controller;
    setOpen(true); setHistoryOpen(false); setPrecise(false); goStep('analysis');
    try {
      const [large, stored] = await studioImagePayloads(imageUrl, [STUDIO_IMAGE_SEARCH_ANALYSIS_EDGE, STUDIO_IMAGE_SEARCH_STORED_EDGE]);
      const [planned] = await Promise.all([planStudioAccessories(brandId, large), wait(STUDIO_IMAGE_SEARCH_MIN_ANALYSIS_MS)]);
      if (controller.signal.aborted) return;
      const { queries, rest } = nextStudioSearchQueries({ queries: planned });
      const now = Date.now();
      const conversation: StudioSearchConversation = { id: studioSearchId('search', now), createdAt: now, updatedAt: now, imageUrl: stored.dataUrl,
        queries: rest, usedQueries: queries, turns: [{ id: studioSearchId('ask', now), kind: 'ask', text: T.firstAsk, imageUrl: stored.dataUrl }] };
      commit(conversation);
      setActiveId(conversation.id); goStep('conversation'); setBusy(true);
      await runRound(conversation.id, queries, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('studio image analysis failed', error);
      toast.error(T.failed);
      goStep('upload');
    } finally {
      if (runRef.current === controller) { setBusy(false); runRef.current = null; }
    }
  }, [brandId, commit, goStep, runRound, setOpen]);

  // 帯の「画像検索」（新しい id のときだけ）。
  useEffect(() => {
    if (!request || handledRequest.current === request.id) return;
    handledRequest.current = request.id;
    void analyse(request.imageUrl);
  }, [request, analyse]);

  /** 本家の「さらに検索」（高精度検索ならカテゴリーと説明で）。 */
  const searchMore = useCallback(async () => {
    if (!active || studioSearchMoreDisabled({ busy, precise, note })) return;
    const askTurn: StudioSearchTurn = { id: studioSearchId('ask'), kind: 'ask', text: studioSearchAskText(precise ? { category, note } : null) };
    const before = active;
    commit({ ...before, updatedAt: Date.now(), turns: [...before.turns, askTurn] });
    const controller = new AbortController();
    runRef.current?.abort();
    runRef.current = controller;
    setBusy(true);
    try {
      let queries: string[]; let rest = before.queries;
      if (precise) {
        queries = (await planStudioAccessories(brandId, studioPayloadFromDataUrl(before.imageUrl), { category, note: note.trim(), exclude: before.usedQueries, count: STUDIO_IMAGE_SEARCH_QUERIES_PER_ROUND })).slice(0, STUDIO_IMAGE_SEARCH_QUERIES_PER_ROUND);
      } else {
        const next = nextStudioSearchQueries(before);
        if (next.queries.length) ({ queries, rest } = next);
        else ({ queries, rest } = nextStudioSearchQueries({ queries: await planStudioAccessories(brandId, studioPayloadFromDataUrl(before.imageUrl), { exclude: before.usedQueries }) }));
      }
      if (controller.signal.aborted) return;
      const now = latest(before.id);
      if (!now) return;
      commit({ ...now, queries: rest, usedQueries: [...now.usedQueries, ...queries] });
      // 本家: 高精度検索で送ったら閉じる（closePreciseSearch）。
      if (precise) setPrecise(false);
      await runRound(before.id, queries, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('studio image search plan failed', error);
      toast.error(T.failed);
      const now = latest(before.id);
      if (now) commit({ ...now, turns: now.turns.filter((turn) => turn.id !== askTurn.id) });
    } finally {
      if (runRef.current === controller) { setBusy(false); runRef.current = null; }
    }
  }, [active, brandId, busy, category, commit, latest, note, precise, runRound]);

  const startNewConversation = () => { runRef.current?.abort(); setBusy(false); if (!open) setOpen(true); setActiveId(null); setPrecise(false); goStep('upload'); };
  const openConversation = (id: string) => { runRef.current?.abort(); setBusy(false); setActiveId(id); goStep('conversation'); setOpen(true); setHistoryOpen(false); };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    const next = saveStudioSearchConversations(storage(), projectId, removeStudioSearchConversation(conversationsRef.current, deleteTarget));
    conversationsRef.current = next; setConversations(next);
    toast.success(T.deleted);
    if (deleteTarget === activeId) { runRef.current?.abort(); setBusy(false); setActiveId(null); goStep('upload'); }
    setDeleteTarget(null);
  };
  const pickFile = (file: File | undefined) => {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return;
    const url = URL.createObjectURL(file);
    void analyse(url).finally(() => URL.revokeObjectURL(url));
  };
  const selectFromCanvas = async () => {
    if (!onSelectFromCanvas) return;
    try { const url = await onSelectFromCanvas(); if (url) void analyse(url); }
    catch { toast.error(T.failed); }
  };
  const send = async (image: FoundImage) => {
    if (sendingId) return;
    setSendingId(image.id);
    try { await onSendToCanvas(await foundImageFile(image), image); toast.success(T.sent); }
    catch (error) { console.warn('studio image send failed', error); toast.error(T.failed); }
    finally { setSendingId(null); }
  };

  const iconButton = `flex h-6 w-6 items-center justify-center rounded text-[#c3c9ca] hover:text-white [[data-studio-theme=light]_&]:text-[#474d4f] [[data-studio-theme=light]_&]:hover:text-[#1c1f21]`;
  return <section data-testid="studio-image-search" data-step={step} data-expanded={open ? 'true' : 'false'} aria-label={T.title}
    className={`${className ?? 'absolute right-4 top-[23px] z-30'} flex flex-col rounded-xl border border-[#3b3f40] bg-[#262a2b] text-[#e3e8e8] shadow-xl transition-[width,height] duration-300 ease-in-out [[data-studio-theme=light]_&]:border-black/10 [[data-studio-theme=light]_&]:bg-white [[data-studio-theme=light]_&]:text-[#1c1f21]`}
    style={{ width: open ? STUDIO_IMAGE_SEARCH_SIZE.expandedWidth : STUDIO_IMAGE_SEARCH_SIZE.collapsedWidth, height: open ? STUDIO_IMAGE_SEARCH_SIZE.expandedHeight : STUDIO_IMAGE_SEARCH_SIZE.collapsedHeight }}>
    {pointsSlot && <div className="absolute right-full top-0 mr-2 whitespace-nowrap" data-testid="studio-image-search-points">{pointsSlot}</div>}
    <header className={`relative flex h-[46px] shrink-0 items-center justify-between px-3 ${open ? `border-b border-[#3b3f40] [[data-studio-theme=light]_&]:border-black/10` : ''}`}>
      <div className="flex min-w-0 items-center gap-1">
        <AgentIcon />
        <h3 className="truncate bg-gradient-to-l from-[#B78AFF] to-[#00E7DA] bg-clip-text text-base leading-4 text-transparent">{T.title}</h3>
      </div>
      <div className="flex flex-none items-center gap-2">
        <div ref={historyRef} className="relative flex items-center">
          <button type="button" data-testid="studio-image-search-history" aria-label={T.historyTooltip} title={T.historyTooltip} aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)} className={iconButton}><HistoryIcon /></button>
          {historyOpen && <div data-testid="studio-image-search-history-list" className={`absolute right-[-100px] top-8 z-40 flex max-h-[500px] w-[382px] flex-col overflow-hidden rounded-2xl border border-[#0bcabc]/70 bg-[#262a2b] shadow-2xl [[data-studio-theme=light]_&]:bg-white`}>
            <p className="shrink-0 px-3 py-3 text-base leading-4">{T.history}</p>
            <div className="min-h-0 flex-1 overflow-y-auto py-3 pl-3 pr-2">
              {conversations.length === 0
                ? <p className="py-12 text-center text-sm text-[#8a9294]">{T.historyEmpty}</p>
                : <>
                  <div className="flex flex-wrap gap-3">{conversations.map((item) => {
                    const stamp = studioSearchHistoryStamp(item.createdAt);
                    return <div key={item.id} role="button" tabIndex={0} data-testid="studio-image-search-history-item" onClick={() => openConversation(item.id)}
                      onKeyDown={(event) => { if (event.key === 'Enter') openConversation(item.id); }}
                      className={`group flex w-[172px] cursor-pointer items-center justify-between overflow-hidden rounded-lg p-2 transition-colors ${item.id === activeId ? 'bg-[#33403f]' : 'bg-[#2e3436]'} hover:bg-[#33403f] [[data-studio-theme=light]_&]:bg-[#f2f4f5]`}>
                      <div className="flex items-center gap-2">
                        <img src={item.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                        <div className="flex flex-col justify-center gap-1 text-base leading-4 text-[#8a9294]"><p>{stamp.date}</p><p>{stamp.time}</p></div>
                      </div>
                      <button type="button" aria-label={T.delete} title={T.delete} data-testid="studio-image-search-history-delete"
                        onClick={(event) => { event.stopPropagation(); setDeleteTarget(item.id); }} className="flex h-5 w-5 shrink-0 items-center justify-center text-[#e3e8e8] hover:text-white"><Trash2 className="h-4 w-4" /></button>
                    </div>;
                  })}</div>
                  <p className="py-4 text-center text-sm text-[#8a9294]">{T.historyEnd}</p>
                </>}
            </div>
          </div>}
        </div>
        <button type="button" data-testid="studio-image-search-new" aria-label={T.newConversation} title={T.newConversation} onClick={startNewConversation}
          className="flex h-6 w-6 items-center justify-center text-[#0bcabc] hover:brightness-110"><SquarePlus className="h-5 w-5" /></button>
        <div className={`mx-1 h-5 w-px bg-[#3b3f40] [[data-studio-theme=light]_&]:bg-black/10`} />
        <button type="button" data-testid="studio-image-search-toggle" aria-label={open ? T.collapse : T.expand} title={open ? T.collapse : T.expand} aria-expanded={open}
          onClick={() => setOpen(!open)} className={iconButton}>{open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</button>
      </div>
    </header>

    {open && <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {(step === 'upload' || (step === 'conversation' && !active)) && <div data-testid="studio-image-search-upload" className="relative flex h-full w-full flex-col items-center overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-[260px] w-[400px] -translate-x-1/2 bg-[radial-gradient(ellipse_at_35%_45%,rgba(0,231,218,0.16),transparent_55%),radial-gradient(ellipse_at_70%_60%,rgba(183,138,255,0.22),transparent_60%)]" />
        <div className="relative z-10 flex w-full flex-col gap-10 px-6 py-10">
          <div className="flex w-full flex-col items-center gap-[9px]">
            <AgentIcon size={64} />
            <p className="whitespace-pre-wrap text-center text-sm leading-4 text-[#8a9294]">{T.welcome}</p>
          </div>
          <div className="flex w-full flex-col gap-[9px] py-3">
            <button type="button" data-testid="studio-image-search-upload-button" onClick={() => fileRef.current?.click()}
              className={`flex h-[120px] w-full items-center justify-center rounded-xl bg-[#313536] p-3 transition-colors hover:bg-[#3a3f40] [[data-studio-theme=light]_&]:bg-[#f2f4f5]`}>
              <span className="flex flex-col items-center gap-1"><Upload className="h-6 w-6" /><span className="whitespace-nowrap text-sm leading-4 text-[#c3c9ca]">{T.upload}</span></span>
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" data-testid="studio-image-search-file"
              onChange={(event) => { pickFile(event.target.files?.[0]); event.target.value = ''; }} />
            <button type="button" data-testid="studio-image-search-from-canvas" onClick={() => void selectFromCanvas()} disabled={!onSelectFromCanvas} title={onSelectFromCanvas ? undefined : T.noCanvas}
              className={`flex h-[120px] w-full items-center justify-center rounded-xl bg-[#313536] p-3 transition-colors hover:bg-[#3a3f40] disabled:cursor-not-allowed disabled:opacity-50 [[data-studio-theme=light]_&]:bg-[#f2f4f5]`}>
              <span className="flex flex-col items-center gap-1"><SquareMousePointer className="h-6 w-6" /><span className="whitespace-nowrap text-sm leading-4 text-[#c3c9ca]">{T.fromCanvas}</span></span>
            </button>
          </div>
        </div>
      </div>}

      {step === 'analysis' && <div data-testid="studio-image-search-analysis" className="relative flex h-60 flex-col items-center justify-center gap-3.5 overflow-hidden px-14">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(0,231,218,0.18),transparent_45%),radial-gradient(circle_at_60%_55%,rgba(183,138,255,0.2),transparent_55%)]" />
        <div className="relative flex h-[100px] w-[100px] items-center justify-center">
          <span className="absolute inset-2 animate-ping rounded-full bg-[#0bcabc]/20" />
          <AgentIcon size={56} />
        </div>
        <p className="relative text-base leading-4 text-[#8a9294]">{T.analyzing}</p>
      </div>}

      {step === 'conversation' && active && <>
        <div ref={scrollRef} data-testid="studio-image-search-conversation" className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          {active.turns.map((turn) => turn.kind === 'ask'
            ? <div key={turn.id} className="mb-4 flex justify-end">
              <div data-testid="studio-image-search-ask" className="flex w-fit max-w-full flex-col items-start gap-y-2 rounded-xl rounded-tr-sm bg-[#0bcabc] p-2 text-[#0e1314]">
                {turn.imageUrl && <img src={turn.imageUrl} alt="" className="h-10 w-10 rounded-md object-cover" />}
                <p className="text-base leading-6">{turn.text}</p>
              </div>
            </div>
            : <div key={turn.id} className="mb-4 flex">
              {turn.images.length === 0
                ? <div className={`rounded-xl rounded-tl-sm bg-[#4f5d5e] p-3 text-base leading-6 [[data-studio-theme=light]_&]:bg-[#eef1f2]`}>{T.notFound}</div>
                : <div data-testid="studio-image-search-results" className={`w-fit overflow-hidden rounded-xl rounded-tl-sm bg-[#4f5d5e] p-3 [&_[data-testid=found-image-credit]]:text-[#c3c9ca] [[data-studio-theme=light]_&]:[&_[data-testid=found-image-credit]]:text-[#6c7477] [[data-studio-theme=light]_&]:bg-[#eef1f2]`}>
                  <div className="flex flex-wrap gap-2.5">{turn.images.filter((image) => !brokenIds.has(image.id)).map((image) => <div key={image.id} className="w-[108px] min-w-0">
                    <div className="group relative h-[144px] w-[108px] cursor-pointer overflow-hidden rounded-lg bg-white" data-testid="studio-image-search-tile"
                      onClick={() => void send(image)} title={`${image.title}${image.license ? `（${image.license}）` : ''}`}>
                      <img src={image.thumbUrl} alt={image.title} loading="lazy" className="h-full w-full object-cover"
                        onError={() => setBrokenIds((current) => new Set(current).add(image.id))} />
                      <div className={`absolute inset-0 z-10 bg-black/40 ${sendingId === image.id ? 'visible' : 'invisible group-hover:visible'}`} />
                      <span className={`absolute inset-0 z-[11] m-auto flex h-fit items-center justify-center whitespace-nowrap text-center text-[13px] leading-5 text-white ${sendingId === image.id ? 'visible' : 'invisible group-hover:visible'}`}>
                        {sendingId === image.id ? <Loader2 className="h-4 w-4 animate-spin" /> : T.sendToCanvas}
                      </span>
                      <button type="button" aria-label={T.preview} title={T.preview} data-testid="studio-image-search-zoom"
                        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setPreview(image); }}
                        className="invisible absolute bottom-2.5 left-2.5 z-[12] flex h-6 w-6 items-center justify-center rounded-sm bg-black/60 text-white group-hover:visible"><ZoomIn className="h-4 w-4" /></button>
                    </div>
                    <FoundImageCredit image={image} />
                  </div>)}</div>
                  <p className="mt-2 text-[10px] text-[#c3c9ca] [[data-studio-theme=light]_&]:text-[#6c7477]">{FOUND_IMAGE_SOURCES_NOTE}</p>
                </div>}
            </div>)}
          {busy && <div className="mb-4 flex" data-testid="studio-image-search-searching">
            <div className={`rounded-xl rounded-tl-sm bg-[#4f5d5e] p-3 text-base leading-6 [[data-studio-theme=light]_&]:bg-[#eef1f2]`}>{T.searching}<span className="inline-block w-6 animate-pulse">・・</span></div>
          </div>}
        </div>
        <div className={`shrink-0 border-t border-[#3b3f40] p-3 [[data-studio-theme=light]_&]:border-black/10`}>
          <div className="rounded-lg bg-[#262a2b] p-2 [[data-studio-theme=light]_&]:bg-white">
            {precise && <div data-testid="studio-image-search-precise" className="overflow-hidden">
              <div className="mb-2">
                <select aria-label={T.categoryPlaceholder} value={category} onChange={(event) => setCategory(event.target.value as StudioImageSearchCategory)} data-testid="studio-image-search-category"
                  className={`h-6 w-[120px] rounded-sm border-none bg-[#313536] px-2 py-0 text-sm text-[#c3c9ca] outline-none focus-visible:outline-none [[data-studio-theme=light]_&]:bg-[#f2f4f5] [[data-studio-theme=light]_&]:text-[#474d4f]`}>
                  {STUDIO_IMAGE_SEARCH_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              <textarea name="agentMessageInput" value={note} rows={2} maxLength={STUDIO_IMAGE_SEARCH_NOTE_MAX} placeholder={T.notePlaceholder} data-testid="studio-image-search-note"
                onChange={(event) => setNote(event.target.value.slice(0, STUDIO_IMAGE_SEARCH_NOTE_MAX))}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void searchMore(); } }}
                className="mb-1 h-8 w-full resize-none border-none bg-transparent text-sm leading-4 text-[#c3c9ca] outline-none placeholder:text-[#6c7477] focus-visible:outline-none" />
              <div className="flex justify-end"><span className="text-sm text-[#6c7477]">{note.length}/{STUDIO_IMAGE_SEARCH_NOTE_MAX}</span></div>
            </div>}
            <div className="flex items-center justify-between">
              <div role="switch" aria-checked={precise} tabIndex={0} data-testid="studio-image-search-precise-toggle" onClick={() => setPrecise(!precise)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPrecise(!precise); } }}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border border-[#3b3f40] px-1 py-1 [[data-studio-theme=light]_&]:border-black/10`}>
                <span className="flex items-center gap-0.5"><Funnel className="h-4 w-4 text-[#c3c9ca]" /><span className="text-sm text-[#c3c9ca] [[data-studio-theme=light]_&]:text-[#474d4f]">{T.precise}</span></span>
                <span className={`relative h-5 w-10 rounded-full transition-colors ${precise ? 'bg-[#0bcabc]' : 'bg-[#3e3f41]'}`}>
                  <span className={`absolute top-[3px] h-[15px] w-[15px] rounded-full bg-white shadow-sm transition-all ${precise ? 'right-[3px]' : 'left-[3px]'}`} />
                </span>
              </div>
              <button type="button" data-testid="studio-image-search-more" onClick={() => void searchMore()} disabled={studioSearchMoreDisabled({ busy, precise, note })}
                className="h-6 rounded-md bg-[#0bcabc] px-3 text-base leading-6 text-[#0e1314] hover:brightness-110 disabled:bg-[#3e3f41] disabled:text-[#8a9294]">{T.more}</button>
            </div>
          </div>
        </div>
      </>}
    </div>}

    {deleteTarget && createPortal(<div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60" data-testid="studio-image-search-delete-dialog" role="alertdialog" aria-label={T.deleteTitle}>
      <div className="flex w-[360px] max-w-[500px] flex-col rounded-lg bg-[#262a2b] p-6 text-[#e3e8e8]">
        <p className="m-0 text-base font-medium">{T.deleteTitle}</p>
        <p className="mt-6 leading-normal text-[#8a9294]">{T.deleteBody}</p>
        <div className="mt-6 flex justify-end gap-x-2">
          <button type="button" onClick={() => setDeleteTarget(null)} className="h-8 rounded-md bg-[#313536] px-4 text-sm text-[#c3c9ca] hover:bg-[#3a3f40]">{T.cancel}</button>
          <button type="button" onClick={confirmDelete} data-testid="studio-image-search-delete-confirm" className="h-8 rounded-md bg-[#0bcabc] px-4 text-sm text-[#0e1314]">{T.delete}</button>
        </div>
      </div>
    </div>, document.body)}

    {preview && createPortal(<div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-black/80 p-6" data-testid="studio-image-search-preview" role="dialog" aria-label={T.preview}
      onClick={() => setPreview(null)} onKeyDown={(event) => { if (event.key === 'Escape') setPreview(null); }} tabIndex={-1}>
      <button type="button" aria-label={T.collapse} className="absolute right-5 top-5 text-white/80 hover:text-white" onClick={() => setPreview(null)}><X className="h-6 w-6" /></button>
      <img src={preview.imageUrl || preview.thumbUrl} alt={preview.title} className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain" onClick={(event) => event.stopPropagation()} />
      <div className="max-w-[90vw] text-center" onClick={(event) => event.stopPropagation()}><FoundImageCredit image={preview} /></div>
    </div>, document.body)}
  </section>;
}

export default StudioImageSearchPanel;
