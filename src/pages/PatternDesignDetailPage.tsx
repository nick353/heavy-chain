import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, Hand, ImagePlus, MousePointer2, Redo2, Sparkles, Undo2, ZoomIn } from 'lucide-react';
import { useCanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';
import { useHeavyWorkspaceBrandGate } from '../hooks/useHeavyWorkspaceBrandGate';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';

/**
 * Light `/editor/pattern/detail` = "デザインアレンジ" editor, measured at 1440×900 on 2026-10-07:
 * empty project → 265×84 project card + full-height drop zone; after an upload → 320px tool panel with the
 * デザインアレンジ / デザイン質感アレンジ tabs, 現在の操作画像, 参考画像 (関連付けなし), required 200-char prompt,
 * 生成比率 (自動 1:1 4:3 3:4 16:9 9:16) and the 288×40 run button; centered 選択 / ドラッグ / 前にステップ /
 * 次のステップ toolbar over an infinite canvas with a per-image floating toolbar. Light shows 権限がありません on
 * this account; Heavy runs the arrangement and saves it so a reload restores the inputs and the result.
 */
export const PATTERN_ARRANGE_RATIOS = ['自動', '1:1', '4:3', '3:4', '16:9', '9:16'] as const;
type ArrangeMode = 'design' | 'texture';
const PROMPT_LIMIT = 200;

export function patternArrangeBrief({ mode, prompt, ratio, hasReference }: { mode: ArrangeMode; prompt: string; ratio: string; hasReference: boolean }): string {
  const text = prompt.trim();
  const lines = mode === 'texture'
    ? [
      'デザイン質感アレンジ: 1枚目の画像の柄・モチーフ・配置・配色はそのままに、表現の質感だけを変えてください。',
      hasReference ? '2枚目の参考画像の素材感（刺繍・プリント・織り・箔・ビーズなど）と立体感を再現してください。' : '',
      text ? `質感の指示: ${text}` : '',
    ]
    : [
      `デザインアレンジ: 1枚目の画像のデザイン（柄・グラフィック）を次の指示に沿ってアレンジしてください: ${text}`,
      hasReference ? '2枚目の参考画像のテイスト・モチーフ・配色を取り入れてください。' : '',
    ];
  lines.push('アイテムの形状・シルエット・背景・撮影アングルは元の画像のまま維持し、デザイン部分だけを変更してください。');
  if (ratio !== '自動') lines.push(`出力の縦横比は ${ratio} にしてください。`);
  return lines.filter(Boolean).join('\n');
}

export function RatioIcon({ ratio }: { ratio: string }) {
  if (ratio === '自動') return <span className="flex h-5 w-5 items-center justify-center rounded-[3px] border border-current text-[10px] font-semibold leading-none">A</span>;
  const [w, h] = ratio.split(':').map(Number);
  const scale = 18 / Math.max(w, h);
  return <span className="block rounded-[2px] border border-current" style={{ width: Math.round(w * scale), height: Math.round(h * scale) }} />;
}

export function PatternDesignDetailPage() {
  const { user, currentBrand } = useAuthStore();
  return <PatternDesignDetailWorkspace key={JSON.stringify([currentBrand?.id, user?.id])} />;
}

function PatternDesignDetailWorkspace() {
  const navigate = useNavigate();
  const workspace = useCanonicalImageWorkspace('pattern-arrange', { requiredSources: 1, title: 'デザインアレンジ', initialInputState: { arrangeMode: 'design', arrangeRatio: '自動', arrangePrompt: '' } });
  const heavyBrand = useHeavyWorkspaceBrandGate();
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'drag'>('select');
  const [selected, setSelected] = useState<'source' | 'result' | null>(null);
  const [showResult, setShowResult] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragOrigin = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const locked = heavyBrand.pending || workspace.status === 'running' || workspace.status === 'loading' || Boolean(workspace.pendingId);
  const source = workspace.slots.primary;
  const reference = workspace.slots.secondary;
  const mode: ArrangeMode = workspace.inputState.arrangeMode === 'texture' ? 'texture' : 'design';
  const ratio = typeof workspace.inputState.arrangeRatio === 'string' && (PATTERN_ARRANGE_RATIOS as readonly string[]).includes(workspace.inputState.arrangeRatio) ? workspace.inputState.arrangeRatio : '自動';
  const prompt = typeof workspace.inputState.arrangePrompt === 'string' ? workspace.inputState.arrangePrompt : '';
  const canGenerate = Boolean(source) && !locked && (mode === 'texture' ? Boolean(reference) : prompt.trim().length > 0);

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

  useEffect(() => { if (resultUrl) { setShowResult(true); setSelected('result'); } }, [resultUrl]);

  const updateInput = (patch: { arrangeMode?: ArrangeMode; arrangeRatio?: string; arrangePrompt?: string }) =>
    workspace.setInputState({ arrangeMode: mode, arrangeRatio: ratio, arrangePrompt: prompt, ...patch });
  const setMode = (next: ArrangeMode) => updateInput({ arrangeMode: next });
  const setRatio = (next: string) => updateInput({ arrangeRatio: next });

  const pick = (slot: 'primary' | 'secondary') => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return;
    void workspace.upload(slot, file);
  };

  const generate = () => {
    if (!canGenerate) return;
    // The user's prompt lives in inputState.arrangePrompt (restored verbatim after a reload); the brief carries the full instruction.
    void workspace.generate({ brief: patternArrangeBrief({ mode, prompt, ratio, hasReference: Boolean(reference) }) });
  };

  const visibleResult = Boolean(resultUrl) && showResult;
  const currentImage = visibleResult && selected !== 'source' ? resultUrl : source?.imageUrl ?? null;

  const download = (url: string | null | undefined, name: string) => {
    if (!url) return;
    void fetch(url).then((response) => response.blob()).then((blob) => {
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }).catch(() => window.open(url, '_blank', 'noopener'));
  };

  const onCanvasPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (tool !== 'drag') { if (event.target === event.currentTarget) setSelected(null); return; }
    dragOrigin.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onCanvasPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current;
    if (!origin) return;
    setPan({ x: origin.panX + event.clientX - origin.x, y: origin.panY + event.clientY - origin.y });
  };

  const projectCard = (
    <div className="absolute left-4 top-6 z-20 w-[265px] rounded-xl border border-white/10 bg-[#262a2b] px-4 py-2" data-testid="pattern-arrange-project-card">
      <div className="flex h-8 items-center gap-2 text-sm text-white/70">
        <span className="h-5 w-5 rounded bg-gradient-to-br from-rose-300 via-amber-200 to-orange-400" aria-hidden="true" />デザインアレンジ
      </div>
      <div className="my-1 h-px bg-white/10" />
      <button type="button" disabled={locked} onClick={() => navigate('/editor/pattern')} className="flex h-9 w-full items-center gap-6 text-left text-base text-white/80 disabled:opacity-50">
        <ChevronLeft className="h-4 w-4" aria-label="一覧へ戻る" />
        <span className="truncate">{workspace.result?.title && workspace.result.title !== 'デザインアレンジ' ? workspace.result.title : 'Untitled'}</span>
      </button>
    </div>
  );

  if (!source && workspace.status !== 'loading') {
    return (
      <main className="relative h-[calc(100vh-50px)] overflow-hidden bg-[#171b1c] text-white" data-testid="lightchain-pattern-detail" data-workspace-feature={workspace.toolId} data-resume-state={workspace.status}>
        {projectCard}
        <label className="absolute bottom-4 left-[338px] right-4 top-[134px] flex cursor-pointer flex-col items-center justify-center rounded-lg bg-[#33393b] text-center" data-testid="lightchain-pattern-upload-dropzone">
          <ImagePlus className="h-6 w-6 text-white/80" aria-hidden="true" />
          <span className="mt-3 text-base text-white/90">ここをクリックまたはドラッグして画像を追加</span>
          <span className="mt-2 text-sm text-white/50">jpg、jpeg、png、webp形式の画像（最大20M）に対応</span>
          <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="sr-only" disabled={locked} onChange={pick('primary')} aria-label="ここをクリックまたはドラッグして画像を追加" />
        </label>
        {heavyBrand.failed && <p role="alert" className="absolute bottom-6 left-4 text-sm text-rose-200">ワークスペースを準備できません。ページを再読み込みしてください。</p>}
      </main>
    );
  }

  const imageToolbar = (kind: 'source' | 'result', url: string) => (
    <div className="absolute -top-14 left-1/2 z-10 flex h-10 -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-[#262a2b] px-3 text-white/85 shadow-lg" data-testid={`pattern-arrange-${kind}-toolbar`}>
      <button type="button" title="現在の操作画像に設定" aria-label="現在の操作画像に設定" onClick={() => setSelected(kind)} className="hover:text-white"><MousePointer2 className="h-5 w-5" /></button>
      <label title="画像を差し替え" aria-label="画像を差し替え" className={`cursor-pointer hover:text-white ${kind === 'result' ? 'hidden' : ''}`}>
        <ImagePlus className="h-5 w-5" />
        <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="sr-only" disabled={locked} onChange={pick('primary')} />
      </label>
      <button type="button" title="ダウンロード" aria-label="ダウンロード" onClick={() => download(url, kind === 'result' ? 'デザインアレンジ.png' : source?.name ?? '元画像.png')} className="hover:text-white"><Download className="h-5 w-5" /></button>
    </div>
  );

  return (
    <main className="relative h-[calc(100vh-50px)] overflow-hidden bg-[#171b1c] text-white" data-testid="lightchain-pattern-detail" data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId ?? ''} data-resume-state={workspace.status}>
      <div
        className={`absolute inset-0 ${tool === 'drag' ? 'cursor-grab active:cursor-grabbing' : ''}`}
        data-testid="pattern-arrange-canvas"
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={() => { dragOrigin.current = null; }}
      >
        <div className="absolute left-1/2 top-1/2 flex items-center gap-16" style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y + 28}px)) scale(${zoom})` }}>
          {source && (
            <div className={`relative ${selected === 'source' ? 'ring-2 ring-[#5aa9ff]' : ''}`} onPointerDown={(event) => { if (tool === 'select') { event.stopPropagation(); setSelected('source'); } }}>
              {selected === 'source' && imageToolbar('source', source.imageUrl)}
              <img src={source.imageUrl} alt="元画像" data-source-slot="primary" className="block max-h-[150px] max-w-[150px] select-none object-contain" draggable={false} />
            </div>
          )}
          {visibleResult && resultUrl && (
            <div data-testid="pattern-arrange-result" className={`relative ${selected === 'result' ? 'ring-2 ring-[#5aa9ff]' : ''}`} onPointerDown={(event) => { if (tool === 'select') { event.stopPropagation(); setSelected('result'); } }}>
              {selected === 'result' && imageToolbar('result', resultUrl)}
              <img src={resultUrl} alt="デザインアレンジ AI生成" className="block max-h-[420px] max-w-[460px] select-none object-contain" draggable={false} />
            </div>
          )}
          {workspace.status === 'running' && <div className="flex h-[260px] w-[260px] items-center justify-center rounded-lg bg-white/[0.04] text-sm text-white/70" role="status">生成中…</div>}
        </div>
      </div>

      {projectCard}

      <nav aria-label="キャンバスツール" className="absolute left-1/2 top-6 z-20 flex h-[58px] -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-[#262a2b] px-1 text-xs text-white/80">
        {([['select', '選択', MousePointer2], ['drag', 'ドラッグ', Hand]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" aria-pressed={tool === id} onClick={() => setTool(id)} className={`flex h-[50px] w-12 flex-col items-center justify-center gap-1 rounded-lg ${tool === id ? 'bg-white/10 text-white' : 'hover:bg-white/5'}`}><Icon className="h-5 w-5" />{label}</button>
        ))}
        <span className="mx-1 h-8 w-px bg-white/10" />
        <button type="button" disabled={!visibleResult} onClick={() => { setShowResult(false); setSelected('source'); }} className="flex h-[50px] w-20 flex-col items-center justify-center gap-1 rounded-lg hover:bg-white/5 disabled:text-white/30"><Undo2 className="h-5 w-5" />前にステップ</button>
        <button type="button" disabled={!resultUrl || showResult} onClick={() => { setShowResult(true); setSelected('result'); }} className="flex h-[50px] w-20 flex-col items-center justify-center gap-1 rounded-lg hover:bg-white/5 disabled:text-white/30"><Redo2 className="h-5 w-5" />次のステップ</button>
      </nav>

      <section className="absolute left-4 top-[121px] z-20 flex max-h-[calc(100%-137px)] w-[320px] flex-col overflow-y-auto rounded-xl border border-white/10 bg-[#262a2b] scrollbar-hide" data-testid="pattern-arrange-panel">
        <div role="tablist" aria-label="デザインアレンジ" className="flex h-12 shrink-0 items-center">
          {([['design', 'デザインアレンジ'], ['texture', 'デザイン質感アレンジ']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} disabled={locked} onClick={() => setMode(id)} className={`h-[31px] whitespace-nowrap rounded-lg px-3 text-[15px] ${mode === id ? 'bg-[#3c4245] text-white' : 'text-white/70'}`}>{label}</button>
          ))}
        </div>
        <div role="tabpanel" className="flex flex-col px-4 pb-4">
          <div className="mt-3 flex items-center gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-white/5">{currentImage && <img src={currentImage} alt="" className="h-full w-full object-cover" />}</div>
            <span className="text-sm text-white/90">現在の操作画像</span>
            {source && <span className="sr-only" data-testid="pattern-arrange-file-name">{source.name}</span>}
          </div>

          <p className="mt-5 text-sm text-white/70">参考画像{mode === 'texture' && <span className="ml-2 rounded bg-[#5fd0c8] px-1.5 py-0.5 text-xs text-slate-950">必須項目</span>}</p>
          <div className="mt-2 flex h-[58px] items-center gap-3 rounded-lg border border-white/10 px-2">
            <label className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-md bg-white/10" aria-label="参考画像をアップロード">
              {reference && <img src={reference.imageUrl} alt="参考画像" className="h-full w-full object-cover" />}
              <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="sr-only" disabled={locked} onChange={pick('secondary')} />
            </label>
            {reference
              ? <button type="button" disabled={locked} onClick={() => workspace.clearSource('secondary')} className="ml-auto text-sm text-white/60 hover:text-white">関連付けを解除</button>
              : <label className="ml-auto flex cursor-pointer items-center gap-1 text-sm text-white/60">関連付けなし<ChevronRight className="h-4 w-4" /><input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="sr-only" disabled={locked} onChange={pick('secondary')} /></label>}
          </div>

          <p className="mt-5 flex items-center gap-1 text-sm text-white/70">プロンプト{mode === 'design' && <span className="rounded bg-[#5fd0c8] px-1.5 py-0.5 text-xs text-slate-950">必須項目</span>}</p>
          <div className="mt-2 rounded-lg border border-white/15 px-3 pb-2 pt-2">
            <textarea
              value={prompt}
              maxLength={PROMPT_LIMIT}
              disabled={locked}
              onChange={(event) => updateInput({ arrangePrompt: event.target.value.slice(0, PROMPT_LIMIT) })}
              placeholder={mode === 'design' ? 'パターン構成に関するキーワードを入力してください' : '質感に関するキーワードを入力してください'}
              aria-label="プロンプト"
              className="h-[82px] w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            />
            <div className="flex items-center justify-end gap-3 text-xs">
              <span className="text-white/60"><span className="text-[#5fd0c8]">{prompt.length}</span>/{PROMPT_LIMIT}</span>
              <button type="button" disabled={locked || !prompt} onClick={() => updateInput({ arrangePrompt: '' })} className="rounded-full bg-white/10 px-3 py-1 text-white/70 disabled:opacity-40">全削除</button>
            </div>
          </div>

          <p className="mt-5 text-sm text-white/70">生成比率</p>
          <div className="mt-2 grid grid-cols-6 gap-[9px]" role="radiogroup" aria-label="生成比率">
            {PATTERN_ARRANGE_RATIOS.map((value) => (
              <button key={value} type="button" role="radio" aria-checked={ratio === value} disabled={locked} onClick={() => setRatio(value)} className={`flex h-12 flex-col items-center justify-center gap-1 rounded-lg border text-[11px] ${ratio === value ? 'border-[#5fd0c8] text-[#5fd0c8]' : 'border-white/10 text-white/60'}`}>
                <RatioIcon ratio={value} />{value}
              </button>
            ))}
          </div>

          {heavyBrand.failed && <p role="alert" className="mt-3 text-sm text-rose-200">ワークスペースを準備できません。ページを再読み込みしてください。</p>}
          {workspace.error && <p role="alert" className="mt-3 text-sm text-rose-200">{workspace.error}</p>}
          {workspace.pendingId && workspace.status !== 'running' && <button type="button" onClick={() => void workspace.reconcile()} className="mt-3 self-start rounded-lg border border-white/15 px-3 py-2 text-sm text-white/85">同じ依頼を照合</button>}
          <button type="button" data-testid="pattern-arrange-generate" disabled={!canGenerate} onClick={generate} className="mt-4 inline-flex h-10 w-[288px] items-center justify-center gap-1 rounded-lg bg-[#5fd0c8] text-sm font-medium text-slate-950 transition hover:brightness-105 disabled:opacity-50">
            {workspace.status === 'running' ? '生成中…' : 'AI生成'}<Sparkles aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </section>

      <ZoomControl zoom={zoom} onChange={setZoom} onReset={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} />
    </main>
  );
}

export function ZoomControl({ zoom, onChange, onReset }: { zoom: number; onChange: (value: number) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const steps = useMemo(() => [0.5, 0.75, 1, 1.5, 2], []);
  return (
    <div className="absolute bottom-[10px] right-[80px] z-20">
      {open && (
        <div className="absolute bottom-10 right-0 w-28 rounded-lg border border-white/10 bg-[#262a2b] py-1 text-sm text-white/80">
          {steps.map((value) => <button key={value} type="button" onClick={() => { onChange(value); setOpen(false); }} className={`block w-full px-3 py-1.5 text-left hover:bg-white/5 ${zoom === value ? 'text-[#5fd0c8]' : ''}`}>{Math.round(value * 100)}%</button>)}
          <button type="button" onClick={() => { onReset(); setOpen(false); }} className="block w-full px-3 py-1.5 text-left hover:bg-white/5">画面に合わせる</button>
        </div>
      )}
      <button type="button" aria-label="表示倍率" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#262a2b] text-white/80"><ZoomIn className="h-4 w-4" /></button>
    </div>
  );
}
