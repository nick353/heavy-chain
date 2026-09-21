import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Boxes, ChevronDown, ImagePlus, Info, RefreshCw, Shirt, Sparkles, UserRound, Zap } from 'lucide-react';
import { PermissionLockedButton as SourcePermissionLockedButton } from './PermissionLockedButton';

const SOURCE_MODEL_TOOL_VIDEO = 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/persistence/font-end/model-library-custom-demo.mp4';
const SOURCE_FACE_REFERENCE_IMAGE = 'https://jp.linkaigc.com/static/upload-example-head.png';

const sourceModelTools = [
  { label: 'モデルカスタマイズ', href: '/model-library/model-custom-form', icon: UserRound },
  { label: '顔変更', href: '/model-library/head-form', icon: Sparkles },
  { label: 'モデル変更', href: '/model-library/model-change-form', icon: UserRound },
  { label: '体型', href: '/model-library/body-form', icon: Shirt },
  { label: '服のサイズ', href: '/model-library/size-form', icon: Shirt },
  { label: 'ポーズ', href: '/model-library/pose-form', icon: Sparkles },
  { label: '背景', href: '/model-library/background-form', icon: ImagePlus },
  { label: 'アングル', href: '/model-library/perspective-form', icon: Boxes },
] as const;

type SourceModelToolConfig = {
  title: string;
  subtitle: string;
  rightDescription: string;
  referenceTitle: string;
  referenceDescription: string;
  note: string;
  showReferenceLibrary: boolean;
};

const sourceModelToolConfig: Record<string, SourceModelToolConfig> = {
  'head-form': {
    title: '顔変更',
    subtitle: 'スマートにモデルの顔のパーツを入れ替える',
    rightDescription: '元画像と顔参照画像、または参考画像ライブラリから顔を変更。',
    referenceTitle: '顔の参考図',
    referenceDescription: '顔の参考画像をアップロードしなければ、ランダムな顔を直接生成できます。',
    note: '顔の参考画像をアップロードしなければ、ランダムな顔を直接生成できます。',
    showReferenceLibrary: true,
  },
  'model-change-form': {
    title: 'モデル変更',
    subtitle: 'スマートにモデルを入れ替える',
    rightDescription: '元画像とモデル参照画像から、モデルの印象を変更。',
    referenceTitle: 'モデルの参考図',
    referenceDescription: 'モデルの参考画像をアップロードしなければ、ランダムなモデルを直接生成できます。',
    note: 'モデルの参考画像をアップロードしなければ、ランダムなモデルを直接生成できます。',
    showReferenceLibrary: true,
  },
  'body-form': {
    title: '体型',
    subtitle: 'スマートにモデルの体型を調整する',
    rightDescription: '元画像と体型の参考画像から、モデルの体型を変更。',
    referenceTitle: '体型の参考図',
    referenceDescription: '体型の参考画像をアップロードしなければ、ランダムな体型を直接生成できます。',
    note: '体型の参考画像をアップロードしなければ、ランダムな体型を直接生成できます。',
    showReferenceLibrary: false,
  },
  'size-form': {
    title: '服のサイズ',
    subtitle: 'スマートに服のサイズ感を調整する',
    rightDescription: '元画像から服のサイズ感を調整。',
    referenceTitle: 'サイズの参考図',
    referenceDescription: '服のサイズ参考画像をアップロードできます。',
    note: '参考画像をアップロードしなければ、スマートにサイズを調整できます。',
    showReferenceLibrary: false,
  },
  'pose-form': {
    title: 'ポーズ',
    subtitle: 'スマートにモデルのポーズを調整する',
    rightDescription: '元画像とポーズ参照画像から、モデルのポーズを変更。',
    referenceTitle: 'ポーズの参考図',
    referenceDescription: 'ポーズの参考画像をアップロードできます。',
    note: '参考画像をアップロードしなければ、ランダムなポーズを直接生成できます。',
    showReferenceLibrary: false,
  },
  'background-form': {
    title: '背景',
    subtitle: 'スマートに画像の背景を調整する',
    rightDescription: '元画像から、モデル画像の背景を変更。',
    referenceTitle: '背景の参考図',
    referenceDescription: '背景の参考画像をアップロードできます。',
    note: '参考画像をアップロードしなければ、スマートに背景を生成できます。',
    showReferenceLibrary: false,
  },
  'perspective-form': {
    title: 'アングル',
    subtitle: 'スマートにモデル画像のアングルを調整する',
    rightDescription: '元画像から、モデル画像の視点とアングルを変更。',
    referenceTitle: 'アングルの参考図',
    referenceDescription: 'アングルの参考画像をアップロードできます。',
    note: '参考画像をアップロードしなければ、スマートにアングルを生成できます。',
    showReferenceLibrary: false,
  },
};

function SourceUploadCard({
  title,
  description,
  showReferenceLibrary,
  media,
  required,
  onFile,
}: {
  title: string;
  description: string;
  showReferenceLibrary?: boolean;
  media: 'video' | 'image';
  required?: boolean;
  onFile: (file: File | null) => void;
}) {
  return (
    <label className="group relative flex h-40 shrink-0 cursor-pointer flex-col gap-2 rounded-2xl border border-dashed border-white/10 bg-[#262a2b] p-2 transition hover:border-[#0bc1b8] hover:bg-white/[0.03]">
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
      />
      <div className="flex size-full flex-1 gap-2">
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center text-center">
          <ImagePlus className="h-5 w-5 text-[#e3e8e8]" aria-hidden="true" />
          <p className="mt-2 w-full break-words text-[14px] leading-[21px] text-[#e3e8e8]">{title}</p>
          <p className="mt-1 max-w-[225px] text-[12px] leading-[17.1429px] text-[#aab8b6]">
            {showReferenceLibrary ? (
              <>
                <span className="cursor-pointer text-[#20d0c4] underline" onClick={(event) => event.preventDefault()}>アップロード</span>
                {' または '}
                <span className="cursor-pointer text-[#20d0c4] underline" onClick={(event) => event.preventDefault()}>参考画像ライブラリ</span>
                {' 選択'}
              </>
            ) : description}
          </p>
          {required && <span className="mt-2 rounded-lg bg-[#0bc1b8] px-2 py-1 text-[12px] font-medium leading-[17.1429px] text-[#111817]">必須項目</span>}
        </div>
        <div className="relative h-full w-[106.5px] shrink-0 overflow-hidden rounded-lg bg-[#1b2021]">
          {media === 'video' ? (
            <video className="size-full object-cover" src={SOURCE_MODEL_TOOL_VIDEO} autoPlay muted loop playsInline />
          ) : (
            <img className="size-full object-cover" src={SOURCE_FACE_REFERENCE_IMAGE} alt="demo" />
          )}
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1.5 py-0.5 text-[12px] leading-[17.1429px] text-white">例</span>
        </div>
      </div>
    </label>
  );
}

export function SourceModelToolSurface() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sourceFileName, setSourceFileName] = useState('');
  const [referenceFileName, setReferenceFileName] = useState('');
  const toolKey = location.pathname.split('/').filter(Boolean).at(-1) ?? 'head-form';
  const config = sourceModelToolConfig[toolKey] ?? sourceModelToolConfig['head-form'];
  const activeIndex = Math.max(0, sourceModelTools.findIndex((tool) => tool.href.endsWith(toolKey)));

  return (
    <div
      className="flex h-[calc(100vh-50px)] min-h-[640px] w-full overflow-hidden bg-[#171b1c] text-white"
      style={{ fontFamily: '-apple-system, "system-ui", "Segoe UI", "PingFang SC", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif' }}
      data-testid="lightchain-source-model-tool-surface"
      data-source-tool={toolKey}
    >
      <nav aria-label="モデルツール" className="w-20 shrink-0 border-r border-white/10 bg-[#171b1c] px-2 py-2">
        <div className="flex flex-col gap-2">
          {sourceModelTools.map(({ label, href, icon: Icon }, index) => (
            <button
              key={label}
              type="button"
              onClick={() => navigate(href)}
              aria-current={index === activeIndex ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-y-1 rounded-lg border px-1 py-2 text-center text-[12px] font-normal leading-[17.1429px] transition ${
                index === activeIndex
                  ? 'border-[#65d3cf] bg-[#273233] text-[#65d3cf]'
                  : 'border-transparent text-neutral-300 hover:border-white/15 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              <Icon className="h-6 w-6" strokeWidth={1.7} aria-hidden="true" />
              <span className={index === 0 ? 'w-[61px]' : ''}>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      <aside className="relative flex w-[432px] shrink-0 flex-col border-r border-white/10 bg-[#171b1c]">
        <div className="flex-1 overflow-y-auto px-4 pb-5 pt-4">
          <h1 className="text-base font-medium leading-6 text-white">{config.title}</h1>
          <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto">
            <SourceUploadCard
              title="元の画像"
              description="クリック/ドラッグ＆ドロップで追加します。"
              media="video"
              required
              onFile={(file) => setSourceFileName(file?.name ?? '')}
            />
            <div className="h-px shrink-0 bg-white/10" />
            <div className="-mt-2 flex flex-col gap-4">
              <p className="text-sm font-medium leading-6 text-[#e3e8e8]">画像をアップロード</p>
              <SourceUploadCard
                title={config.referenceTitle}
                description={config.referenceDescription}
                showReferenceLibrary={config.showReferenceLibrary}
                media="image"
                onFile={(file) => setReferenceFileName(file?.name ?? '')}
              />
            </div>
            <div className="flex gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#aab8b6]" aria-hidden="true" />
              <p className="text-[12px] leading-5 text-[#aab8b6]">{config.note}</p>
            </div>
            {(sourceFileName || referenceFileName) && (
              <p className="text-[12px] text-[#65d3cf]" role="status">
                {sourceFileName || referenceFileName}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-end gap-2 border-t border-white/10 px-2 py-4">
          <button type="button" className="flex h-10 w-[104px] items-center justify-between rounded-md border border-white/10 bg-[#262a2b] px-2 text-sm text-[#e3e8e8]">
            <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] border border-[#e3e8e8] text-[6px] leading-none">Auto</span>
            スマート
            <ChevronDown className="h-4 w-4 text-[#aab8b6]" aria-hidden="true" />
          </button>
          <button type="button" className="flex h-[43px] w-24 items-center justify-between gap-1 rounded-md border border-white/10 bg-[#262a2b] px-2 text-sm text-[#e3e8e8]">
            <Zap className="h-4 w-4 text-[#e3e8e8]" aria-hidden="true" />
            1K
            <ChevronDown className="h-4 w-4 text-[#aab8b6]" aria-hidden="true" />
          </button>
          <SourcePermissionLockedButton
            testId="lightchain-model-tool-permission"
            marginClass=""
            disabled={false}
            showSourceIcon
            className="!h-10 !flex-1 !rounded-lg !bg-[#0bc1b8] !text-[12px] !leading-[17.1429px] !text-[#111817] !opacity-100"
          />
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 bg-[#171b1c]">
        <button
          type="button"
          onClick={() => navigate('/history')}
          className="absolute right-4 top-4 z-10 inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-[#171b1c] px-3 py-2 text-[12px] font-medium leading-[17.1429px] text-white transition hover:border-white/25 hover:bg-white/[0.04]"
        >
          <RefreshCw className="h-5 w-5" aria-hidden="true" />
          生成履歴
        </button>
        <div className="flex h-full flex-col items-center justify-center px-10 text-center">
          <h2 className="font-[AlimamaFangYuanTiVF] text-lg font-bold leading-[25.2px] text-white">{config.title}</h2>
          <p className="mt-2 text-sm leading-[21px] text-[#aab8b6]">{config.subtitle}</p>
        </div>
      </main>
    </div>
  );
}
