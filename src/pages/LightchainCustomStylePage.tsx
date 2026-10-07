import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, ImagePlus, Images, Loader2, NotebookText, Pencil, Search, Shirt, Sparkles, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { isHeavyWorkspaceBrandName, isHeavyWorkspaceRuntime } from '../lib/heavyWorkspace';

/**
 * Source "カスタムスタイル" (/model-base/style): learning images are uploaded, analysed by the
 * vision assistant into design elements, and kept as a brand style preset. Everything a viewer sees
 * (images, cover, name, extracted elements, status) is read back from the server after reload.
 */
export const CUSTOM_STYLE_KIND = 'lightchain-custom-style';
const CONTACT_EMAIL = 'contact@heavy-chain.app';
const ANALYSIS_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_ANALYSIS_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ANALYSIS_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_ANALYSIS_REFERENCES = 16;
const STALE_UPLOAD_MS = 10 * 60 * 1000;

type StyleImage = { imageId: string; storagePath: string; name: string; size?: number };
type StyleStatus = 'uploading' | 'analyzing' | 'completed' | 'failed';
export type CustomStyleSettings = {
  kind: typeof CUSTOM_STYLE_KIND;
  status: StyleStatus;
  space: 'personal' | 'team';
  images: StyleImage[];
  coverImageId: string | null;
  designElements: string[];
  analysis?: { requestId: string; projectId: string; conversationId: string };
  error?: string;
};
type CustomStyle = { id: string; name: string; settings: CustomStyleSettings; createdAt: string; updatedAt: string };

const api = () => { if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured'); return cloudflareDataPlane; };

export function readCustomStyleSettings(value: unknown): CustomStyleSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== CUSTOM_STYLE_KIND || !['uploading', 'analyzing', 'completed', 'failed'].includes(String(raw.status))) return null;
  const images = Array.isArray(raw.images) ? raw.images.filter((image): image is StyleImage => Boolean(image) && typeof image === 'object'
    && typeof (image as StyleImage).imageId === 'string' && typeof (image as StyleImage).storagePath === 'string') : [];
  const designElements = Array.isArray(raw.designElements) ? raw.designElements.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0) : [];
  const analysis = raw.analysis && typeof raw.analysis === 'object' ? raw.analysis as CustomStyleSettings['analysis'] : undefined;
  return { kind: CUSTOM_STYLE_KIND, status: raw.status as StyleStatus, space: raw.space === 'team' ? 'team' : 'personal', images,
    coverImageId: typeof raw.coverImageId === 'string' ? raw.coverImageId : images[0]?.imageId ?? null, designElements,
    ...(analysis?.requestId && analysis.projectId && analysis.conversationId ? { analysis } : {}),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}) };
}

/** The assistant is asked for JSON; tolerate prose around it and bullet lists as a fallback. */
export function parseDesignElements(content: string): string[] {
  const unique = (tags: string[]) => [...new Set(tags.map(tag => tag.replace(/^[-*・\d.、\s]+/, '').trim()).filter(tag => tag && tag.length <= 60))].slice(0, 24);
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { designElements?: unknown };
      if (Array.isArray(parsed.designElements)) return unique(parsed.designElements.filter((tag): tag is string => typeof tag === 'string'));
    } catch { /* fall through */ }
  }
  return unique(content.split(/\n|、|,/));
}

// Plain bullet lines: a JSON-only answer can come back from the provider as a parsed object,
// which the assistant endpoint (string responses only) records as an unknown provider result.
const ANALYSIS_PROMPT = [
  'These images are learning material for one custom apparel style (model photos).',
  'List the shared design elements that define the style: garments, colours, patterns, accessories, model expression and pose, setting, background and lighting.',
  'Answer in Japanese only. Write one element per line, each line starting with "- ", as a short noun phrase (max 30 characters).',
  'Write 6 to 16 lines and nothing else.',
].join('\n');

const statusLabel: Record<StyleStatus, string> = { uploading: 'アップロード中', analyzing: '学習中', completed: '完了', failed: '失敗' };

function StatusBadge({ status }: { status: StyleStatus }) {
  const tone = status === 'completed' ? 'bg-[#4cc38a] text-white' : status === 'failed' ? 'bg-[#e5484d] text-white' : 'bg-[#f5a524] text-[#1a1a1a]';
  return <span className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[12px] font-medium ${tone}`} data-testid="custom-style-status">
    {status === 'completed' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : status === 'failed' ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
    {statusLabel[status]}
  </span>;
}

/** Private R2 media is read with the bearer and exposed as object URLs; revoked when the page unmounts. */
function useMediaUrls(paths: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const owned = useRef<Record<string, string>>({});
  const key = paths.join('|');
  useEffect(() => {
    let cancelled = false;
    for (const path of paths) {
      if (owned.current[path]) continue;
      owned.current[path] = 'pending';
      void api().readMediaObjectUrl(path).then(url => {
        if (cancelled) { URL.revokeObjectURL(url); delete owned.current[path]; return; }
        owned.current[path] = url; setUrls(current => ({ ...current, [path]: url }));
      }).catch(() => { delete owned.current[path]; });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the joined path list
  }, [key]);
  useEffect(() => () => { for (const url of Object.values(owned.current)) if (url.startsWith('blob:')) URL.revokeObjectURL(url); }, []);
  return urls;
}

export function LightchainCustomStylePage() {
  const { user, currentBrand } = useAuthStore();
  const brandReady = Boolean(user?.id && currentBrand?.id && (!isHeavyWorkspaceRuntime() || isHeavyWorkspaceBrandName(currentBrand?.name)));
  const brandId = brandReady ? currentBrand!.id : '';
  const [styles, setStyles] = useState<CustomStyle[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [space, setSpace] = useState<'personal' | 'team'>('personal');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('styleId'));
  const [contactOpen, setContactOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const polling = useRef(new Set<string>());

  useEffect(() => {
    if (isHeavyWorkspaceRuntime() && user?.id && !brandReady) void useAuthStore.getState().ensureHeavyWorkspace();
  }, [brandReady, user?.id]);

  const replaceStyle = useCallback((style: CustomStyle) => setStyles(current => current ? [style, ...current.filter(item => item.id !== style.id)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [style]), []);
  const toStyle = (row: { id: string; name: string; settings: unknown; created_at: string; updated_at: string }): CustomStyle | null => {
    const settings = readCustomStyleSettings(row.settings);
    return settings ? { id: row.id, name: row.name, settings, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  };
  const save = useCallback(async (style: CustomStyle, patch: { name?: string; settings?: CustomStyleSettings }) => {
    const next0 = patch.settings ?? style.settings;
    // A stale failure reason never outlives a later state.
    const settings: CustomStyleSettings = next0.status === 'failed' ? next0 : (({ error: _error, ...rest }) => rest)(next0);
    const row = await api().updateStylePreset(style.id, { ...(patch.name ? { name: patch.name } : {}),
      // The Worker rejects control characters (newlines included) in stored text.
      prompt_template: settings.designElements.length ? `{prompt} / スタイル要素: ${settings.designElements.join('、')}` : '{prompt}',
      settings: settings as never });
    const next = toStyle(row as never);
    if (next) replaceStyle(next);
    return next;
  }, [replaceStyle]);

  const pollAnalysis = useCallback(async (style: CustomStyle) => {
    const analysis = style.settings.analysis;
    if (!analysis || polling.current.has(style.id)) return;
    polling.current.add(style.id);
    try {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const receipt = await api().readDesignAssistantRequest({ requestId: analysis.requestId, brandId, projectId: analysis.projectId, conversationId: analysis.conversationId });
        if (receipt.state === 'completed' && receipt.content) {
          const designElements = parseDesignElements(receipt.content);
          await save(style, { settings: { ...style.settings, status: designElements.length ? 'completed' : 'failed', designElements,
            ...(designElements.length ? {} : { error: 'design_elements_empty' }) } });
          return;
        }
        if (receipt.state === 'failed' || receipt.state === 'unknown') { await save(style, { settings: { ...style.settings, status: 'failed', error: receipt.errorCode ?? 'analysis_failed' } }); return; }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch { /* keep the stored state; a later visit resumes polling */ }
    finally { polling.current.delete(style.id); }
  }, [brandId, save]);

  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    setLoadError(false);
    void api().listStylePresets(brandId).then(rows => {
      if (cancelled) return;
      const list = rows.map(row => toStyle(row as never)).filter((style): style is CustomStyle => Boolean(style));
      setStyles(list);
      for (const style of list) if (style.settings.status === 'analyzing') void pollAnalysis(style);
    }).catch(() => { if (!cancelled) { setStyles([]); setLoadError(true); } });
    return () => { cancelled = true; };
  }, [brandId, pollAnalysis]);

  const analysisProject = async () => {
    const title = 'カスタムスタイル解析';
    const existing = (await api().listCanvasDocuments(brandId)).find(document => document.title === title);
    if (existing) return existing.id;
    return (await api().createCanvasDocument({ brand_id: brandId, title, snapshot: { version: 1, name: title, objects: [] } })).id;
  };

  /** Saves the request identity first, so a reload resumes the same request instead of sending another. */
  const requestAnalysis = async (style: CustomStyle, settings: CustomStyleSettings) => {
    const analysis = { requestId: crypto.randomUUID(), projectId: await analysisProject(), conversationId: `custom-style-${style.id}` };
    const analyzing = await save(style, { settings: { ...settings, status: 'analyzing', designElements: [], analysis } });
    let total = 0;
    // Server bounds: 16 references and 32MB in total; unknown sizes count as the per-image maximum.
    const references = settings.images.filter(image => (total += image.size ?? MAX_ANALYSIS_IMAGE_BYTES) <= MAX_ANALYSIS_TOTAL_BYTES).slice(0, MAX_ANALYSIS_REFERENCES).map((image, order) => ({ order, kind: 'upload' as const, imageId: image.imageId, storagePath: image.storagePath, name: image.name }));
    await api().sendDesignAssistantRequest({ requestId: analysis.requestId, brandId, projectId: analysis.projectId, conversationId: analysis.conversationId,
      prompt: ANALYSIS_PROMPT, history: [], references } as never).catch(() => null);
    if (analyzing) void pollAnalysis(analyzing);
    return analyzing;
  };

  const startUpload = async (files: File[]) => {
    if (!brandId || busy || !files.length) return;
    const accepted = files.filter(file => ANALYSIS_TYPES.has(file.type) && file.size <= MAX_ANALYSIS_IMAGE_BYTES);
    if (!accepted.length) { setNotice('PNG・JPEG・WebP（10MB以下）の画像を選択してください。'); return; }
    setBusy(true); setNotice(null);
    const id = crypto.randomUUID();
    const name = `カスタムスタイル${(styles?.length ?? 0) + 1}`;
    const base: CustomStyleSettings = { kind: CUSTOM_STYLE_KIND, status: 'uploading', space, images: [], coverImageId: null, designElements: [] };
    try {
      // Saved before any upload so the style exists (and shows its state) after a reload.
      const created = toStyle(await api().createStylePreset({ id, brand_id: brandId, name, settings: base as never }) as never);
      if (!created) throw new Error('custom_style_create_failed');
      replaceStyle(created); setSelectedId(id);
      const images: StyleImage[] = [];
      for (const file of accepted) {
        const storagePath = await api().uploadBrandLogo(brandId, file);
        const image = await api().createGeneratedImage({ brand_id: brandId, storage_path: storagePath, feature_type: 'lightchain-custom-style-source',
          prompt: name, metadata: { customStyleId: id, fileName: file.name } as never });
        images.push({ imageId: image.id, storagePath, name: file.name, size: file.size });
      }
      await requestAnalysis(created, { ...base, images, coverImageId: images[0]?.imageId ?? null });
    } catch {
      setNotice('アップロードまたは学習の開始に失敗しました。');
      const current = await api().listStylePresets(brandId).catch(() => []);
      const row = current.find(item => item.id === id);
      const style = row ? toStyle(row as never) : null;
      if (style && style.settings.status !== 'analyzing') await save(style, { settings: { ...style.settings, status: 'failed', error: 'upload_failed' } }).catch(() => null);
    } finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  };

  const visible = useMemo(() => (styles ?? []).filter(style => style.settings.space === space && style.name.includes(search.trim())), [styles, space, search]);
  const selected = selectedId ? (styles ?? []).find(style => style.id === selectedId) ?? null : null;
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set('styleId', selectedId); else url.searchParams.delete('styleId');
    window.history.replaceState(window.history.state, '', url);
  }, [selectedId]);
  const coverPaths = useMemo(() => (styles ?? []).flatMap(style => {
    const cover = style.settings.images.find(image => image.imageId === style.settings.coverImageId) ?? style.settings.images[0];
    return cover ? [cover.storagePath] : [];
  }), [styles]);
  const detailPaths = useMemo(() => selected?.settings.images.map(image => image.storagePath) ?? [], [selected]);
  const mediaUrls = useMediaUrls([...coverPaths, ...detailPaths]);
  const effectiveStatus = (style: CustomStyle): StyleStatus => style.settings.status === 'uploading' && Date.now() - Date.parse(style.updatedAt) > STALE_UPLOAD_MS ? 'failed' : style.settings.status;

  return (
    <div className="flex min-h-[calc(100vh-50px)] gap-4 bg-[#171b1c] p-4 text-white" data-testid="lightchain-custom-style-page" data-custom-style-count={styles?.length ?? ''}>
      <nav aria-label="カスタムスタイル" className="w-20 shrink-0 rounded-2xl bg-[#1f2426] py-6">
        <div className="flex flex-col items-center gap-1 text-center text-[12px] leading-[17px] text-[#65d3cf]" aria-current="page">
          <Shirt className="h-6 w-6" fill="currentColor" aria-hidden="true" />
          <span>カスタム<br />スタイル</span>
        </div>
      </nav>

      <main className="min-w-0 flex-1 rounded-2xl bg-[#232829] px-10 py-8">
        {selected ? (
          <section data-testid="custom-style-detail" data-style-id={selected.id} className="flex min-h-[calc(100vh-150px)] flex-col">
            <div className="flex items-center gap-4">
              {renaming !== null ? (
                <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); const name = renaming.trim(); if (name) void save(selected, { name }).then(() => setRenaming(null)); }}>
                  <input aria-label="スタイル名" autoFocus maxLength={64} value={renaming} onChange={event => setRenaming(event.target.value)}
                    className="h-9 rounded-md border border-white/15 bg-[#1b1f20] px-3 text-lg text-white outline-none focus:border-[#65d3cf]" />
                  <button type="submit" className="h-9 rounded-md bg-[#65d3cf] px-3 text-sm text-[#102021]">保存</button>
                  <button type="button" onClick={() => setRenaming(null)} className="h-9 rounded-md px-3 text-sm text-[#aab8b6]">キャンセル</button>
                </form>
              ) : (
                <button type="button" onClick={() => setRenaming(selected.name)} className="flex items-center gap-2 text-xl font-medium text-white" aria-label={`${selected.name} の名前を編集`}>
                  <Pencil className="h-4 w-4 text-[#65d3cf]" aria-hidden="true" />{selected.name}
                </button>
              )}
              <StatusBadge status={effectiveStatus(selected)} />
              <p className="sr-only" role="status" data-testid="custom-style-files">{selected.settings.images.map(image => image.name).join(' ')}</p>
            </div>
            <div className="mt-6 grid flex-1 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3">
              <div className="rounded-xl border border-dashed border-white/20 p-8">
                <div className="flex h-12 items-center justify-center gap-2 rounded-lg bg-[#2c3234] text-sm text-[#65d3cf]"><Images className="h-4 w-4" aria-hidden="true" />モデル画像</div>
                <div className="mt-4 flex gap-6">
                  <div className="flex w-[90px] shrink-0 flex-col gap-2" role="listbox" aria-label="表紙に設定">
                    {selected.settings.images.map(image => (
                      <button key={image.imageId} type="button" role="option" aria-selected={selected.settings.coverImageId === image.imageId}
                        onClick={() => void save(selected, { settings: { ...selected.settings, coverImageId: image.imageId } })}
                        className={`relative h-[120px] w-[90px] overflow-hidden rounded-md border ${selected.settings.coverImageId === image.imageId ? 'border-[#65d3cf]' : 'border-transparent'}`}>
                        {mediaUrls[image.storagePath] && <img src={mediaUrls[image.storagePath]} alt={image.name} className="size-full object-cover" />}
                        {selected.settings.coverImageId === image.imageId && <span className="absolute inset-x-1 bottom-1 rounded bg-[#65d3cf]/90 py-0.5 text-center text-[11px] text-[#102021]">現在の表紙</span>}
                      </button>
                    ))}
                  </div>
                  <div className="flex min-h-[420px] flex-1 items-center justify-center overflow-hidden rounded-lg bg-[#1b1f20]">
                    {(() => { const cover = selected.settings.images.find(image => image.imageId === selected.settings.coverImageId) ?? selected.settings.images[0];
                      return cover && mediaUrls[cover.storagePath] ? <img src={mediaUrls[cover.storagePath]} alt={`${selected.name} の表紙`} className="max-h-[560px] w-full object-contain" data-testid="custom-style-cover" /> : null; })()}
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-dashed border-white/20 p-8">
                <div className="flex h-12 items-center justify-center gap-2 rounded-lg bg-[#2c3234] text-sm text-[#65d3cf]"><NotebookText className="h-4 w-4" aria-hidden="true" />モデル関連情報</div>
                <h3 className="mt-6 text-lg font-medium text-white">デザイン要素</h3>
                {effectiveStatus(selected) === 'completed' ? (
                  <ul className="mt-4 flex flex-wrap gap-3" data-testid="custom-style-design-elements">
                    {selected.settings.designElements.map(tag => <li key={tag} className="rounded-full bg-[#2c3234] px-4 py-2 text-sm text-[#e3e8e8]">{tag}</li>)}
                  </ul>
                ) : effectiveStatus(selected) === 'failed' ? (
                  <div className="mt-4 space-y-3"><p className="text-sm text-[#e5484d]">学習に失敗しました。</p>
                    <button type="button" disabled={busy || !selected.settings.images.length} onClick={() => { setBusy(true); void requestAnalysis(selected, selected.settings).finally(() => setBusy(false)); }}
                      className="h-8 rounded-lg bg-[#65d3cf] px-4 text-sm text-[#102021] disabled:opacity-50" data-testid="custom-style-retry">再学習</button></div>
                ) : (
                  <p className="mt-4 flex items-center gap-2 text-sm text-[#aab8b6]"><Sparkles className="h-4 w-4" aria-hidden="true" />画像を学習しています。完了するとデザイン要素が表示されます。</p>
                )}
              </div>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <button type="button" onClick={() => { setSelectedId(null); setRenaming(null); }} className="h-8 rounded-lg border border-white/15 px-4 text-sm text-white hover:bg-white/5">一覧に戻る</button>
              <button type="button" onClick={() => { if (window.confirm(`「${selected.name}」を削除しますか？`)) void api().deleteStylePreset(selected.id).then(() => {
                setStyles(current => (current ?? []).filter(style => style.id !== selected.id)); setSelectedId(null); }); }}
                className="h-8 rounded-lg border border-[#e5484d]/60 px-4 text-sm text-[#e5484d] hover:bg-[#e5484d]/10">削除</button>
            </div>
          </section>
        ) : (
          <>
            <h1 className="text-xl font-medium leading-6 text-white">ラーニング素材をアップロードしてください</h1>
            <label className={`mt-2 flex h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#65d3cf]/60 px-6 text-center transition hover:bg-white/[0.02] ${busy ? 'pointer-events-none opacity-60' : ''}`}
              onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void startUpload([...event.dataTransfer.files]); }}>
              <input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="ラーニング素材" disabled={busy || !brandId}
                onChange={event => void startUpload([...(event.target.files ?? [])])} />
              {busy ? <Loader2 className="h-6 w-6 animate-spin text-[#aab8b6]" aria-hidden="true" /> : <ImagePlus className="h-6 w-6 text-[#aab8b6]" aria-hidden="true" />}
              <p className="mt-5 text-[13px] font-medium text-white">次の要件を満たす写真をアップロードしてください：</p>
              <p className="mt-1 text-[12px] leading-[18px] text-[#aab8b6]">1、正面または斜めから撮影された全身または半身のモデル画像 2、画像の背景が可能な限り似している画像</p>
              <p className="text-[12px] leading-[18px] text-[#aab8b6]">3、推奨される画像のアップロード数は30〜50枚 4、画像は鮮明で、比率は統一されていることが望ましい</p>
            </label>
            {notice && <p role="alert" className="mt-2 text-sm text-[#e5484d]">{notice}</p>}

            <h2 className="mt-6 text-lg font-medium leading-7 text-white">カスタムスタイルライブラリ</h2>
            <div className="mt-2 flex h-[43px] items-center justify-between">
              <div role="tablist" className="flex gap-8 pl-6">
                {([['personal', 'パーソナルスペース'], ['team', 'チームスペース']] as const).map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={space === id} onClick={() => setSpace(id)}
                    className={`relative pb-2 pt-3 text-[12px] font-medium ${space === id ? 'text-[#65d3cf]' : 'text-[#aab8b6] hover:text-white'}`}>
                    {label}{space === id && <span className="absolute bottom-0 left-1/2 h-[3px] w-3 -translate-x-1/2 rounded-full bg-[#65d3cf]" />}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-[42px]">
                <label className="flex w-[216px] items-center gap-1 text-[14px] text-[#aab8b6]">
                  <input value={search} onChange={event => setSearch(event.target.value)} placeholder="名前を入力してください" aria-label="名前を入力してください"
                    className="w-full bg-transparent outline-none placeholder:text-[#7c8789]" />
                  <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </label>
                <button type="button" onClick={() => setContactOpen(true)} className="inline-flex h-8 items-center gap-2 rounded-lg bg-[#3a4144] px-4 text-sm font-medium text-white hover:bg-[#454d50]">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />カスタマイズについて連絡する
                </button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-6 gap-6" data-testid="custom-style-library">
              {styles === null ? <p className="col-span-6 text-sm text-[#aab8b6]">読み込み中…</p>
                : loadError ? <p className="col-span-6 text-sm text-[#e5484d]">カスタムスタイルを読み込めませんでした。</p>
                : visible.length === 0 ? <p className="col-span-6 py-10 text-center text-sm text-[#7c8789]" data-testid="custom-style-empty">データがありません</p>
                : visible.map(style => {
                  const cover = style.settings.images.find(image => image.imageId === style.settings.coverImageId) ?? style.settings.images[0];
                  return (
                    <button key={style.id} type="button" onClick={() => setSelectedId(style.id)} className="text-left" data-testid="custom-style-card" data-style-id={style.id}>
                      <div className="relative h-[222px] overflow-hidden rounded-lg bg-[#1b1f20]">
                        {cover && mediaUrls[cover.storagePath] && <img src={mediaUrls[cover.storagePath]} alt="" className="size-full object-cover" />}
                        <span className="absolute left-2 top-2"><StatusBadge status={effectiveStatus(style)} /></span>
                      </div>
                      <p className="mt-2 truncate text-sm leading-4 text-[#e3e8e8]">{style.name}</p>
                    </button>
                  );
                })}
            </div>
          </>
        )}
      </main>

      {contactOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="カスタマイズについて連絡する" onClick={() => setContactOpen(false)}>
          <div className="relative w-[416px] rounded-xl border border-white/10 bg-[#232829] px-6 pb-6 pt-14" onClick={event => event.stopPropagation()}>
            <button type="button" onClick={() => setContactOpen(false)} aria-label="閉じる" className="absolute right-6 top-6 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-white"><X className="h-4 w-4" /></button>
            <p className="text-[14px] leading-6 text-[#e3e8e8]">カスタマイズをご希望の場合、下記メールアドレスまでご連絡ください。</p>
            <div className="mt-3 flex items-center gap-3 border-b border-white/10 pb-4">
              <span className="text-lg font-semibold text-white">{CONTACT_EMAIL}</span>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(CONTACT_EMAIL)} className="inline-flex h-6 items-center gap-1 rounded bg-[#65d3cf] px-3 text-xs text-[#102021]"><Copy className="h-3 w-3" aria-hidden="true" />コピー</button>
            </div>
            <p className="mt-4 text-[12px] text-[#aab8b6]">受信後、順次ご連絡致します。</p>
          </div>
        </div>
      )}
    </div>
  );
}
