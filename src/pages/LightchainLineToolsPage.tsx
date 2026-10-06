import { useEffect, useState, type ChangeEvent } from 'react';
import { ChevronDown, ImagePlus, RotateCw, Sparkles } from 'lucide-react';
import { useCanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';
import { useHeavyWorkspaceBrandGate } from '../hooks/useHeavyWorkspaceBrandGate';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import { LightchainDesignToolFrame } from '../components/lightchain/LightchainDesignToolFrame';

/**
 * Light `/tools/line-draft-to-tile` (線画の実写化) and `/tools/line` (平絵生成), measured at 1440×900 on 2026-10-07.
 * Both share the デザインツール frame: 564×280 reference box, a 244px two-way source-type toggle with リセット,
 * a fixed 288px 生成画像の種類 select, (line-to-real only) a 200-character スタイルのカスタム説明, and the
 * 288×40 run button. Light shows 権限がありません on this account; Heavy runs the real generation.
 */
export type LineToolMode = 'line-to-real' | 'line-generation';
const STYLE_LIMIT = 200;

const LINE_TOOLS = {
  'line-to-real': {
    tab: 'line-draft' as const,
    title: '線画の実写化',
    description: '平絵を編集可能なベクター画像に変換します',
    sourceTypes: ['カラー線画', 'モノクロ線画'] as const,
    outputType: '平置き画像',
    stylePrompt: true,
  },
  'line-generation': {
    tab: 'line' as const,
    title: '平絵生成',
    description: '衣類の着用画像や平置き画像から平絵に変換',
    sourceTypes: ['平置き画像', 'モデル図'] as const,
    outputType: '線画',
    stylePrompt: false,
  },
};

export function lineToolBrief(mode: LineToolMode, sourceType: string, style: string): string {
  if (mode === 'line-to-real') {
    return [
      `線画の実写化: アップロードした${sourceType}の衣服デザインを、実物の衣服を撮影した平置き画像として描き起こしてください。`,
      '線画のシルエット・パーツ・ディテール・配色の指示を正確に保ち、素材の質感と自然な陰影をつけてください。白い背景、人物なし。',
      style.trim() ? `スタイルの指定: ${style.trim()}` : '',
    ].filter(Boolean).join('\n');
  }
  return [
    `平絵生成: アップロードした${sourceType}の衣服を、正面から見た平絵（技術画・フラットスケッチの線画）に変換してください。`,
    '黒の均一な線で輪郭・縫い目・パーツを描き、塗りや陰影・人物・背景は描かないでください。白い背景。',
  ].join('\n');
}

export function LightchainLineToolsPage({ mode }: { mode: LineToolMode }) {
  const { user, currentBrand } = useAuthStore();
  return <LightchainLineToolWorkspace key={JSON.stringify([mode, currentBrand?.id, user?.id])} mode={mode} />;
}

function LightchainLineToolWorkspace({ mode }: { mode: LineToolMode }) {
  const tool = LINE_TOOLS[mode];
  const workspace = useCanonicalImageWorkspace(mode, {
    requiredSources: 1,
    title: tool.title,
    initialInputState: { sourceType: tool.sourceTypes[0], styleNote: '' },
  });
  const heavyBrand = useHeavyWorkspaceBrandGate();
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const locked = heavyBrand.pending || workspace.status === 'running' || workspace.status === 'loading' || Boolean(workspace.pendingId);
  const source = workspace.slots.primary;
  const sourceType = (tool.sourceTypes as readonly string[]).includes(String(workspace.inputState.sourceType)) ? String(workspace.inputState.sourceType) : tool.sourceTypes[0];
  const styleNote = typeof workspace.inputState.styleNote === 'string' ? workspace.inputState.styleNote : '';

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

  const setInput = (patch: Record<string, string>) => workspace.setInputState({ ...workspace.inputState, ...patch });
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void workspace.upload('primary', file);
  };
  const reset = () => {
    if (locked) return;
    workspace.clearSource('primary');
    setInput({ sourceType: tool.sourceTypes[0], styleNote: '' });
  };
  const generate = () => {
    if (locked || !source) return;
    void workspace.generate({ brief: lineToolBrief(mode, sourceType, styleNote) });
  };

  const controls = (
    <div className="flex flex-1 flex-col">
      <label data-testid="line-tool-source-input" className="mt-[18px] flex h-[280px] shrink-0 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-transparent bg-[#33393b] text-center transition hover:border-[#20d0c4]">
        <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={handleFile} aria-label="参考画像をアップロードしてください" />
        {source ? (
          <>
            <img src={source.imageUrl} alt="参考画像" data-source-slot="primary" className="max-h-full max-w-full object-contain" />
            <span className="sr-only" data-testid="line-tool-file-name">{source.name}</span>
          </>
        ) : (
          <>
            <ImagePlus aria-hidden="true" className="h-6 w-6 text-neutral-200" />
            <span className="mt-2 text-base text-neutral-200">参考画像をアップロードしてください</span>
            <span className="mt-1 text-xs text-neutral-400">20MB以下の画像アップロードしてください</span>
          </>
        )}
      </label>

      <div className="mt-[18px] flex h-5 items-center justify-between">
        <h6 className="text-base font-normal text-white/90">アップロードする画像のタイプを選択してください</h6>
        <button type="button" onClick={reset} disabled={locked} className="inline-flex items-center gap-1 text-sm text-white/80 hover:text-white">
          <RotateCw aria-hidden="true" className="h-3 w-3" />リセット
        </button>
      </div>
      <div role="group" aria-label="アップロードする画像のタイプ" className="mt-[18px] grid h-[30px] w-[244px] grid-cols-2 rounded-full bg-[#2b3133] p-[2px]">
        {tool.sourceTypes.map((value) => (
          <button key={value} type="button" aria-pressed={sourceType === value} disabled={locked} onClick={() => setInput({ sourceType: value })} className={`rounded-full text-sm transition ${sourceType === value ? 'bg-[#4b5153] text-white' : 'text-white/70 hover:text-white'}`}>
            {value}
          </button>
        ))}
      </div>

      <p className="mt-4 text-sm leading-[18px] text-white/90">生成画像の種類</p>
      <div role="combobox" aria-disabled="true" aria-expanded="false" aria-label="生成画像の種類" className="mt-1 flex h-8 w-[288px] items-center justify-between rounded-md border border-white/10 bg-white/[0.06] px-2.5 text-sm text-white/45">
        {tool.outputType}<ChevronDown aria-hidden="true" className="h-4 w-4" />
      </div>

      {tool.stylePrompt && (
        <>
          <div className="mt-4 flex h-[18px] items-center gap-2 text-sm text-white/90">スタイルのカスタム説明<span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/70">オプション</span></div>
          <div className="mt-1 h-[122px] rounded-lg border border-white/15 bg-transparent px-3 pt-3">
            <textarea
              aria-label="スタイルのカスタム説明"
              value={styleNote}
              maxLength={STYLE_LIMIT}
              disabled={locked}
              onChange={(event) => setInput({ styleNote: event.target.value.slice(0, STYLE_LIMIT) })}
              placeholder={'キーワードを入力してください　例：\n1.素材：デニム、ニット、シルク\n2.カラー：カーキ、ブルー×ホワイトストライプ\n3.スタイル：シングルボタン、小さめの襟、コントラストカラーの金属ジッパー'}
              className="h-[74px] w-full resize-none bg-transparent text-xs leading-[17px] text-white outline-none placeholder:text-white/40"
            />
            <div className="flex items-center justify-end gap-2 text-xs text-white/60">
              <span>{styleNote.length}/{STYLE_LIMIT}</span>
              <button type="button" disabled={locked || !styleNote} onClick={() => setInput({ styleNote: '' })} className="rounded-full bg-white/10 px-3 py-1 text-white/70 disabled:opacity-50">全削除</button>
            </div>
          </div>
        </>
      )}

      {heavyBrand.failed && <p role="alert" className="mt-3 text-sm text-rose-200">ワークスペースを準備できません。ページを再読み込みしてください。</p>}
      {workspace.error && <p role="alert" className="mt-3 text-sm text-rose-200">{workspace.error}</p>}
      {workspace.pendingId && <button type="button" disabled={workspace.status === 'running'} onClick={() => void workspace.reconcile()} className="mt-3 self-start rounded-lg border border-white/15 px-3 py-2 text-sm text-white/85 disabled:opacity-40">同じ依頼を照合</button>}
      <div className="mt-auto flex justify-end pt-4">
        <button type="button" data-testid="line-tool-generate" disabled={locked || !source} onClick={generate} className="inline-flex h-10 w-[288px] items-center justify-center gap-1 rounded-lg bg-[#5fd0c8] text-sm font-medium text-slate-950 transition hover:brightness-105 disabled:opacity-60">
          {workspace.status === 'running' ? '生成中…' : 'AI生成'}<Sparkles aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const result = resultUrl ? (
    <div data-testid="line-tool-result" className="flex h-full flex-col items-center justify-center px-10 pb-6 pt-16">
      <img src={resultUrl} alt={`${tool.title} AI生成`} className="max-h-full max-w-full rounded-lg object-contain" />
    </div>
  ) : workspace.status === 'running' ? (
    <div className="flex h-full items-center justify-center text-sm text-white/70" role="status">生成中…</div>
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center px-14 text-center">
      <h5 className="text-[20px] font-bold leading-[25.2px] text-white">{tool.title}</h5>
      <p className="mt-2 text-sm leading-[21px] text-neutral-400">{tool.description}</p>
    </div>
  );

  return (
    <div className="contents" data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId ?? ''} data-resume-state={workspace.status}>
      <LightchainDesignToolFrame active={tool.tab} testId={`line-tool-page-${mode}`} navigationLocked={locked}>{controls}{result}</LightchainDesignToolFrame>
    </div>
  );
}
