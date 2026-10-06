import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, ImagePlus, Plus, Sparkles, WandSparkles } from 'lucide-react';
import { useCanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';

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
const GRAPHIC_VIDEO = 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/tools/ja/%E5%8D%B0%E6%9F%93%E4%B8%8A%E8%BA%AB.mp4';

const readStrengths = (value: unknown): [StrengthIndex, StrengthIndex] => {
  const list = Array.isArray(value) ? value : [];
  const at = (index: number): StrengthIndex => {
    const raw = list[index];
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 4 ? raw as StrengthIndex : DEFAULT_STRENGTH;
  };
  return [at(0), at(1)];
};

export function graphicDesignBrief(referenceCount: number, strengths: readonly StrengthIndex[], assist: boolean): string {
  return [
    'AIグラフィックデザイン: 参考画像から、アパレル向けのオリジナル柄・プリントグラフィックを作成してください。',
    ...Array.from({ length: referenceCount }, (_, index) => `参考画像${index + 1}の参照強度: ${GRAPHIC_STRENGTH_LEVELS[strengths[index] ?? DEFAULT_STRENGTH]}`),
    assist ? 'アシスト: 参考画像のデザイン要素（モチーフ・配色・構図）を解析して反映してください。' : '',
  ].filter(Boolean).join('\n');
}

export function LightchainGraphicDesignPage() {
  const { user, currentBrand } = useAuthStore();
  return <LightchainGraphicDesignWorkspace key={JSON.stringify([currentBrand?.id, user?.id])} />;
}

function LightchainGraphicDesignWorkspace() {
  const workspace = useCanonicalImageWorkspace('print-design-project', {
    requiredSources: 1,
    title: 'AIグラフィックデザイン',
    initialInputState: { referenceStrengths: [DEFAULT_STRENGTH, DEFAULT_STRENGTH], assist: false },
  });
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selected, setSelected] = useState<0 | 1>(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const references = [workspace.slots.primary, workspace.slots.secondary].filter((slot): slot is NonNullable<typeof slot> => Boolean(slot));
  const strengths = readStrengths(workspace.inputState.referenceStrengths);
  const assist = workspace.inputState.assist === true;
  const locked = workspace.status === 'running' || workspace.status === 'loading' || Boolean(workspace.pendingId);
  const preview = references[Math.min(selected, references.length - 1)] ?? null;

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
    const free = (['primary', 'secondary'] as const).filter((key) => !workspace.slots[key]);
    files.slice(0, free.length).forEach((file, index) => { void workspace.upload(free[index], file); });
    if (files.length > 0 && free.length > 0) setSelected(references.length === 0 ? 0 : 1);
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
    void workspace.generate({ brief: graphicDesignBrief(references.length, strengths, assist) });
  };

  return (
    <div className="lightchain-graphic-design flex h-[calc(100vh-50px)] min-h-[700px] gap-4 overflow-hidden bg-[#171b1c] p-4 text-white" data-testid="graphic-design-page" data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId ?? ''} data-resume-state={workspace.status}>
      <input ref={inputRef} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" multiple disabled={locked} onChange={handleFiles} aria-label="参考画像ファイル" data-testid="graphic-design-file-input" />
      <section className="flex w-80 shrink-0 flex-col rounded-lg bg-[#262a2b] p-4" aria-label="画像をアップロード">
        <h6 className="flex h-8 items-center text-base font-normal text-white">画像をアップロード</h6>
        {references.length === 0 ? (
          <button type="button" data-testid="graphic-design-upload" onClick={() => inputRef.current?.click()} disabled={locked} className="mt-4 flex h-72 w-full shrink-0 flex-col items-center justify-center rounded border border-dashed border-transparent bg-[#333839] p-4 text-neutral-400 transition hover:border-[#20d0c4]">
            <ImagePlus aria-hidden="true" className="h-6 w-6 text-neutral-300" />
            <span className="mt-2 w-full break-words text-center text-base text-neutral-300">画像をアップロードします</span>
            <span className="mt-1 break-words text-center text-sm text-neutral-500">jpg、jpeg、png、webpに対応しています。サイズ20M以内の画像を2枚までアップロードできます</span>
          </button>
        ) : (
          <>
            <div className="mt-4 flex gap-2" data-testid="graphic-design-thumbnails">
              {references.map((reference, index) => (
                <div key={`${index}-${reference.imageUrl}`} className="group relative">
                  <button type="button" onClick={() => setSelected(index as 0 | 1)} aria-label={`参考画像 ${index + 1}`} aria-pressed={selected === index} className={`block size-[52px] overflow-hidden rounded border-2 bg-white ${selected === index ? 'border-[#20d0c4]' : 'border-transparent'}`}>
                    <img src={reference.imageUrl} alt="" className="size-full object-cover" />
                  </button>
                  <button type="button" onClick={() => removeReference(index as 0 | 1)} disabled={locked} aria-label={`参考画像 ${index + 1}を削除`} className="absolute -right-1.5 -top-1.5 hidden size-4 items-center justify-center rounded-full bg-black/70 text-[10px] leading-none text-white group-hover:flex">×</button>
                </div>
              ))}
              {references.length < MAX_REFERENCES && (
                <button type="button" onClick={() => inputRef.current?.click()} disabled={locked} aria-label="画像を追加" className="flex size-[52px] items-center justify-center rounded border border-dashed border-white/25 text-neutral-300 hover:border-[#20d0c4]">
                  <Plus aria-hidden="true" className="h-5 w-5" />
                </button>
              )}
            </div>
            {preview && (
              <div className="mt-2 flex h-72 w-full shrink-0 items-center justify-center overflow-hidden rounded border border-[#20d0c4] bg-[#333839]" data-testid="graphic-design-preview">
                <img src={preview.imageUrl} alt="選択中の参考画像" className="max-h-full max-w-full object-contain" />
                <span className="sr-only" data-testid="graphic-design-preview-name">{preview.name}</span>
              </div>
            )}
            <label className="mt-0 flex items-center justify-between rounded-b bg-[#2f3436] px-4 py-3 text-sm text-neutral-300">
              <span>アシスト機能を起動します</span>
              <button type="button" role="switch" aria-checked={assist} aria-label="アシスト機能を起動します" disabled={locked} onClick={() => setInput({ assist: !assist })} className={`relative h-5 w-11 rounded-full transition ${assist ? 'bg-[#20d0c4]' : 'bg-neutral-500'}`}>
                <span className={`absolute top-0.5 size-4 rounded-full bg-white transition ${assist ? 'left-[26px]' : 'left-0.5'}`} />
              </button>
            </label>
            <p className="mt-4 flex items-start gap-2 rounded-2xl bg-white/[0.04] px-4 py-2 text-xs leading-[17px] text-neutral-400"><Sparkles aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-300" />アシスト機能をオンにして、デザイン要素を解析します</p>
          </>
        )}
      </section>

      <div className="flex min-w-[596px] flex-1 p-4">
      <main className="relative flex min-w-0 flex-1 rounded-lg bg-[#262a2b] p-4" aria-label="AIグラフィックデザイン">
        <button type="button" onClick={() => setHistoryOpen((open) => !open)} className="absolute right-4 top-4 z-10 flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-[#171b1c] pl-2.5 pr-4 text-sm font-medium text-white">
          <Clock3 aria-hidden="true" className="h-5 w-5" />生成履歴
        </button>
        <div className="flex size-full flex-col items-center justify-center px-10">
          {resultUrl ? (
            <img src={resultUrl} alt="生成結果" data-testid="graphic-design-result" className="max-h-[70%] max-w-full rounded-lg object-contain" />
          ) : (
            <>
              <h5 className="text-xl font-bold text-[#20d0c4]">AIグラフィックデザイン</h5>
              <p className="mt-2 w-[328px] text-center text-sm text-neutral-400">AIでグラフィックを作成</p>
              <div className="mt-4 h-[340px] w-full"><video src={GRAPHIC_VIDEO} className="size-full" autoPlay controls muted playsInline aria-label="AIグラフィックデザイン動画" /></div>
            </>
          )}
          {workspace.status === 'running' && <p role="status" className="mt-4 text-sm text-neutral-300">生成中です…</p>}
          {workspace.error && <p role="alert" className="mt-4 text-sm text-rose-300">{workspace.error}</p>}
        </div>
        {historyOpen && (
          <section className="absolute right-4 top-14 z-20 w-72 rounded-lg border border-white/10 bg-[#171b1c] p-4 text-sm" aria-label="生成履歴">
            <p className="text-neutral-400">生成履歴は履歴画面で確認できます。</p>
            <button type="button" className="mt-3 text-[#20d0c4] underline" onClick={() => navigate('/history')}>履歴を開く</button>
          </section>
        )}
      </main>
      </div>

      <aside className="flex w-80 shrink-0 flex-col overflow-auto rounded-lg bg-[#262a2b] p-4" aria-label="生成設定" data-testid="graphic-design-settings">
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
            <p className="mt-3 flex items-start gap-2 rounded-2xl bg-white/[0.04] px-4 py-2 text-xs leading-[17px] text-neutral-400"><Sparkles aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-300" />AI生成のアシストの為、画像参考強度を選択してください</p>
            <button type="button" data-testid="graphic-design-generate" onClick={generate} disabled={locked} className="mt-auto flex h-10 w-full shrink-0 items-center justify-center gap-1 rounded-lg bg-[#20d0c4] text-sm font-medium text-neutral-950 disabled:opacity-50">
              AI生成<WandSparkles aria-hidden="true" className="h-4 w-4" />
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
