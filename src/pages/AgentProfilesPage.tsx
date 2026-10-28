import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, FileText, Loader2, Pencil, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { AgentSidebar } from '../features/agent/AgentSidebar';
import {
  AGENT_PROFILE_AGES, AGENT_PROFILE_CATEGORIES, AGENT_PROFILE_COUNTRIES, AGENT_PROFILE_CURRENCIES, deleteAgentProfile,
  readActiveAgentProfileId, readAgentProfiles, saveAgentProfile, selectAgentProfile, type AgentPreferenceProfile,
} from '../features/agent/agentTasks';
import { extractProfileFromMaterials, isProfileMaterial, PROFILE_MATERIAL_ACCEPT, PROFILE_MATERIAL_LIMIT, type ExtractedProfile } from '../lib/profileMaterials';

const EMPTY: Omit<AgentPreferenceProfile, 'id' | 'updatedAt'> = { name: '', categories: [], priceMin: '', priceMax: '', currency: '', countries: [], ages: [], channels: [], brands: [], visual: '', materials: [], materialsSummary: '' };
const EMPTY_ICON = '/lightchain-assets/mirror/jp/static/none_list.png';

function useProfiles() {
  const { user, currentBrand } = useAuthStore();
  const userId = user?.id ?? ''; const brandId = currentBrand?.id ?? '';
  const [profiles, setProfiles] = useState<AgentPreferenceProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (!userId || !brandId) { setProfiles([]); setActiveId(null); return; }
    const read = () => { setProfiles(readAgentProfiles(userId, brandId)); setActiveId(readActiveAgentProfileId(userId, brandId)); };
    read();
    window.addEventListener('heavy-agent-profiles', read);
    return () => window.removeEventListener('heavy-agent-profiles', read);
  }, [userId, brandId]);
  return { userId, brandId, profiles, activeId };
}

/** A multi-select laid out like Light's 国 / 年齢層 pickers. */
function MultiSelect({ label, placeholder, options, value, onChange }: { label: string; placeholder: string; options: readonly string[]; value: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return <div className="relative">
    <button type="button" aria-label={placeholder} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}
      className={`flex h-8 w-full items-center justify-between rounded-md border bg-[#202426] px-2 text-left text-xs ${open ? 'border-[#0bcabc]' : 'border-white/10'} ${value.length ? 'text-neutral-100' : 'text-neutral-500'}`}>
      <span className="truncate">{value.length ? value.join('、') : placeholder}</span><ChevronDown className="h-3.5 w-3.5 text-neutral-400" /></button>
    {open && <>
      <div className="fixed inset-0 z-20" aria-hidden="true" onClick={() => setOpen(false)} />
      <div role="listbox" aria-label={label} aria-multiselectable="true" className="absolute left-0 right-0 top-9 z-30 rounded-lg border border-white/10 bg-[#262a2b] py-1 shadow-2xl">
        <p className="px-4 py-2 text-xs text-neutral-400">{placeholder}（複数選択可）</p>
        {options.map((option) => { const selected = value.includes(option);
          return <button key={option} type="button" role="option" aria-selected={selected} onClick={() => onChange(selected ? value.filter((item) => item !== option) : [...value, option])}
            className="flex h-10 w-full items-center justify-between px-4 text-left text-sm text-neutral-100 hover:bg-white/10">{option}{selected && <Check className="h-4 w-4 text-[#0bcabc]" />}</button>; })}
      </div>
    </>}
  </div>;
}

/** チャネル / 参考ブランド: type a name, Enter adds it as a tag. */
function TagInput({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const text = draft.trim().slice(0, 60);
    if (text && !value.includes(text)) onChange([...value, text].slice(0, 20));
    setDraft('');
  };
  return <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-white/10 bg-[#202426] px-2 py-1">
    {value.map((tag) => <span key={tag} className="flex h-6 items-center gap-1 rounded bg-white/10 px-2 text-xs text-neutral-100">{tag}
      <button type="button" aria-label={`${tag}を外す`} onClick={() => onChange(value.filter((item) => item !== tag))} className="text-neutral-400 hover:text-white"><X className="h-3 w-3" /></button></span>)}
    <input aria-label={label} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={add} placeholder={value.length ? '' : placeholder}
      className="h-6 min-w-[160px] flex-1 bg-transparent text-xs text-neutral-100 outline-none placeholder:text-neutral-500" />
  </div>;
}

const MATERIAL_FORMATS = '対応形式：PDF、PPTX、DOCX、XLSX、CSV、JPG、PNG';
type MaterialRow = { name: string; size: number };

function MaterialRows({ rows, onRemove }: { rows: MaterialRow[]; onRemove?: (index: number) => void }) {
  return <div className="mt-4 grid max-h-40 gap-2 overflow-auto">
    {rows.map((row, index) => <div key={`${row.name}-${index}`} className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-[#202426] p-2 text-sm font-medium text-neutral-100" data-testid="agent-profile-material">
      <FileText className="h-5 w-5 shrink-0 text-neutral-300" /><span className="min-w-0 flex-1 truncate">{row.name}</span>
      {onRemove && <button type="button" aria-label={`${row.name}を外す`} onClick={() => onRemove(index)} className="rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-white"><Trash2 className="h-4 w-4" /></button>}
    </div>)}
  </div>;
}

/** Light's 資料をアップロード: drop or pick up to eight materials, then 解析を開始. */
function MaterialUploadDialog({ onCancel, onStart }: { onCancel: () => void; onStart: (files: File[]) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const add = (picked: File[]) => {
    const usable = picked.filter(isProfileMaterial);
    setError(usable.length < picked.length ? '対応していない形式のファイルは追加していません' : null);
    setFiles((current) => {
      const next = [...current, ...usable];
      if (next.length > PROFILE_MATERIAL_LIMIT) setError(`画像とファイルは合計${PROFILE_MATERIAL_LIMIT}点までです`);
      return next.slice(0, PROFILE_MATERIAL_LIMIT);
    });
  };
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={onCancel}>
    <div role="dialog" aria-modal="true" aria-label="資料をアップロード" data-testid="agent-profile-material-dialog" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}
      className="w-[512px] max-w-full rounded-lg border border-white/10 bg-[#25292b] p-6 text-white shadow-2xl">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">資料をアップロード</h2>
        <button type="button" aria-label="閉じる" onClick={onCancel} className="text-neutral-400 hover:text-white"><X className="h-4 w-4" /></button></div>
      <p className="mt-4 text-xs leading-4 text-neutral-300">システムは資料に明記された情報のみ自動入力します。記載のない項目は空欄のままになります</p>
      <input ref={input} type="file" multiple accept={PROFILE_MATERIAL_ACCEPT} aria-label="資料を選択" className="sr-only" onChange={(event) => { add(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <button type="button" onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); add(Array.from(event.dataTransfer.files)); }}
        className="mt-3 flex h-[176px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-2 text-center hover:border-white/30">
        <span className="relative flex h-16 w-16 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#6fd7cf_0%,#3d6475_42%,#9964ac_100%)] text-[8px] font-bold tracking-[0.12em] text-white/90">CUSTOM<span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-neutral-900"><Plus className="h-3.5 w-3.5" /></span></span>
        <span className="mt-4 text-sm font-medium text-white">ここにファイルをドラッグするか、クリックして選択</span>
        <span className="mt-2 text-xs leading-4 text-neutral-400">{MATERIAL_FORMATS}。画像とファイルは合計{PROFILE_MATERIAL_LIMIT}点までです</span>
      </button>
      {files.length > 0 && <MaterialRows rows={files} onRemove={(index) => setFiles((current) => current.filter((_, at) => at !== index))} />}
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      <div className="mt-8 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-10 rounded-lg bg-[#4a5052] px-5 text-sm text-white hover:bg-[#565d60]">キャンセル</button>
        <button type="button" disabled={!files.length} onClick={() => onStart(files)} className="h-10 rounded-lg bg-[#0bcabc] px-5 text-sm font-medium text-neutral-950 hover:bg-[#3dd8cc] disabled:bg-[#4a5052] disabled:text-neutral-400">解析を開始</button>
      </div>
    </div>
  </div>;
}

const ANALYSIS_STEPS = (name: string) => [`${name}を読み込み中…`, '商品カテゴリと価格情報を抽出', '品類、国、年齢層、チャネルを識別'];

/** Light's 資料ファイル card: idle → 資料を選択, analysing → スマート自動入力 with progress, done → 再アップロードして解析. */
function MaterialsCard({ materials, brandId, onExtracted, onRemove }: {
  materials: MaterialRow[]; brandId: string; onExtracted: (profile: ExtractedProfile, files: File[]) => void; onRemove: (index: number) => void;
}) {
  const [dialog, setDialog] = useState(false);
  const [analyzing, setAnalyzing] = useState<{ files: File[]; step: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!analyzing || analyzing.step >= 2) return;
    const timer = window.setTimeout(() => setAnalyzing((current) => current && { ...current, step: current.step + 1 }), 2500);
    return () => window.clearTimeout(timer);
  }, [analyzing]);
  const start = async (files: File[]) => {
    setDialog(false); setError(null); setAnalyzing({ files, step: 0 });
    try { onExtracted(await extractProfileFromMaterials(brandId, files), files); }
    catch (cause) { setError(cause instanceof Error && /[ぁ-んァ-ン一-龥]/.test(cause.message) ? cause.message : '資料を解析できませんでした。時間をおいてもう一度お試しください'); }
    finally { setAnalyzing(null); }
  };
  const card = 'mt-8 rounded-2xl border border-white/10 bg-[#202426] p-6';
  return <>
    {analyzing ? <div data-testid="agent-profile-material-analyzing">
      <p className="mt-8 flex flex-wrap items-center gap-2 text-sm font-medium text-white">スマート自動入力
        <span className="flex items-center gap-1 text-[10px] font-normal text-amber-400"><AlertTriangle className="h-3 w-3" />システムは資料に明記された情報のみ自動入力します。記載のない項目は空欄のままになります</span></p>
      <div className="mt-3 rounded-2xl border border-white/10 bg-[#202426] p-6">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-sm font-medium text-white">資料パックをアップロードして自動入力</p>
            <p className="mt-1 text-xs leading-5 text-neutral-400">商品企画、ブランド資料、販売振り返り、顧客提案などに対応<br />{MATERIAL_FORMATS}</p></div>
          <button type="button" disabled className="h-8 shrink-0 rounded-lg bg-[#4a5052] px-4 text-xs text-neutral-300">解析中…</button>
        </div>
        <MaterialRows rows={analyzing.files} />
      </div>
      <div className="mt-3 rounded-2xl border border-white/10 bg-[#202426] p-6">
        <div className="flex items-center gap-4"><p className="shrink-0 text-sm font-medium text-white">資料パックを解析中</p>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[#0bcabc] transition-all" style={{ width: `${[20, 50, 80][analyzing.step]}%` }} /></span>
          <span className="text-xs text-[#0bcabc]">{[20, 50, 80][analyzing.step]}%</span></div>
        <ul className="mt-4 grid gap-2 text-xs text-neutral-400">
          {ANALYSIS_STEPS(analyzing.files[0]?.name ?? '資料').map((label, index) => <li key={label} className="flex items-center gap-2">
            {index < analyzing.step ? <Check className="h-3.5 w-3.5 text-[#0bcabc]" /> : index === analyzing.step ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-3.5 w-3.5 rounded-full border border-white/20" />}{label}</li>)}
        </ul>
      </div>
    </div> : <div className={card} data-testid="agent-profile-materials">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-sm font-medium text-white">資料ファイル</p><p className="mt-1 text-xs text-neutral-400">複数ファイルに対応。アップロード後、プロファイルに保存されます</p></div>
        <button type="button" onClick={() => setDialog(true)} className="h-8 shrink-0 rounded-lg bg-[#0bcabc] px-4 text-xs font-medium text-neutral-950 hover:bg-[#3dd8cc]">{materials.length ? '再アップロードして解析' : '資料を選択'}</button>
      </div>
      {materials.length > 0 && <MaterialRows rows={materials} onRemove={onRemove} />}
      {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
    </div>}
    {dialog && <MaterialUploadDialog onCancel={() => setDialog(false)} onStart={(files) => void start(files)} />}
  </>;
}

function ProfileForm({ initial, onDone }: { initial: AgentPreferenceProfile | null; onDone: () => void }) {
  const { userId, brandId } = useProfiles();
  const [form, setForm] = useState(() => initial ? { ...initial } : { ...EMPTY });
  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) => setForm((current) => ({ ...current, [key]: value }));
  // Light counts five required items: 名前・カテゴリー・価格帯・国・年齢層.
  const done = [form.name.trim(), form.categories.length, form.priceMin.trim() || form.priceMax.trim(), form.countries.length, form.ages.length].filter(Boolean).length;
  const dirty = JSON.stringify({ ...form, id: undefined, updatedAt: undefined }) !== JSON.stringify({ ...(initial ?? EMPTY), id: undefined, updatedAt: undefined });
  const save = () => {
    if (done < 5 || !userId || !brandId) return;
    saveAgentProfile(userId, brandId, { ...form, name: form.name.trim(), id: initial?.id ?? crypto.randomUUID(), updatedAt: new Date().toISOString() });
    onDone();
  };
  const label = (text: string, required = false) => <p className="mb-2 text-xs font-medium text-neutral-200">{text}{required && <span className="ml-0.5 text-red-400">*</span>}</p>;
  return <div className="relative mx-auto w-full max-w-[716px] pb-32" data-testid="agent-profile-form">
    <h1 className="text-[32px] font-semibold leading-[44px] text-white">業務プリファレンスプロファイルを{initial ? '編集' : '作成'}</h1>
    <p className="mt-2 text-sm text-neutral-400">複数のタスクで繰り返し使う業務範囲を保存します。タスク開始時に自動で適用されます</p>
    <MaterialsCard materials={form.materials ?? []} brandId={brandId}
      onRemove={(index) => setForm((current) => ({ ...current, materials: (current.materials ?? []).filter((_, at) => at !== index) }))}
      onExtracted={(found, files) => setForm((current) => ({
        ...current,
        // Light fills only what the materials state and leaves the rest as it was.
        name: found.name || current.name, categories: found.categories.length ? found.categories : current.categories,
        priceMin: found.priceMin || current.priceMin, priceMax: found.priceMax || current.priceMax, currency: found.currency || current.currency,
        countries: found.countries.length ? found.countries : current.countries, ages: found.ages.length ? found.ages : current.ages,
        channels: found.channels.length ? found.channels : current.channels, brands: found.brands.length ? found.brands : current.brands,
        visual: found.visual || current.visual, materialsSummary: found.summary || current.materialsSummary,
        materials: files.map((file) => ({ name: file.name, size: file.size })),
      }))} />
    <label className="mt-8 block">{label('プロファイル名', true)}
      <input value={form.name} maxLength={60} onChange={(event) => set('name', event.target.value)} placeholder="例：通勤レディースプロファイル" aria-label="プロファイル名"
        className="h-8 w-full rounded-md border border-white/10 bg-[#202426] px-2 text-xs text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-[#0bcabc]" /></label>
    <h2 className="mt-8 text-base font-medium text-white">業務範囲</h2>
    <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-6">
      <div>{label('カテゴリー', true)}<div className="flex gap-2">{AGENT_PROFILE_CATEGORIES.map((category) => { const on = form.categories.includes(category);
        return <button key={category} type="button" aria-pressed={on} onClick={() => set('categories', on ? form.categories.filter((item) => item !== category) : [...form.categories, category])}
          className={`h-8 rounded-md border px-3 text-sm ${on ? 'border-[#0bcabc] bg-[#0bcabc]/10 text-white' : 'border-white/10 bg-[#202426] text-neutral-200 hover:bg-white/10'}`}>{category}</button>; })}</div></div>
      <div>{label('価格帯', true)}<div className="flex items-center gap-2">
        <input inputMode="numeric" aria-label="最低価格" placeholder="最低価格" value={form.priceMin} onChange={(event) => set('priceMin', event.target.value.replace(/[^\d.]/g, '').slice(0, 12))}
          className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-[#202426] px-2 text-xs text-neutral-100 outline-none placeholder:text-neutral-500" />–
        <input inputMode="numeric" aria-label="最高価格" placeholder="最高価格" value={form.priceMax} onChange={(event) => set('priceMax', event.target.value.replace(/[^\d.]/g, '').slice(0, 12))}
          className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-[#202426] px-2 text-xs text-neutral-100 outline-none placeholder:text-neutral-500" />
        <select aria-label="通貨" value={form.currency} onChange={(event) => set('currency', event.target.value)}
          className={`h-8 w-24 rounded-md border border-white/10 bg-[#202426] px-2 text-xs outline-none ${form.currency ? 'text-neutral-100' : 'text-neutral-500'}`}>
          <option value="">通貨</option>{AGENT_PROFILE_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></div></div>
      <div>{label('国', true)}<MultiSelect label="国" placeholder="国を選択" options={AGENT_PROFILE_COUNTRIES} value={form.countries} onChange={(next) => set('countries', next)} /></div>
      <div>{label('年齢層', true)}<MultiSelect label="年齢層" placeholder="年齢層を選択" options={AGENT_PROFILE_AGES} value={form.ages} onChange={(next) => set('ages', next)} /></div>
    </div>
    <div className="mt-6">{label('チャネル')}<TagInput label="チャネル" placeholder="チャネル名を入力し、Enterで確定" value={form.channels} onChange={(next) => set('channels', next)} /></div>
    <div className="mt-6">{label('参考ブランド')}<TagInput label="参考ブランド" placeholder="ブランド名を入力し、Enterで確定" value={form.brands} onChange={(next) => set('brands', next)} /></div>
    <label className="mt-6 block">{label('ビジュアルの好み')}
      <textarea aria-label="ビジュアルの好み" value={form.visual} maxLength={500} rows={4} onChange={(event) => set('visual', event.target.value)}
        placeholder="希望する色、シルエット、素材、ディテール、モデル、構図、避けたい表現を入力してください"
        className="w-full resize-none rounded-md border border-white/10 bg-[#202426] p-2 text-xs leading-5 text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-[#0bcabc]" /></label>
    {/* Light keeps リセット / 完了 n / 5 / キャンセル / 保存 in a bar pinned to the bottom of the form. */}
    <div className="sticky bottom-6 mt-10 flex h-[72px] items-center justify-between rounded-2xl border border-white/10 bg-[#262a2b] px-4 shadow-2xl" data-testid="agent-profile-form-bar">
      <button type="button" disabled={!dirty} onClick={() => setForm(initial ? { ...initial } : { ...EMPTY })}
        className="flex h-10 items-center gap-2 rounded-lg border border-white/15 px-5 text-sm text-neutral-100 hover:bg-white/10 disabled:opacity-40"><RotateCcw className="h-4 w-4" />リセット</button>
      <div className="flex items-center gap-2">
        <span className="mr-2 text-xs text-neutral-400">完了 <span className="text-[#0bcabc]">{done} / 5</span> 件の必須項目</span>
        <button type="button" onClick={onDone} className="h-10 rounded-lg bg-[#4a5052] px-5 text-sm text-white hover:bg-[#565d60]">キャンセル</button>
        <button type="button" disabled={done < 5} onClick={save} className="h-10 rounded-lg bg-[#0bcabc] px-5 text-sm font-medium text-neutral-950 hover:bg-[#3dd8cc] disabled:bg-[#4a5052] disabled:text-neutral-400">プロファイルを保存</button>
      </div>
    </div>
  </div>;
}

function ProfileList() {
  const navigate = useNavigate();
  const { userId, brandId, profiles, activeId } = useProfiles();
  const [query, setQuery] = useState('');
  const visible = useMemo(() => profiles.filter((profile) => !query.trim() || JSON.stringify(profile).includes(query.trim())), [profiles, query]);
  return <div className="mx-auto w-full max-w-[720px]" data-testid="agent-profile-list">
    <div className="flex items-start justify-between gap-4">
      <div><h1 className="text-[32px] font-semibold leading-[44px] text-white">業務プリファレンスプロファイル</h1>
        <p className="mt-2 text-sm text-neutral-400">長期的に使う業務設定を保存し、タスクに自動適用します。</p></div>
      <button type="button" onClick={() => navigate('/agent/profiles/create')} className="mt-4 flex h-10 shrink-0 items-center gap-2 rounded-lg bg-[#0bcabc] px-5 text-sm font-medium text-neutral-950 hover:bg-[#3dd8cc]"><Plus className="h-5 w-5" />新規プロファイル</button>
    </div>
    <label className="mt-6 flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-[#202426] px-3 text-sm text-neutral-400">
      <Search className="h-4 w-4" /><input aria-label="プロファイル名と内容を検索" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="プロファイル名と内容を検索" className="flex-1 bg-transparent text-neutral-100 outline-none placeholder:text-neutral-500" /></label>
    {profiles.length === 0 ? <div className="mt-20 flex flex-col items-center text-center" data-testid="agent-profile-empty">
      <img src={EMPTY_ICON} alt="" className="h-20 w-20" />
      <p className="mt-4 text-sm font-medium text-neutral-200">業務プリファレンスプロファイルはまだありません</p>
      <p className="mt-2 text-xs text-neutral-500">カテゴリ、価格帯、国、対象年齢を保存しておくと、以降のタスクで再入力する必要がありません</p>
      <button type="button" onClick={() => navigate('/agent/profiles/create')} className="mt-4 h-8 rounded-lg bg-[#0bcabc] px-4 text-xs font-medium text-neutral-950 hover:bg-[#3dd8cc]">新規プロファイル</button>
    </div> : <div className="mt-6 grid gap-3">
      {visible.length === 0 && <p className="py-8 text-center text-sm text-neutral-500">該当するプロファイルがありません</p>}
      {visible.map((profile) => <article key={profile.id} className={`rounded-xl border bg-[#202426] p-4 ${profile.id === activeId ? 'border-[#0bcabc]/60' : 'border-white/10'}`} data-testid="agent-profile-card">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-medium text-white">{profile.name}</h2>
          {profile.id === activeId ? <span className="rounded bg-[#0bcabc]/15 px-2 py-0.5 text-xs text-[#0bcabc]">タスクに適用中</span>
            : <button type="button" onClick={() => selectAgentProfile(userId, brandId, profile)} className="rounded px-2 py-0.5 text-xs text-neutral-300 hover:bg-white/10">タスクに適用</button>}
          <button type="button" aria-label={`${profile.name}を編集`} onClick={() => navigate(`/agent/profiles/${profile.id}`)} className="rounded p-1.5 text-neutral-300 hover:bg-white/10"><Pencil className="h-4 w-4" /></button>
          <button type="button" aria-label={`${profile.name}を削除`} onClick={() => { if (window.confirm(`「${profile.name}」を削除しますか？`)) deleteAgentProfile(userId, brandId, profile.id); }} className="rounded p-1.5 text-neutral-300 hover:bg-white/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
        </div>
        <p className="mt-2 text-xs leading-5 text-neutral-400">{[profile.categories.join('・'), (profile.priceMin || profile.priceMax) && `${profile.priceMin || '—'}〜${profile.priceMax || '—'} ${profile.currency}`, profile.countries.join('・'), profile.ages.join('・')].filter(Boolean).join(' ／ ')}</p>
      </article>)}
    </div>}
  </div>;
}

/** Light's /agent/profiles: the list of 業務プリファレンスプロファイル, plus its create and edit form. */
export function AgentProfilesPage({ mode }: { mode: 'list' | 'create' | 'edit' }) {
  const navigate = useNavigate();
  const { profileId } = useParams();
  const { profiles } = useProfiles();
  const editing = mode === 'edit' ? profiles.find((profile) => profile.id === profileId) ?? null : null;
  return <main className="dark flex h-[calc(100vh-50px)] min-h-full bg-[#171b1c] text-white" data-testid="agent-profiles-page">
    <AgentSidebar title="インスピレーションワークスペース" profilesActive onNewTask={() => navigate('/agent')} />
    <section className="relative flex min-w-0 flex-1 flex-col overflow-y-auto px-6 pt-16">
      {mode !== 'list' && <button type="button" onClick={() => navigate('/agent/profiles')} className="absolute left-7 top-4 flex h-10 items-center gap-2 rounded-lg border border-white/15 px-5 text-sm text-neutral-100 hover:bg-white/10"><ArrowLeft className="h-4 w-4" />戻る</button>}
      {mode === 'list' ? <ProfileList />
        : mode === 'edit' && !editing ? <p className="mx-auto text-sm text-neutral-400">このプロファイルは見つかりません。</p>
        : <ProfileForm key={editing?.id ?? 'new'} initial={editing} onDone={() => navigate('/agent/profiles')} />}
    </section>
  </main>;
}
