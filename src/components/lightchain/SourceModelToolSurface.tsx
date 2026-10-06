import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Boxes, ChevronDown, ImagePlus, Info, RefreshCw, Shirt, Sparkles, UserRound } from 'lucide-react';
import { useCanonicalImageWorkspace, type CanonicalWorkspaceFeature } from '../../hooks/useCanonicalImageWorkspace';
import { CanonicalImageWorkspaceControls } from '../CanonicalImageWorkspaceControls';
import { GallerySelector } from '../GallerySelector';

import { MODEL_ASPECT_OPTIONS, MODEL_RESOLUTION_OPTIONS, MODEL_TOOL_FIELDS, MODEL_BODY_PROFILES, MODEL_BODY_MEASUREMENTS, defaultModelToolSettings, readModelToolSettings, readLegacyModelToolSettings, chooseModelCustomBody, changeModelBodyGender, validModelBodyMeasurement, isModelDescriptionFeature, type ModelToolFeature, type ModelBodyMeasurement } from '../../lib/modelToolSettings';

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
    rightDescription: '元画像から、選択した性別と体型でモデルの体型を変更。',
    referenceTitle: '体型の参考図',
    referenceDescription: '体型の参考画像をアップロードしなければ、ランダムな体型を直接生成できます。',
    note: '性別と体型を選択してください。',
    showReferenceLibrary: false,
  },
  'size-form': {
    title: '服のサイズ',
    subtitle: 'スマートに服のサイズ感を調整する',
    rightDescription: '元画像から服のサイズ感を調整。',
    referenceTitle: 'サイズの参考図',
    referenceDescription: '服のサイズ参考画像をアップロードできます。',
    note: '元のサイズと変更サイズを選択してください。',
    showReferenceLibrary: false,
  },
  'pose-form': {
    title: 'ポーズ',
    subtitle: 'スマートにモデルのポーズを調整する',
    rightDescription: '元画像とポーズ参照画像から、モデルのポーズを変更。',
    referenceTitle: 'ポーズの参考図',
    referenceDescription: 'ポーズの参考画像をアップロードできます。',
    note: '参考画像をアップロードしなければ、ランダムなポーズを直接生成できます。',
    showReferenceLibrary: true,
  },
  'background-form': {
    title: '背景',
    subtitle: 'スマートに画像の背景を調整する',
    rightDescription: '元画像から、モデル画像の背景を変更。',
    referenceTitle: '背景の参考図',
    referenceDescription: '背景の参考画像をアップロードできます。',
    note: '参考画像をアップロードしなければ、スマートに背景を生成できます。',
    showReferenceLibrary: true,
  },
  'perspective-form': {
    title: 'アングル',
    subtitle: 'スマートにモデル画像のアングルを調整する',
    rightDescription: '元画像から、モデル画像の視点とアングルを変更。',
    referenceTitle: 'アングルの参考図',
    referenceDescription: 'アングルの参考画像をアップロードできます。',
    note: '左右・上下・ズームの調整を選択してください。',
    showReferenceLibrary: false,
  },
};

function SourceUploadCard({
  title,
  description,
  showReferenceLibrary,
  media,
  required,
  onFile,onLibrary,disabled=false,preview,
}: {
  title: string;
  description: string;
  showReferenceLibrary?: boolean;
  media: 'video' | 'image';
  required?: boolean;
  onFile: (file: File | null) => void;onLibrary?:()=>void;disabled?:boolean;preview?:string;
}) {
  return (
    <label className="group relative flex h-40 shrink-0 cursor-pointer flex-col gap-2 rounded-2xl border border-dashed border-white/10 bg-[#262a2b] p-2 transition hover:border-[#0bc1b8] hover:bg-white/[0.03]">
      <input
        disabled={disabled}
        aria-label={title}
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
                <span className="cursor-pointer text-[#20d0c4] underline">アップロード</span>
                {' または '}
                <button type="button" disabled={disabled} className="text-[#20d0c4] underline disabled:opacity-50"
                  onClick={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) onLibrary?.(); }}>参考画像ライブラリ</button>
                {' 選択'}
              </>
            ) : description}
          </p>
          {required && <span className="mt-2 rounded-lg bg-[#0bc1b8] px-2 py-1 text-[12px] font-medium leading-[17.1429px] text-[#111817]">必須項目</span>}
        </div>
        <div className="relative h-full w-[106.5px] shrink-0 overflow-hidden rounded-lg bg-[#1b2021]">
          {preview ? <img className="size-full object-contain" src={preview} alt={title} /> : media === 'video' ? (
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

function ModelSettingSelect({ label, value, options, open, disabled, onToggle, onClose, onChange }: {
  label: string; value: string; options: readonly string[]; open: boolean; disabled: boolean;
  onToggle: () => void; onClose: () => void; onChange: (value: string) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  return <div className="relative flex flex-col gap-1" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); onClose(); trigger.current?.focus(); }
  }}>
    <span className="text-sm text-[#e3e8e8]">{label}</span>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-expanded={open}
      aria-controls={`model-setting-${label}`} disabled={disabled} onClick={onToggle}
      className="flex h-10 min-w-24 items-center justify-between gap-2 rounded-md border border-white/10 bg-[#262a2b] px-2 text-sm disabled:opacity-50">
      {value || '設定未取得'}<ChevronDown className="h-4 w-4" aria-hidden="true" />
    </button>
    {open && !disabled && <div role="listbox" id={`model-setting-${label}`} aria-label={label}
      className="absolute bottom-full z-30 mb-2 max-h-64 min-w-full overflow-y-auto rounded-md border border-white/10 bg-[#262a2b] p-1 shadow-xl">
      {options.map(option => <button key={option} type="button" role="option" aria-selected={value === option}
        onClick={() => { if (!disabled) { onChange(option); onClose(); trigger.current?.focus(); } }}
        className="block w-full whitespace-nowrap rounded px-3 py-2 text-left text-sm hover:bg-white/10">{option}</button>)}
    </div>}
  </div>;
}

export function SourceModelToolSurface() {
  const location = useLocation();
  const navigate = useNavigate();
  const toolKey = location.pathname.split('/').filter(Boolean).at(-1) ?? 'head-form';
  const config = sourceModelToolConfig[toolKey] ?? sourceModelToolConfig['head-form'];
  const featureIds:Record<string,CanonicalWorkspaceFeature>={'head-form':'model-face','model-change-form':'model-change','body-form':'body-shape','size-form':'clothing-size','pose-form':'pose-change','background-form':'background-change','perspective-form':'angle-change'};
  const feature = (featureIds[toolKey] ?? 'model-face') as ModelToolFeature;
  const workspace=useCanonicalImageWorkspace(feature,{requiredSources:1,title:config.title,promptContext:config.rightDescription,initialInputState:defaultModelToolSettings(feature)});
  const locked=workspace.status==='running'||workspace.status==='loading'||Boolean(workspace.pendingId);
  const settings = readModelToolSettings(feature, workspace.inputState);
  const legacySettings = readLegacyModelToolSettings(feature, workspace.inputState);
  const displayedSettings = settings ?? legacySettings;
  const chooseMode = (mode: 'reference' | 'custom') => { if (!locked && displayedSettings) workspace.setInputState({ ...displayedSettings, inputMode: mode, customDescription: typeof displayedSettings.customDescription === 'string' ? displayedSettings.customDescription : '' }); };
  const [openSetting, setOpenSetting] = useState<string | null>(null);
  const [referenceLibraryOpen, setReferenceLibraryOpen] = useState(false);
  const [bodyDrafts, setBodyDrafts] = useState<Partial<Record<ModelBodyMeasurement, string>>>({});
  useEffect(() => { setOpenSetting(null); }, [feature, locked]);
  useEffect(() => { setBodyDrafts({}); setOpenSetting(null); }, [feature, displayedSettings?.gender, settings?.customBody, locked]);
  const bodyProfile = feature === 'body-shape' ? MODEL_BODY_PROFILES[String(displayedSettings?.gender)] : undefined;
  const updateSetting = (key: string, value: string | boolean) => { if (!locked && settings) workspace.setInputState(feature === 'body-shape' && key === 'gender' && typeof value === 'string' ? changeModelBodyGender(settings, value) : { ...settings, [key]: value }); };
  const chooseBody = (enabled: boolean) => { if (!locked && displayedSettings) workspace.setInputState(chooseModelCustomBody(displayedSettings, enabled)); };
  const editMeasurement = (key: ModelBodyMeasurement, value: string) => {
    if (locked || !settings || !bodyProfile) return;
    setBodyDrafts(current => ({ ...current, [key]: value }));
    if (validModelBodyMeasurement(value, bodyProfile[key])) updateSetting(key, String(Number(value)));
  };
  const commitMeasurement = (key: ModelBodyMeasurement) => {
    if (locked || !settings || !bodyProfile) return;
    const draft = bodyDrafts[key];
    if (draft !== undefined && draft.trim() !== '' && Number.isFinite(Number(draft))) updateSetting(key, String(Math.min(bodyProfile[key][1], Math.max(bodyProfile[key][0], Number(draft)))));
    setBodyDrafts(current => { const next = { ...current }; delete next[key]; return next; });
  };
  const invalidBodyDraft = Boolean(bodyProfile && MODEL_BODY_MEASUREMENTS.some(({ key }) => bodyDrafts[key] !== undefined && !validModelBodyMeasurement(bodyDrafts[key], bodyProfile[key])));
  const selectDisabled = (key: string) => locked || !settings || (feature === 'body-shape' && key === 'bodyShape' && settings.customBody === true);
  const select = (key: string, label: string, options: readonly string[]) => <ModelSettingSelect key={key} label={label} value={typeof displayedSettings?.[key] === 'string' ? displayedSettings[key] as string : ''} options={options}
    disabled={selectDisabled(key)} open={openSetting === key} onToggle={() => { if (!selectDisabled(key)) setOpenSetting(current => current === key ? null : key); }}
    onClose={() => setOpenSetting(current => current === key ? null : current)} onChange={value => updateSetting(key, value)} />;
  const referenceVisible = !['body-shape', 'clothing-size', 'angle-change'].includes(feature) && (!isModelDescriptionFeature(feature) || settings?.inputMode === 'reference');
  useEffect(() => { setReferenceLibraryOpen(false); }, [workspace.sourceSelectionScope, locked, referenceVisible]);
  const sourceFileName=workspace.slots.primary?.name??'',referenceFileName=workspace.slots.secondary?.name??'';
  const activeIndex = Math.max(0, sourceModelTools.findIndex((tool) => tool.href.endsWith(toolKey)));
  const generate=()=>workspace.generate({brief:workspace.brief||[config.title,config.rightDescription,config.note].join('\n')});

  return (
    <div
      className="flex h-[calc(100vh-50px)] min-h-[640px] w-full overflow-hidden bg-[#171b1c] text-white"
      style={{ fontFamily: '-apple-system, "system-ui", "Segoe UI", "PingFang SC", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif' }}
      data-testid="lightchain-source-model-tool-surface"
      data-source-tool={toolKey} data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId??''} data-resume-state={workspace.status} data-primary-source={workspace.slots.primary?.sourceImageId??workspace.slots.primary?.localAssetRef??''} data-secondary-source={workspace.slots.secondary?.sourceImageId??workspace.slots.secondary?.localAssetRef??''}
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
              <span className={index === 0 ? 'w-[61px]' : 'whitespace-nowrap'}>{label}</span>
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
              disabled={locked} preview={workspace.slots.primary?.imageUrl} onFile={file=>{if(file)void workspace.upload('primary',file);}}
            />
            <div className="h-px shrink-0 bg-white/10" />
            {isModelDescriptionFeature(feature) && <div className="flex flex-col gap-3">
              <div className="flex gap-2" aria-label="入力モード">
                {(['reference', 'custom'] as const).map(mode => <button key={mode} type="button" disabled={locked || !displayedSettings}
                  aria-pressed={settings?.inputMode === mode} onClick={() => chooseMode(mode)}
                  className="rounded-md border border-white/10 px-3 py-2 text-sm disabled:opacity-50">{mode === 'reference' ? '参考画像' : 'カスタム'}</button>)}
              </div>
              {!settings && legacySettings && <p role="status" className="text-sm text-[#aab8b6]">保存時のモードと説明を取得できません。使用するモードを選択してください。</p>}
              {settings?.inputMode === 'custom' && <div className="flex flex-col gap-1">
                <textarea aria-label="カスタム説明" placeholder="背景の説明をここに記入してください" maxLength={800} disabled={locked}
                  value={String(settings.customDescription)} onChange={event => updateSetting('customDescription', event.target.value.slice(0, 800))}
                  className="min-h-40 rounded-md border border-white/10 bg-[#262a2b] p-3 text-sm disabled:opacity-50" />
                <span aria-label="説明文字数" className="text-right text-xs text-[#aab8b6]">{String(settings.customDescription).length}/800</span>
              </div>}
            </div>}
            {referenceVisible && <div className="-mt-2 flex flex-col gap-4">
              <p className="text-sm font-medium leading-6 text-[#e3e8e8]">画像をアップロード</p>
              <SourceUploadCard
                title={config.referenceTitle}
                description={config.referenceDescription}
                showReferenceLibrary={config.showReferenceLibrary}
                onLibrary={() => { if (!locked && referenceVisible) setReferenceLibraryOpen(true); }}
                media="image"
                disabled={locked} preview={workspace.slots.secondary?.imageUrl} onFile={file=>{if(file)void workspace.upload('secondary',file);}}
              />
              {workspace.slots.secondary && <button type="button" disabled={locked} onClick={() => workspace.clearSource('secondary')}
                className="self-start text-xs text-[#aab8b6] underline disabled:opacity-50">参考画像を削除</button>}
            </div>}
            {feature === 'model-change' && <button type="button" role="switch" aria-label="アパレルサイズをキープ" aria-checked={settings ? settings.keepApparelSize === true : undefined}
              disabled={locked || !settings} onClick={() => updateSetting('keepApparelSize', !settings?.keepApparelSize)}
              className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2 text-sm disabled:opacity-50">アパレルサイズをキープ<span>{settings ? (settings.keepApparelSize ? 'オン' : 'オフ') : '設定未取得'}</span></button>}
            {(MODEL_TOOL_FIELDS[feature] ?? []).map(field => select(field.key, field.label, field.options))}
            {feature === 'body-shape' && <div className="flex flex-col gap-4">
              {settings ? <button type="button" role="switch" aria-label="カスタムボディ" aria-checked={settings.customBody === true}
                disabled={locked} onClick={() => chooseBody(settings.customBody !== true)}
                className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2 text-sm disabled:opacity-50">カスタムボディ<span>{settings.customBody ? 'オン' : 'オフ'}</span></button> : <>
                <p role="status" className="text-sm text-[#aab8b6]">保存時のカスタムボディ設定を取得できません。使用するモードを選択してください。</p>
                <div className="flex gap-2">{[false, true].map(enabled => <button key={String(enabled)} type="button" disabled={locked || !legacySettings}
                  onClick={() => chooseBody(enabled)} className="rounded-md border border-white/10 px-3 py-2 text-sm disabled:opacity-50">{enabled ? 'カスタムボディ' : '体型プリセット'}</button>)}</div>
              </>}
              {settings?.customBody === true && bodyProfile && <>
                {select('height', '身長', bodyProfile.heights)}
                {MODEL_BODY_MEASUREMENTS.map(({ key, label }) => <div key={key} className="flex flex-col gap-2">
                  <label className="flex items-center justify-between gap-2 text-sm">
                    <span>{label}</span><span className="flex items-center gap-2"><input type="number" aria-label={label} min={bodyProfile[key][0]} max={bodyProfile[key][1]} disabled={locked}
                      value={bodyDrafts[key] ?? String(settings[key])} aria-invalid={bodyDrafts[key] !== undefined && !validModelBodyMeasurement(bodyDrafts[key], bodyProfile[key])}
                      onChange={event => editMeasurement(key, event.target.value)} onBlur={() => commitMeasurement(key)}
                      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitMeasurement(key); } }}
                      className="h-8 w-20 rounded-md border border-white/10 bg-[#262a2b] px-2 disabled:opacity-50" />cm</span>
                  </label>
                  <div className="flex items-center gap-2 text-xs text-[#aab8b6]"><span>{bodyProfile[key][0]}</span><input type="range" aria-label={`${label}スライダー`}
                    min={bodyProfile[key][0]} max={bodyProfile[key][1]} value={String(settings[key])} disabled={locked}
                    onChange={event => { if (!locked) { updateSetting(key, event.target.value); setBodyDrafts(current => { const next = { ...current }; delete next[key]; return next; }); } }}
                    className="min-w-0 flex-1 accent-[#0bc1b8]" /><span>{bodyProfile[key][1]}</span></div>
                </div>)}
              </>}
            </div>}
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
          {select('aspectRatio', '画像比率', MODEL_ASPECT_OPTIONS)}
          {select('resolution', '解像度', MODEL_RESOLUTION_OPTIONS)}
          <button type="button" data-testid="heavy-model-tool-generate" disabled={locked||!workspace.slots.primary||!settings||invalidBodyDraft} onClick={()=>void generate()} className="flex h-10 flex-1 items-center justify-center rounded-lg bg-[#65d3cf] text-sm font-semibold text-neutral-950 disabled:opacity-50">AI生成</button>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 bg-[#171b1c]">
        <CanonicalImageWorkspaceControls workspace={workspace} />
        {workspace.candidates.length>1&&<div className="absolute bottom-4 left-4 flex gap-2" aria-label="モデル候補">{workspace.candidates.map((candidate,index)=><button type="button" disabled={locked} aria-pressed={workspace.selectedCandidateId===candidate.imageId} key={candidate.imageId} onClick={()=>void workspace.selectCandidate(candidate.imageId)}>候補 {index+1} ({candidate.bodyType}/{candidate.ageGroup})</button>)}</div>}
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
      <GallerySelector isOpen={referenceLibraryOpen && referenceVisible && !locked} title="素材を選択" onClose={() => setReferenceLibraryOpen(false)}
        onSelect={(imageUrl, imageId, storagePath, imageElement) => { setReferenceLibraryOpen(false); if (!locked && referenceVisible) void workspace.selectModelReference({ imageUrl, imageId, storagePath, name: imageElement?.alt?.trim() || '参考画像' }); }} />
    </div>
  );
}
