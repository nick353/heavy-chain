import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Boxes,
  ChevronDown,
  Image as ImageIcon,
  RefreshCw,
  Shirt,
  Sparkles,
  UserRound,
} from 'lucide-react';
import {useCanonicalImageWorkspace} from '../../hooks/useCanonicalImageWorkspace';
import {CanonicalImageWorkspaceControls} from '../CanonicalImageWorkspaceControls';
import {useAuthStore} from '../../stores/authStore';
import {listWorkspaceArtifacts} from '../../lib/localWorkspaceArtifacts';
import {readLightchainResumeResult} from '../../lib/lightchainResume';
import {cloudflareDataPlane} from '../../lib/cloudflareApi';
import {captureAuthBrandFence,assertAuthBrandFence} from '../../lib/authBrandSelection';
import { GallerySelector } from '../GallerySelector';
import { MODEL_BODY_MEASUREMENTS, MODEL_BODY_PROFILES, validModelBodyMeasurement, type ModelBodyMeasurement } from '../../lib/modelToolSettings';
import { MODEL_LIBRARY_LABEL_OPTIONS, MODEL_LIBRARY_SIMILARITIES, defaultModelLibrarySettings, readModelLibrarySettings, chooseModelLibraryMode, changeModelLibraryGender, changeModelLibraryHeight, modelLibraryBodyProfile, modelLibraryBodyPreview, type ModelLibraryMode } from '../../lib/modelLibrarySettings';

type SourceModelField = 'age' | 'nationality' | 'skinColor' | 'bodyType';

const sourceModelTools = [
  { label: 'モデルカスタマイズ', href: '/model-library/model-custom-form', icon: UserRound },
  { label: '顔変更', href: '/model-library/head-form', icon: Sparkles },
  { label: 'モデル変更', href: '/model-library/model-change-form', icon: UserRound },
  { label: '体型', href: '/model-library/body-form', icon: Shirt },
  { label: '服のサイズ', href: '/model-library/size-form', icon: Shirt },
  { label: 'ポーズ', href: '/model-library/pose-form', icon: Sparkles },
  { label: '背景', href: '/model-library/background-form', icon: ImageIcon },
  { label: 'アングル', href: '/model-library/perspective-form', icon: Boxes },
] as const;

const sourceModelFieldLabels: Record<SourceModelField, string> = {
  age: '年齢',
  nationality: '国籍',
  skinColor: '肌の色',
  bodyType: '体型',
};

const sourceModelFieldOptions = MODEL_LIBRARY_LABEL_OPTIONS;

type SourceModelComboboxProps = {
  field: SourceModelField | 'height';
  label: string;
  value: string;
  options?: readonly string[];
  disabled?: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (value: string) => void;
};

function SourceModelCombobox({ field, label, value, options, disabled, open, onToggle, onClose, onChange }: SourceModelComboboxProps) {
  const optionsId = `lightchain-source-model-${field}-options`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative" onKeyDown={(event) => {
      if (!open || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    }}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={optionsId}
        onClick={onToggle}
        className="flex h-8 w-[280px] shrink-0 items-center justify-between rounded-lg border border-white/10 bg-[#262a2b] px-3 py-2 text-left text-sm font-normal leading-[21px] text-neutral-200 outline-none transition hover:bg-[#303637]"
      >
        <span>{value}</span>
        <ChevronDown className="h-4 w-4 text-neutral-400" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={optionsId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 top-9 z-20 max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-[#262a2b] p-1 shadow-xl"
        >
          {(options ?? (field === 'height' ? [] : sourceModelFieldOptions[field])).map((option) => (
            <div
              key={option}
              role="option"
              aria-selected={value === option}
              onClick={() => onChange(option)}
              className="cursor-pointer rounded-md px-3 py-1.5 text-sm text-neutral-200 hover:bg-white/[0.08]"
            >
              {option}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Lightchain model-customization surface is intentionally kept small:
 * the source shows the model rail, condition controls, and a locked action.
 * Heavy-only workflow cards belong to the later handoff surfaces, not here.
 */
export function SourceModelLibrarySurface() {
  const navigate = useNavigate();
  const location=useLocation(),{user,currentBrand,brandState}=useAuthStore();
  const params=new URLSearchParams(location.search),jobId=params.get('resumeJob'),origin=params.get('workspaceFeature');
  const explicit=origin==='model-custom'||origin==='model-library'?origin:null;
  const localFeatures=(['model-library','model-custom'] as const).filter(toolId=>readLightchainResumeResult(listWorkspaceArtifacts(currentBrand?.id??'',user?.id),jobId,{brandId:currentBrand?.id??'',scopeId:user?.id??'',toolId}));
  const [remoteIdentity,setRemoteIdentity]=useState<{scope:string;feature:'model-library'|'model-custom'|null}|null>(null);
  const identityScope=JSON.stringify([user?.id,currentBrand?.id,jobId,location.pathname,location.search,brandState.requestGeneration]);
  useEffect(()=>{if(!jobId||localFeatures.length)return;let cancelled=false;const fence=captureAuthBrandFence(brandState,user?.id??null,currentBrand?.id??null);if(!fence||!cloudflareDataPlane)return;
    void cloudflareDataPlane.listGeneratedImages(fence.brandId,{jobId,limit:20}).then(images=>{if(cancelled)return;const current=useAuthStore.getState();assertAuthBrandFence(fence,captureAuthBrandFence(current.brandState,current.user?.id??null,current.currentBrand?.id??null),'model_library_identity');
      const features=images.filter(image=>image.brand_id===fence.brandId&&image.user_id===fence.userId&&image.job_id===jobId).map(image=>{
       const metadata=image.metadata&&typeof image.metadata==='object'&&!Array.isArray(image.metadata)?image.metadata:{};
       const value=typeof metadata.toolId==='string'?metadata.toolId:(image.feature_type??'').replace(/^lightchain-/,'').replace(/-provider-result$/,'');return value==='model-library'||value==='model-custom'?value:null;
      }).filter((value):value is 'model-library'|'model-custom'=>Boolean(value));
      setRemoteIdentity({scope:identityScope,feature:new Set(features).size===1?features[0]:null});
    }).catch(()=>{if(!cancelled)setRemoteIdentity({scope:identityScope,feature:null});});return()=>{cancelled=true;};
  },[identityScope,brandState.status]);
  const savedIdentity=localFeatures.length===1?localFeatures[0]:remoteIdentity?.scope===identityScope?remoteIdentity.feature:null;
  const toolId=jobId?(savedIdentity??explicit??'model-library'):(explicit??'model-library');
  const conflict=Boolean(jobId&&(!savedIdentity||(explicit&&explicit!==savedIdentity)));
  const workspace=useCanonicalImageWorkspace(toolId,{modelLibraryCreation:true,identityConflict:conflict,requiredSources:0,title:'モデルカスタマイズ',initialInputState:defaultModelLibrarySettings()});
  const locked=workspace.status==='running'||workspace.status==='loading'||Boolean(workspace.pendingId)||conflict;
  const settings=readModelLibrarySettings(workspace.inputState);
  const activeTab=settings?.inputMode==='label'?'ラベル':settings?.inputMode==='custom'?'カスタム':null;
  const [openField,setOpenField]=useState<SourceModelField|'height'|null>(null);
  const [referenceLibraryOpen,setReferenceLibraryOpen]=useState(false);
  const [bodyDrafts,setBodyDrafts]=useState<Partial<Record<ModelBodyMeasurement,string>>>({});
  const bodyProfile=modelLibraryBodyProfile(String(settings?.customGender),String(settings?.height));
  const bodyPreview=modelLibraryBodyPreview(settings);
  const chooseMode=(mode:ModelLibraryMode)=>{if(!locked)workspace.setInputState(chooseModelLibraryMode(settings??defaultModelLibrarySettings(),mode));};
  const update=(key:string,value:string|boolean)=>{if(!locked&&settings)workspace.setInputState({...settings,[key]:value});};
  useEffect(()=>{setOpenField(null);setReferenceLibraryOpen(false);setBodyDrafts({});},[workspace.sourceSelectionScope,locked,activeTab,settings?.customGender,settings?.height]);
  const gender=typeof workspace.inputState.gender==='string'?workspace.inputState.gender:'未設定',half=workspace.inputState.half===true;
  const fieldValues=Object.fromEntries((['age','nationality','skinColor','bodyType'] as SourceModelField[]).map(field=>[field,typeof workspace.inputState[field]==='string'?workspace.inputState[field]:'未設定'])) as Record<SourceModelField,string>;
  const setGender=(value:string)=>workspace.setInputState({...workspace.inputState,gender:value});
  const setHalf=()=>workspace.setInputState({...workspace.inputState,half:!half});
  const setField=(field:SourceModelField,value:string)=>workspace.setInputState({...workspace.inputState,[field]:value});
  const invalidBodyDraft=Boolean(bodyProfile&&MODEL_BODY_MEASUREMENTS.some(({key})=>bodyDrafts[key]!==undefined&&!validModelBodyMeasurement(bodyDrafts[key],bodyProfile[key])));
  const editMeasurement=(key:ModelBodyMeasurement,value:string)=>{if(locked||!settings||!bodyProfile)return;setBodyDrafts(current=>({...current,[key]:value}));if(validModelBodyMeasurement(value,bodyProfile[key]))update(key,String(Number(value)));};
  const commitMeasurement=(key:ModelBodyMeasurement)=>{const value=bodyDrafts[key];if(!locked&&settings&&bodyProfile&&value!==undefined&&value.trim()!==''&&Number.isFinite(Number(value)))update(key,String(Math.min(bodyProfile[key][1],Math.max(bodyProfile[key][0],Number(value)))));setBodyDrafts(current=>{const next={...current};delete next[key];return next;});};
  const generate=()=>workspace.generate({brief:workspace.brief||'指定条件の専用バーチャルモデルを生成してください。'});

  return (
    <div
      className="flex h-[calc(100vh-50px)] min-h-[640px] w-full overflow-hidden bg-[#171b1c] text-white"
      style={{ fontFamily: '-apple-system, "system-ui", "Segoe UI", "PingFang SC", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif' }}
      data-testid="lightchain-source-model-surface"
      data-lightchain-source-surface="model-customization" data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId??''} data-resume-state={workspace.status} data-resume-inputs={String(workspace.originalInputsAvailable)} data-selected-candidate={workspace.selectedCandidateId??''} data-model-input-mode={settings?.inputMode??'unavailable'} data-secondary-source={workspace.slots.secondary?.sourceImageId??workspace.slots.secondary?.localAssetRef??''}
      data-resume-input-source={workspace.libraryInputReadback?.source??''} data-resume-input-lookup={workspace.libraryInputReadback?.remoteLookup??''} data-resume-modern-settings={workspace.libraryInputReadback?.modernSettings??''} data-resume-legacy-settings={workspace.libraryInputReadback?.legacySettings??''}
      data-resume-request-lookup={workspace.libraryInputReadback?.requestLookup??''} data-resume-request-modern-settings={workspace.libraryInputReadback?.requestModernSettings??''} data-resume-request-legacy-settings={workspace.libraryInputReadback?.requestLegacySettings??''}
    >
      <nav
        aria-label="モデルツール"
        data-testid="lightchain-source-model-rail"
        className="w-20 shrink-0 border-r border-white/10 bg-[#171b1c] px-2 py-2"
      >
        <div className="flex flex-col gap-2">
          {sourceModelTools.map(({ label, href, icon: Icon }, index) => (
            <Link
              key={label}
              to={href}
              aria-current={index === 0 ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-y-1 rounded-lg border px-1 py-2 text-center text-[12px] font-normal leading-[17.1429px] transition ${
                index === 0
                  ? 'border-[#65d3cf] bg-[#273233] text-[#65d3cf]'
                  : 'border-transparent text-neutral-300 hover:border-white/15 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              <Icon className="h-6 w-6" strokeWidth={1.7} aria-hidden="true" />
              <span className={index === 0 ? 'w-[61px]' : 'whitespace-nowrap'}>{label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <aside
        data-testid="lightchain-source-model-controls"
        className="relative flex w-[432px] shrink-0 flex-col border-r border-white/10 bg-[#171b1c]"
      >
        <div className="flex-1 overflow-y-auto px-4 pb-5 pt-4">
          <h1 className="text-base font-medium leading-6 text-white">モデルカスタマイズ</h1>

          <div className="mt-4 grid grid-cols-2 gap-1 overflow-hidden rounded-xl border border-white/10 bg-[#262a2b] p-1">
            {(['ラベル', 'カスタム'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                disabled={locked} aria-pressed={activeTab===tab} onClick={() => chooseMode(tab==='ラベル'?'label':'custom')}
                className={`rounded-lg px-4 py-1 text-sm font-normal leading-[21px] transition ${
                  activeTab === tab ? 'border border-[#65d3cf] bg-white/[0.15] text-white' : 'border border-transparent text-neutral-300 hover:bg-white/[0.06]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab==='ラベル'&&<div className="mt-4 space-y-4">
            <label id="gender" className="flex items-center justify-between">
              <span className="text-sm font-medium leading-5 text-[#e3e8e8]">性別</span>
              <div className="relative flex w-[280px] shrink-0 gap-1 rounded-lg border border-white/10 p-1 leading-4" data-testid="lightchain-source-model-gender">
                {(['男性', '女性'] as const).map((option) => (
                  <button type="button" disabled={locked} aria-pressed={gender===option}
                    key={option}
                    onClick={() => {if(!locked)setGender(option);}}
                    className={`relative z-10 flex h-6 flex-1 items-center justify-center rounded px-2 py-1 text-[12px] leading-[17.1429px] transition ${gender === option ? 'bg-[#0bc1b8] text-[#102021]' : 'text-neutral-300 hover:bg-white/[0.06]'}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </label>

            {(['age', 'nationality'] as SourceModelField[]).map((field) => (
              <label key={field} id={field} className="flex items-center justify-between">
                <span className="text-sm font-medium leading-5 text-[#e3e8e8]">{sourceModelFieldLabels[field]}</span>
                <SourceModelCombobox
                  field={field}
                  disabled={locked}
                  label={sourceModelFieldLabels[field]}
                  value={fieldValues[field]}
                  open={openField === field}
                  onToggle={() => {if(!locked)setOpenField((current) => current === field ? null : field);}}
                  onClose={() => setOpenField((current) => current === field ? null : current)}
                  onChange={(value) => {
                    if(!locked)setField(field,value);
                    setOpenField(null);
                  }}
                />
              </label>
            ))}

            <label id="mixed" className="flex h-10 items-center justify-between">
              <span className="text-sm font-medium leading-5 text-[#e3e8e8]">ハーフ</span>
              <button
                type="button"
                role="switch"
                aria-checked={half}
                aria-label="ハーフ"
                disabled={locked} onClick={() => setHalf()}
                className={`flex h-4 w-8 items-center rounded-full p-0.5 transition ${half ? 'bg-[#65d3cf]' : 'bg-[#434a4c]'}`}
              >
                <span className={`h-4 w-4 rounded-full bg-white transition ${half ? 'translate-x-3' : ''}`} />
              </button>
            </label>

            {(['skinColor', 'bodyType'] as SourceModelField[]).map((field) => (
              <label key={field} id={field === 'skinColor' ? 'skin-color' : 'body-type'} className="flex items-center justify-between">
                <span className="text-sm font-medium leading-5 text-[#e3e8e8]">{sourceModelFieldLabels[field]}</span>
                <SourceModelCombobox
                  field={field}
                  disabled={locked}
                  label={sourceModelFieldLabels[field]}
                  value={fieldValues[field]}
                  open={openField === field}
                  onToggle={() => {if(!locked)setOpenField((current) => current === field ? null : field);}}
                  onClose={() => setOpenField((current) => current === field ? null : current)}
                  onChange={(value) => {
                    if(!locked)setField(field,value);
                    setOpenField(null);
                  }}
                />
              </label>
            ))}
          </div>}
          {activeTab==='カスタム'&&settings&&<div className="mt-4 space-y-4" data-testid="model-custom-conditions">
            <div className="flex gap-4 rounded-xl border border-dashed border-white/20 bg-[#262a2b] p-4">
              <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 text-sm">
                <span>顔の参考図</span>
                <label className="cursor-pointer text-[#65d3cf] underline">アップロード<input aria-label="顔の参考図" className="sr-only" disabled={locked} type="file" accept="image/png,image/jpeg,image/avif,image/webp" onChange={event=>{const file=event.target.files?.[0];if(file)void workspace.upload('secondary',file);}} /></label>
                <span>または</span><button type="button" disabled={locked} className="text-[#65d3cf] underline" onClick={()=>setReferenceLibraryOpen(true)}>参考画像ライブラリ</button>
                <span>選択</span><span className="rounded bg-[#65d3cf] px-2 py-1 text-neutral-950">必須項目</span>
                {workspace.slots.secondary&&<button type="button" disabled={locked} onClick={()=>workspace.clearSource('secondary')}>参考図をクリア</button>}
              </div>
              <img className="h-32 w-28 rounded-lg object-contain" src={workspace.slots.secondary?.imageUrl??'/lightchain-assets/upload-example-head.png'} alt={workspace.slots.secondary?'顔の参考図のプレビュー':'例'} />
            </div>
            {workspace.slots.secondary&&<div className="flex items-center justify-between"><span className="text-sm">参考程度</span><div className="flex w-[280px] gap-1 rounded-lg border border-white/10 p-1" aria-label="顔の参考程度">
              {MODEL_LIBRARY_SIMILARITIES.map(option=><button type="button" key={option} disabled={locked} aria-pressed={settings.customSimilarity===option} onClick={()=>update('customSimilarity',option)} className={`flex-1 rounded px-2 py-1 text-xs ${settings.customSimilarity===option?'bg-[#0bc1b8] text-neutral-950':'text-neutral-300'}`}>{option}</button>)}
            </div></div>}
            <div className="flex items-center justify-between"><span className="text-sm">性別</span><div className="flex w-[280px] gap-1 rounded-lg border border-white/10 p-1">
              {Object.keys(MODEL_BODY_PROFILES).map(option=><button type="button" disabled={locked} aria-pressed={settings.customGender===option} key={option} onClick={()=>{if(!locked)workspace.setInputState(changeModelLibraryGender(settings,option));}} className={`flex-1 rounded px-1 py-1 text-xs ${settings.customGender===option?'bg-[#0bc1b8] text-neutral-950':'text-neutral-300'}`}>{option}</button>)}
            </div></div>
            <label className="flex items-center justify-between"><span className="text-sm">身長</span><SourceModelCombobox field="height" label="身長" value={String(settings.height)} options={bodyProfile?.heights??[]} disabled={locked} open={openField==='height'} onToggle={()=>{if(!locked)setOpenField(current=>current==='height'?null:'height');}} onClose={()=>setOpenField(null)} onChange={value=>{if(!locked)workspace.setInputState(changeModelLibraryHeight(settings,value));setOpenField(null);}} /></label>
            <div className="grid grid-cols-[1fr_112px] gap-3">
              <div className="space-y-3">{MODEL_BODY_MEASUREMENTS.map(({key,label})=><div key={key} className="space-y-2">
                <label className="flex items-center justify-between gap-2 text-sm"><span>{label}</span><span className="flex items-center gap-1"><input type="number" aria-label={label} disabled={locked} min={bodyProfile?.[key][0]} max={bodyProfile?.[key][1]} step="1" value={bodyDrafts[key]??String(settings[key])} onChange={event=>editMeasurement(key,event.target.value)} onBlur={()=>commitMeasurement(key)} className="h-7 w-16 rounded border border-white/15 bg-[#262a2b] px-2" />cm</span></label>
                <div className="flex items-center gap-2 text-xs text-neutral-400"><span>{bodyProfile?.[key][0]}</span><input className="min-w-0 flex-1 accent-[#65d3cf]" type="range" aria-label={`${label} スライダー`} disabled={locked} min={bodyProfile?.[key][0]} max={bodyProfile?.[key][1]} step="1" value={String(settings[key])} onChange={event=>{update(key,event.target.value);setBodyDrafts(current=>{const next={...current};delete next[key];return next;});}} /><span>{bodyProfile?.[key][1]}</span></div>
              </div>)}</div>
              <div className="flex items-center justify-center" data-testid="model-custom-body-preview">
                {bodyPreview&&<img src={`${bodyPreview}?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp`} alt="プレビュー画像" title={`${String(settings.customGender)} 身長${String(settings.height)} 胸囲${String(settings.chest)} 腹囲${String(settings.waist)} ヒップ${String(settings.hip)}`} className="max-h-52 w-20 rounded-lg object-contain" />}
              </div>
            </div>
            <label className="block text-sm">プロンプト<textarea aria-label="モデルカスタムのプロンプト" disabled={locked} maxLength={800} value={String(settings.customPrompt)} placeholder="背景の説明をここに記入してください" onChange={event=>update('customPrompt',event.target.value.slice(0,800))} className="mt-2 h-28 w-full resize-none rounded-lg border border-white/10 bg-[#262a2b] p-3" /><span className="text-xs text-neutral-400">{String(settings.customPrompt).length}/800</span></label>
          </div>}
          {!activeTab&&!locked&&<p className="mt-4 text-sm text-neutral-300">保存された入力モードを確認できません。新しい入力で開始する場合はモードを選択してください。</p>}
        </div>

        <div className="shrink-0 border-t border-white/10 bg-[#171b1c] px-2 py-4">
          <button type="button" data-testid="heavy-model-generate" disabled={locked||!settings||invalidBodyDraft||(settings.inputMode==='custom'&&!workspace.slots.secondary)} onClick={()=>void generate()} className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#65d3cf] text-sm text-neutral-950 disabled:opacity-50">AI生成</button>
          {workspace.error&&<p role="alert">{workspace.error}</p>}
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 bg-[#171b1c]">
        <CanonicalImageWorkspaceControls workspace={workspace} />
        {workspace.candidates.length>1&&<div className="absolute bottom-4 left-4 flex gap-2" aria-label="モデル候補">{workspace.candidates.map((candidate,index)=><button type="button" disabled={locked} aria-pressed={workspace.selectedCandidateId===candidate.imageId} key={candidate.imageId} onClick={()=>void workspace.selectCandidate(candidate.imageId)}>候補 {index+1} ({candidate.bodyType}/{candidate.ageGroup})</button>)}</div>}
        <button
          type="button"
          data-testid="lightchain-source-model-history"
          onClick={() => navigate('/history')}
          className="absolute right-4 top-4 z-10 inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-[#171b1c] px-3 py-2 text-[12px] font-medium leading-[17.1429px] text-white transition hover:border-white/25 hover:bg-white/[0.04]"
        >
          <RefreshCw className="h-5 w-5" aria-hidden="true" />
          生成履歴
        </button>
        {workspace.result ? <div className="flex h-full items-center justify-center pb-16 pl-6 pr-[312px] pt-16" data-testid="model-result-preview">
          <img src={workspace.result.imageUrl} alt="保存モデルのプレビュー" className="h-full w-full object-contain" />
        </div> : <div className="flex h-full flex-col items-center justify-center px-10 text-center">
          <h2 className="font-[AlimamaFangYuanTiVF] text-lg font-bold leading-[25.2px] text-white">モデルカスタマイズ</h2>
          <p className="mt-2 text-sm leading-[21px] text-[#aab8b6]">ワンクリックで専用のバーチャルモデルイメージを生成</p>
        </div>}
      </main>
      <GallerySelector isOpen={referenceLibraryOpen&&activeTab==='カスタム'&&!locked} title="顔の参考図を選択" onClose={()=>setReferenceLibraryOpen(false)} onSelect={(imageUrl,imageId,storagePath,imageElement)=>{setReferenceLibraryOpen(false);if(!locked&&activeTab==='カスタム')void workspace.selectModelReference({imageUrl,imageId,storagePath,name:imageElement?.alt?.trim()||'顔の参考図'});}} />
    </div>
  );
}
