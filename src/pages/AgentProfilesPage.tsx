import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, Pencil, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { AgentSidebar } from '../features/agent/AgentSidebar';
import {
  AGENT_PROFILE_AGES, AGENT_PROFILE_CATEGORIES, AGENT_PROFILE_COUNTRIES, AGENT_PROFILE_CURRENCIES, deleteAgentProfile,
  readActiveAgentProfileId, readAgentProfiles, saveAgentProfile, selectAgentProfile, type AgentPreferenceProfile,
} from '../features/agent/agentTasks';

const EMPTY: Omit<AgentPreferenceProfile, 'id' | 'updatedAt'> = { name: '', categories: [], priceMin: '', priceMax: '', currency: '', countries: [], ages: [], channels: [], brands: [], visual: '' };
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
