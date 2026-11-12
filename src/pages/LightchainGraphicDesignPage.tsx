import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { History, ImagePlus, ImageUp, Loader2, Plus, Sparkles, Trash2, WandSparkles, X } from 'lucide-react';
import { GallerySelector } from '../components/GallerySelector';
import { useCanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';
import { whitenDarkBackground } from '../lib/whitenDarkBackground';
import { useHeavyWorkspaceBrandGate } from '../hooks/useHeavyWorkspaceBrandGate';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import { LightchainHistoryPanel } from '../components/lightchain/LightchainHistoryPanel';
import { assistGroups, assistPromptLines, assistReferenceKey, selectedAssistTags, toggleAssistTag } from '../features/graphicDesign/graphicAssist';
import { analyzeGraphicReferences } from '../features/graphicDesign/graphicAssistApi';
import { GRAPHIC_CANDIDATE_COUNT, graphicFollowUpBrief } from '../features/graphicDesign/graphicTools';
import { GraphicResultView } from '../components/lightchain/GraphicResultView';
import type { GraphicCandidate } from '../features/graphicDesign/graphicResultActions';

/**
 * Light `/printing` = "AIグラフィックデザイン" (GeneratePrinting / ModifyPrinting).
 * Layout measured from Light at 1440×900 on 2026-10-06 (docs/parity/evidence/light-printing-*.jpg):
 * 320px upload panel, centered card with title/video, 320px right panel that stays empty until an
 * image is uploaded and then shows per-image reference strength, design-element hint and the run button.
 */
export const GRAPHIC_STRENGTH_LEVELS = ['弱', 'やや弱', '中', 'やや強', '強'] as const;
type StrengthIndex = 0 | 1 | 2 | 3 | 4;
const DEFAULT_STRENGTH: StrengthIndex = 2;
const MAX_REFERENCES = 2;
// Light's AIグラフィックデザイン plays its own demo (図案設計), not the プリントイメージ one.
const GRAPHIC_VIDEO = '/lightchain-assets/mirror/lightchain-qlxy-prod/graphic-design.mp4';

const readStrengths = (value: unknown): [StrengthIndex, StrengthIndex] => {
  const list = Array.isArray(value) ? value : [];
  const at = (index: number): StrengthIndex => {
    const raw = list[index];
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 4 ? raw as StrengthIndex : DEFAULT_STRENGTH;
  };
  return [at(0), at(1)];
};

export function graphicDesignBrief(referenceCount: number, strengths: readonly StrengthIndex[], assist: boolean, assistTags: readonly string[] = []): string {
  return [
    'グラフィックデザイン: 参考画像から、アパレル向けのオリジナル柄・プリントグラフィックを作成してください。',
    '出力はプリント用のグラフィック単体とし、衣服・人物・モックアップは描かないでください。',
    '参考画像にない文字・ロゴ・ラベル（「AI」などの文字を含む）や、電子回路・デジタル風の装飾は加えないでください。',
    '背景は純白（#FFFFFF）の均一な無地で塗りつぶしてください。参考画像の背景が黒や暗い色でもその背景色は引き継がず、モチーフの周りに光彩・発光・にじみ・グラデーション・周辺を暗くする効果（ビネット）は入れないでください。モチーフはくっきりした輪郭の塗りで描いてください。',
    ...Array.from({ length: referenceCount }, (_, index) => `参考画像${index + 1}の参照強度: ${GRAPHIC_STRENGTH_LEVELS[strengths[index] ?? DEFAULT_STRENGTH]}`),
    ...assistPromptLines(assist, assistTags),
  ].filter(Boolean).join('\n');
}

export function LightchainGraphicDesignPage() {
  const { user, currentBrand } = useAuthStore();
  return <LightchainGraphicDesignWorkspace key={JSON.stringify([currentBrand?.id, user?.id])} />;
}

const assistChip = 'inline-flex h-8 items-center rounded-3xl border px-3 text-xs transition';

function LightchainGraphicDesignWorkspace() {
  const currentBrand = useAuthStore((state) => state.currentBrand);
  const user = useAuthStore((state) => state.user);
  const workspace = useCanonicalImageWorkspace('print-design-project', {
    prepareSourceImage: whitenDarkBackground,
    // gpt-image-1-mini turns these references into dark neon art despite the prompt.
    providerModel: 'gpt-image-1.5',
    requiredSources: 1,
    title: 'AIグラフィックデザイン',
    // With 「AI」 in the prompt the model drew AI badges and circuit glow into the graphic.
    promptTitle: 'グラフィックデザイン',
    initialInputState: { referenceStrengths: [DEFAULT_STRENGTH, DEFAULT_STRENGTH], assist: false },
    // 独自: 本家の説明動画の生成後の画面は1回で4案（本家はこのアカウントで生成できない）。
    candidateCount: GRAPHIC_CANDIDATE_COUNT,
  });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selected, setSelected] = useState<0 | 1>(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  /** ‹ 戻る: back to the input screen; the run stays in 生成履歴 and a new generation shows its result again. */
  const [showIntro, setShowIntro] = useState(false);
  /** Light's 素材を選択: adding opens it on 履歴アップロード; `replace` is the slot 差し替え changes. */
  const [library, setLibrary] = useState<{ replace: 'primary' | 'secondary' | null } | null>(null);
  const references = [workspace.slots.primary, workspace.slots.secondary].filter((slot): slot is NonNullable<typeof slot> => Boolean(slot));
  const strengths = readStrengths(workspace.inputState.referenceStrengths);
  const assist = workspace.inputState.assist === true;
  const heavyBrand = useHeavyWorkspaceBrandGate();
  const locked = heavyBrand.pending || workspace.status === 'running' || workspace.status === 'loading' || Boolean(workspace.pendingId);
  const preview = references[Math.min(selected, references.length - 1)] ?? null;
  // アシスト: the analysis belongs to the references it read; replacing one reads them again (Light re-analyses too).
  const referenceKey = assistReferenceKey(references);
  const analysedFor = typeof workspace.inputState.assistFor === 'string' ? workspace.inputState.assistFor : '';
  const assistOptions = analysedFor === referenceKey ? workspace.inputState.assistOptions : [];
  const assistTags = selectedAssistTags(assistOptions, workspace.inputState.assistTags);
  const optionGroups = assistGroups(assistOptions);
  const optionCount = optionGroups.reduce((sum, group) => sum + group.tags.length, 0);
  const [analysis, setAnalysis] = useState<{ key: string; state: 'running' | 'failed' } | null>(null);
  const latest = useRef({ inputState: workspace.inputState, referenceKey });
  latest.current = { inputState: workspace.inputState, referenceKey };
  useEffect(() => {
    if (!assist || references.length === 0 || optionCount > 0 || locked || !currentBrand?.id || analysis?.key === referenceKey) return;
    const key = referenceKey;
    setAnalysis({ key, state: 'running' });
    analyzeGraphicReferences(currentBrand.id, references).then((options) => {
      // A result for references that were replaced meanwhile is dropped; the new ones are read next.
      if (latest.current.referenceKey !== key) return;
      const now = latest.current.inputState;
      workspace.setInputState({ ...now, assistOptions: options, assistTags: selectedAssistTags(options, now.assistTags), assistFor: key } as typeof now);
      setAnalysis(null);
    }).catch(() => setAnalysis((current) => (current?.key === key ? { key, state: 'failed' } : current)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assist, referenceKey, optionCount, locked, currentBrand?.id, analysis?.key]);
  const pickAssistTag = (value: string) => { if (!locked) setInput({ assistTags: toggleAssistTag(assistOptions, assistTags, value) }); };

  useEffect(() => {
    const result = workspace.result;
    let cancelled = false;
    if (!result) { setResultUrl(null); return; }
    if (result.imageUrl) { setResultUrl(result.imageUrl); return; }
    if (!result.storagePath) { setResultUrl(null); return; }
    void withSignedImageUrls([{ storage_path: result.storagePath, image_url: '' }])
      .then(([signed]) => { if (!cancelled) setResultUrl(signed?.image_url || null); })
      .catch(() => { if (!cancelled) setResultUrl(null); });
    return () => { cancelled = true; };
  }, [workspace.result]);

  const setInput = (patch: Record<string, unknown>) => workspace.setInputState({ ...workspace.inputState, ...patch } as typeof workspace.inputState);
  const setStrength = (index: 0 | 1, level: StrengthIndex) => {
    const next: [StrengthIndex, StrengthIndex] = [...strengths];
    next[index] = level;
    setInput({ referenceStrengths: next });
  };
  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    addFiles(files);
  };
  const addFiles = (files: File[], replace: 'primary' | 'secondary' | null = null) => {
    if (replace) { if (files[0]) void workspace.upload(replace, files[0]); return; }
    const free = (['primary', 'secondary'] as const).filter((key) => !workspace.slots[key]);
    files.slice(0, free.length).forEach((file, index) => { void workspace.upload(free[index], file); });
    if (files.length > 0 && free.length > 0) setSelected(references.length === 0 ? 0 : 1);
  };
  const openLibrary = (replace: 'primary' | 'secondary' | null = null) => { if (!locked) setLibrary({ replace }); };
  /** A library image is read and added like a file from the computer. */
  const pickLibraryImage = (imageUrl: string, name: string) => {
    const replace = library?.replace ?? null;
    setLibrary(null);
    void fetch(imageUrl, { credentials: 'omit' }).then((response) => response.blob())
      .then((blob) => addFiles([new File([blob], name || 'library-image', { type: blob.type || 'image/png' })], replace))
      .catch(() => undefined);
  };
  const removeReference = (index: 0 | 1) => {
    if (locked) return;
    if (index === 0 && workspace.slots.secondary) {
      // Keep Light's ordered strip: the remaining image becomes 参考画像 1.
      const remaining = workspace.slots.secondary;
      workspace.clearSource('secondary');
      void fetch(remaining.imageUrl).then((response) => response.blob()).then((blob) => workspace.upload('primary', new File([blob], remaining.name, { type: blob.type })));
      setStrength(0, strengths[1]);
    } else {
      workspace.clearSource(index === 0 ? 'primary' : 'secondary');
    }
    setSelected(0);
  };
  const generate = () => {
    if (locked || references.length === 0) return;
    setShowIntro(false);
    void workspace.generate({ brief: graphicDesignBrief(references.length, strengths, assist, assistTags) });
  };
  /** 似た案を増やす / 総柄にする: the chosen proposal is image 0, the references follow; the run draws 4 new proposals. */
  const followUp = (kind: 'variations' | 'repeat', candidate: GraphicCandidate) => {
    if (locked || !workspace.result) return;
    setShowIntro(false);
    void workspace.editResult({ brief: graphicFollowUpBrief(kind, graphicDesignBrief(references.length, strengths, assist, assistTags)),
      result: { ...workspace.result, imageId: candidate.id, storagePath: candidate.storage_path } });
  };
  /** A tool's output (a new colorway, a repeat tile) becomes a reference for the next generation. */
  const useAsReference = (file: File) => {
    if (locked) return;
    addFiles([file], references.length < MAX_REFERENCES ? null : (selected === 1 && workspace.slots.secondary ? 'secondary' : 'primary'));
  };
  const resultView = Boolean(resultUrl) && !showIntro;

  return (
    <div className="lightchain-graphic-design flex h-[calc(100vh-50px)] min-h-[700px] gap-4 overflow-hidden bg-[#171b1c] p-4 text-white" data-testid="graphic-design-page" data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId ?? ''} data-resume-state={workspace.status}>
      <input ref={inputRef} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" multiple disabled={locked} onChange={handleFiles} aria-label="参考画像ファイル" data-testid="graphic-design-file-input" />
      <GallerySelector isOpen={Boolean(library) && !locked} title="素材を選択" onClose={() => setLibrary(null)}
        onSelect={(imageUrl, _imageId, _storagePath, imageElement) => pickLibraryImage(imageUrl, imageElement?.alt?.trim() || '参考画像')}
        uploadTile={{ accept: 'image/jpeg,image/png,image/webp', multiple: !library?.replace, onFiles: (files) => { const replace = library?.replace ?? null; setLibrary(null); addFiles(files, replace); } }} />
      <section className="flex w-80 shrink-0 flex-col overflow-y-auto rounded-lg bg-[#262a2b] p-4" aria-label="画像をアップロード">
        <h6 className="flex h-8 items-center text-base font-normal text-white">画像をアップロード</h6>
        {references.length === 0 ? (
          <button type="button" data-testid="graphic-design-upload" onClick={() => openLibrary()} disabled={locked} className="mt-4 flex h-72 w-full shrink-0 flex-col items-center justify-center rounded border border-dashed border-transparent bg-[#333839] p-4 text-neutral-400 transition hover:border-[#20d0c4]">
            <ImagePlus aria-hidden="true" className="h-6 w-6 text-neutral-300" />
            <span className="mt-2 w-full break-words text-center text-sm text-neutral-200">画像をアップロードします</span>
            <span className="mt-1 break-words text-center text-xs text-neutral-400">jpg、jpeg、png、webpに対応しています。サイズ20M以内の画像を2枚までアップロードできます</span>
          </button>
        ) : (
          <>
            <div className="mt-4 flex gap-2" data-testid="graphic-design-thumbnails">
              {references.map((reference, index) => (
                <div key={`${index}-${reference.imageUrl}`} className="group relative">
                  <button type="button" onClick={() => setSelected(index as 0 | 1)} aria-label={`参考画像 ${index + 1}`} aria-pressed={selected === index} className={`block size-[52px] overflow-hidden rounded border-2 bg-white ${selected === index ? 'border-[#20d0c4]' : 'border-transparent'}`}>
                    <img src={reference.imageUrl} alt="" className="size-full object-cover" />
                  </button>
                  <button type="button" onClick={() => removeReference(index as 0 | 1)} disabled={locked} aria-label={`参考画像 ${index + 1}を削除`} className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-black/70 text-[10px] leading-none text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100">×</button>
                </div>
              ))}
              {references.length < MAX_REFERENCES && (
                <button type="button" onClick={() => openLibrary()} disabled={locked} aria-label="画像を追加" className="flex size-[52px] items-center justify-center rounded border border-dashed border-white/25 text-neutral-300 hover:border-[#20d0c4]">
                  <Plus aria-hidden="true" className="h-5 w-5" />
                </button>
              )}
            </div>
            {preview && (
              <div className="group relative mt-2 flex h-72 w-full shrink-0 items-center justify-center overflow-hidden rounded border border-[#20d0c4] bg-[#333839]" data-testid="graphic-design-preview">
                <img src={preview.imageUrl} alt="選択中の参考画像" className="max-h-full max-w-full object-contain" />
                <span className="sr-only" data-testid="graphic-design-preview-name">{preview.name}</span>
                {/* Light: hovering the selected image dims it and shows 差し替え and 削除 in a small bar (2026-11-12). */}
                {!locked && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100" data-testid="graphic-design-preview-actions">
                    <div className="flex rounded-lg bg-[#262a2b]/80 backdrop-blur-sm">
                      <button type="button" aria-label="画像を差し替え" title="画像を差し替え" onClick={() => openLibrary(selected === 1 && workspace.slots.secondary ? 'secondary' : 'primary')}
                        className="flex size-10 items-center justify-center rounded text-white hover:bg-white/10"><ImageUp className="h-5 w-5" aria-hidden="true" /></button>
                      <button type="button" aria-label="画像を削除" title="画像を削除" onClick={() => removeReference(Math.min(selected, references.length - 1) as 0 | 1)}
                        className="flex size-10 items-center justify-center rounded text-[#ff4d4f] hover:bg-white/10"><Trash2 className="h-5 w-5" aria-hidden="true" /></button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <label className="mt-0 flex items-center justify-between rounded-b bg-[#2f3436] px-4 py-3 text-sm text-neutral-300">
              <span>アシスト機能を起動します</span>
              <button type="button" role="switch" aria-checked={assist} aria-label="アシスト機能を起動します" disabled={locked} onClick={() => setInput({ assist: !assist })} className={`relative h-5 w-11 rounded-full transition ${assist ? 'bg-[#20d0c4]' : 'bg-neutral-500'}`}>
                <span className={`absolute top-0.5 size-4 rounded-full bg-white transition ${assist ? 'left-[26px]' : 'left-0.5'}`} />
              </button>
            </label>
            {!assist ? (
              <p className="mt-4 flex items-start gap-2 rounded-2xl bg-white/[0.04] px-4 py-2 text-xs leading-[17px] text-neutral-400"><Sparkles aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-300" />アシスト機能をオンにして、デザイン要素を解析します</p>
            ) : optionCount > 0 ? (
              <div className="mt-6" data-testid="graphic-design-assist-tags">
                <div className="flex items-center justify-between text-sm text-neutral-200"><span>参考テキストを選びます</span><span className="text-xs text-neutral-400">選択済み {assistTags.length} / {optionCount}</span></div>
                {optionGroups.map((group) => (
                  <div key={group.label} className="mt-3">
                    <div className="text-xs text-neutral-400">{group.label}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {group.tags.map((tag) => {
                        const value = `${group.label}:${tag}`;
                        const on = assistTags.includes(value);
                        return <button key={value} type="button" aria-pressed={on} disabled={locked} onClick={() => pickAssistTag(value)}
                          className={`${assistChip} ${on ? 'border-[#20d0c4] bg-[#434c4b] text-[#20d0c4]' : 'border-white/10 text-neutral-300 hover:border-white/25'}`}>{tag}</button>;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : analysis?.state === 'failed' ? (
              <div role="alert" className="mt-4 flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-4 py-2 text-xs text-rose-300">
                デザイン要素を解析できませんでした
                <button type="button" onClick={() => setAnalysis(null)} className="shrink-0 rounded border border-white/15 px-2 py-1 text-neutral-200 hover:border-[#20d0c4]">再解析</button>
              </div>
            ) : (
              <div role="status" className="mt-4 flex h-10 items-center justify-center gap-2 rounded-lg bg-[#3a3f41] text-sm text-[#20d0c4]/70" data-testid="graphic-design-assist-analysing">
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />デザイン要素解析中...
              </div>
            )}
          </>
        )}
      </section>

      <div className="flex min-w-[596px] flex-1 p-4">
      <main className="relative flex min-w-0 flex-1 rounded-lg bg-[#262a2b] p-4" aria-label="AIグラフィックデザイン">
        {!resultView && (
          <button type="button" onClick={() => setHistoryOpen(true)} className="absolute right-4 top-4 z-10 flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-[#171b1c] pl-2.5 pr-3 text-xs font-medium text-white">
            <History aria-hidden="true" className="h-4 w-4" />生成履歴
          </button>
        )}
        {resultView ? (
          <>
            <GraphicResultView brandId={currentBrand?.id} userId={user?.id} jobId={workspace.jobId} fallbackUrl={resultUrl} locked={locked}
              onBack={() => setShowIntro(true)} onOpenHistory={() => setHistoryOpen(true)} onFollowUp={followUp} onUseAsReference={useAsReference} />
            {(workspace.status === 'running' || workspace.error) && (
              <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-sm">
                {workspace.status === 'running' ? <span role="status" className="text-neutral-200">生成中です…（{GRAPHIC_CANDIDATE_COUNT}案を順に作っています。2〜3分かかります）</span>
                  : <span role="alert" className="text-rose-300">{workspace.error}</span>}
              </div>
            )}
          </>
        ) : (
        <div className="flex size-full flex-col items-center justify-center px-10">
          <h5 className="text-xl font-bold text-[#20d0c4]">AIグラフィックデザイン</h5>
          <p className="mt-2 w-[328px] text-center text-sm text-neutral-400">AIでグラフィックを作成</p>
          <div className="mt-4 h-[340px] w-full"><video src={GRAPHIC_VIDEO} className="size-full" autoPlay controls controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture muted playsInline aria-label="AIグラフィックデザイン動画" /></div>
          {workspace.status === 'running' && <p role="status" className="mt-4 text-sm text-neutral-300">生成中です…（{GRAPHIC_CANDIDATE_COUNT}案を順に作っています。2〜3分かかります）</p>}
          {heavyBrand.failed && <p role="alert" className="mt-4 text-sm text-rose-300">ワークスペースを準備できません。ページを再読み込みしてください。</p>}
          {workspace.error && <p role="alert" className="mt-4 text-sm text-rose-300">{workspace.error}</p>}
        </div>
        )}
        {historyOpen && <LightchainHistoryPanel locked={locked} toolIds={['print-design-project']} onClose={() => setHistoryOpen(false)} />}
      </main>
      </div>

      <aside className="flex w-80 shrink-0 flex-col overflow-auto rounded-lg bg-[#262a2b] p-4" aria-label="生成設定" data-testid="graphic-design-settings">
        {/* Light (2026-11-11) leaves this panel empty until a reference is uploaded. */}
        {references.length > 0 && (
          <>
            <h6 className="text-base font-normal">画像参照強度</h6>
            {references.map((reference, index) => (
              <div key={`${index}-${reference.imageUrl}`} className="mt-3 flex gap-4">
                <img src={reference.imageUrl} alt="" className="size-16 shrink-0 rounded border border-white/10 bg-white object-cover" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-center justify-between text-sm text-neutral-300"><span>参考画像 {index + 1}</span><span className="rounded border border-[#20d0c4] px-5 py-1 text-[#20d0c4]" data-testid={`graphic-design-strength-label-${index + 1}`}>{GRAPHIC_STRENGTH_LEVELS[strengths[index]]}</span></div>
                  <div className="flex h-4 overflow-hidden rounded-full border-2 border-neutral-500" role="radiogroup" aria-label={`参考画像 ${index + 1}の参照強度`}>
                    {GRAPHIC_STRENGTH_LEVELS.map((label, level) => (
                      <button key={label} type="button" role="radio" aria-checked={strengths[index] === level} aria-label={label} disabled={locked} onClick={() => setStrength(index as 0 | 1, level as StrengthIndex)} className={`flex-1 border-r border-[#262a2b] last:border-r-0 ${level <= strengths[index] ? 'bg-[#20d0c4]/70' : 'bg-neutral-600'}`} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
            <h6 className="mt-6 text-base font-normal">デザイン要素の内容</h6>
            {assist && assistTags.length > 0 ? (
              <div data-testid="graphic-design-assist-selected">
                {assistGroups(assistTags).map((group) => (
                  <div key={group.label} className="mt-3">
                    <div className="text-xs text-neutral-400">{group.label}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {group.tags.map((tag) => (
                        <span key={tag} title={tag} className="inline-flex h-8 items-center gap-1.5 rounded-3xl bg-[#3c4043] pl-4 pr-2.5 text-xs text-neutral-200">
                          {tag}
                          <button type="button" aria-label={`${tag}を外す`} disabled={locked} onClick={() => pickAssistTag(`${group.label}:${tag}`)} className="text-neutral-400 hover:text-white"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 flex items-start gap-2 rounded-2xl bg-white/[0.04] px-4 py-2 text-xs leading-[17px] text-neutral-400"><Sparkles aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-300" />AI生成のアシストの為、画像参考強度を選択してください</p>
            )}
            <button type="button" data-testid="graphic-design-generate" onClick={generate} disabled={locked} className="mt-auto flex h-10 w-full shrink-0 items-center justify-center gap-1 rounded-lg bg-[#20d0c4] text-sm font-medium text-neutral-950 disabled:opacity-50">
              AI生成<WandSparkles aria-hidden="true" className="h-4 w-4" />
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
