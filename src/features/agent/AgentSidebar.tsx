import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Folder, FolderPlus, MessageSquareText, PanelLeft, PanelLeftClose, Search, Sparkles, X } from 'lucide-react';
import { cloudflareDataPlane } from '../../lib/cloudflareApi';
import { useAuthStore } from '../../stores/authStore';
import { addAgentProject, listAgentTasks, readAgentProfile, readAgentProjects, writeAgentProfile, type AgentTaskDocument } from './agentTasks';

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear()).slice(2)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** The signed-in user's own planning tasks (newest first). `refreshKey` reloads after a task changes. */
export function useAgentTasks(refreshKey: unknown = null) {
  const { user, currentBrand } = useAuthStore();
  const brandId = currentBrand?.id;
  const [tasks, setTasks] = useState<AgentTaskDocument[] | null>(null);
  useEffect(() => {
    if (!brandId || !user?.id) { setTasks([]); return; }
    let active = true;
    void listAgentTasks(brandId).then((list) => { if (active) setTasks(list); }).catch(() => { if (active) setTasks([]); });
    return () => { active = false; };
  }, [brandId, user?.id, refreshKey]);
  return tasks;
}

export function useRemainingCredits() {
  const brandId = useAuthStore((state) => state.currentBrand?.id);
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!brandId || !cloudflareDataPlane) return;
    let cancelled = false;
    void cloudflareDataPlane.getImageUsage(brandId).then((summary) => {
      if (!cancelled) setRemaining(Number.isSafeInteger(summary.remainingUnits) && summary.remainingUnits >= 0 ? summary.remainingUnits : null);
    }).catch(() => { if (!cancelled) setRemaining(null); });
    return () => { cancelled = true; };
  }, [brandId]);
  return remaining;
}

/** 業務プリファレンスプロファイル: company/brand context added to every planning request. */
export function AgentProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, currentBrand } = useAuthStore();
  const [value, setValue] = useState('');
  useEffect(() => { if (open && user?.id && currentBrand?.id) setValue(readAgentProfile(user.id, currentBrand.id)); }, [open, user?.id, currentBrand?.id]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="presentation" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="agent-profile-title" className="w-[560px] max-w-full rounded-2xl border border-white/10 bg-[#262a2b] p-6 text-neutral-100 shadow-2xl" onClick={(event) => event.stopPropagation()} data-testid="agent-profile-dialog">
        <div className="flex items-center justify-between"><h2 id="agent-profile-title" className="text-xl font-semibold">業務プリファレンスプロファイル</h2>
          <button type="button" aria-label="閉じる" onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-white/10"><X className="h-5 w-5" /></button></div>
        <p className="mt-2 text-sm leading-6 text-neutral-400">会社やブランドの特徴、主な顧客、価格帯、得意なカテゴリなどを書いておくと、企画の提案に反映されます。</p>
        <label className="sr-only" htmlFor="agent-profile-text">プロファイル</label>
        <textarea id="agent-profile-text" value={value} maxLength={800} onChange={(event) => setValue(event.target.value)} rows={7}
          placeholder="例：30代女性向けのオフィスカジュアルブランド。価格帯は1万〜3万円。自然素材を重視。"
          className="mt-4 w-full resize-none rounded-xl border border-white/10 bg-[#1b1f20] p-3 text-sm leading-6 text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-cyan-400/60" />
        <div className="mt-1 text-right text-xs text-neutral-500">{value.length} / 800</div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-white/10 px-4 text-sm text-neutral-300 hover:bg-white/10">キャンセル</button>
          <button type="button" onClick={() => { if (user?.id && currentBrand?.id) writeAgentProfile(user.id, currentBrand.id, value.trim()); onClose(); }}
            className="h-10 rounded-lg bg-cyan-300 px-4 text-sm font-medium text-neutral-950 hover:bg-cyan-200">保存</button>
        </div>
      </div>
    </div>
  );
}

export function useAgentProjects() {
  const { user, currentBrand } = useAuthStore();
  const [projects, setProjects] = useState<string[]>([]);
  useEffect(() => {
    if (!user?.id || !currentBrand?.id) { setProjects([]); return; }
    const read = () => setProjects(readAgentProjects(user.id, currentBrand.id));
    read();
    window.addEventListener('heavy-agent-projects', read);
    return () => window.removeEventListener('heavy-agent-projects', read);
  }, [user?.id, currentBrand?.id]);
  return projects;
}

/** Light's プロジェクトを作成 dialog: a project name of up to 40 characters. */
export function AgentProjectCreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (name: string) => void }) {
  const { user, currentBrand } = useAuthStore();
  const [name, setName] = useState('');
  useEffect(() => { if (open) setName(''); }, [open]);
  if (!open) return null;
  const create = () => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed || !user?.id || !currentBrand?.id) return;
    addAgentProject(user.id, currentBrand.id, trimmed);
    onCreated?.(trimmed); onClose();
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="presentation" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="lightchain-agent-project-create-title" data-testid="lightchain-agent-project-create-modal"
        className="w-[480px] max-w-full rounded-2xl border border-white/10 bg-[#262a2b] p-6 text-neutral-100 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 id="lightchain-agent-project-create-title" className="text-xl font-semibold leading-7">プロジェクトを作成</h2>
          <button type="button" aria-label="閉じる" onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
        <p className="mt-2 text-sm leading-6 text-neutral-400">プロジェクトは過去タスクの整理に使います。名称は40文字以内で入力してください</p>
        <div className="relative mt-4">
          <input autoFocus aria-label="プロジェクト名です" placeholder="プロジェクト名を入力" value={name} maxLength={40} onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') create(); }}
            className="h-11 w-full rounded-lg border border-white/10 bg-[#1b1f20] px-3 pr-16 text-base text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-cyan-400/60" />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-base text-neutral-400">{name.length} / 40</span>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-white/10 px-4 text-base text-neutral-300 hover:bg-white/10">キャンセル</button>
          <button type="button" onClick={create} disabled={!name.trim()} className="h-10 w-[76px] rounded-lg bg-cyan-300 text-base font-medium text-neutral-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-[#687174] disabled:text-neutral-400">作成</button>
        </div>
      </div>
    </div>
  );
}

type SidebarProps = { title: string; activeTaskId?: string | null; refreshKey?: unknown; onNewTask: () => void };

/** Light's 352px planning sidebar: 新規タスク, 業務プリファレンスプロファイル, 最近 (the user's real tasks) and credits. */
export function AgentSidebar({ title, activeTaskId = null, refreshKey = null, onNewTask }: SidebarProps) {
  const navigate = useNavigate();
  const tasks = useAgentTasks(refreshKey);
  const credits = useRemainingCredits();
  const [open, setOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const projects = useAgentProjects();
  const visible = (tasks ?? []).filter((task) => (!query.trim() || task.title.includes(query.trim()) || task.task.prompt.includes(query.trim()))
    && (!projectFilter || task.task.project === projectFilter));

  if (!open) {
    return (
      <aside aria-label="企画ワークスペースサイドバー" className="relative z-20 flex h-full w-[64px] shrink-0 flex-col items-center gap-3 overflow-hidden border-r border-white/10 bg-[#262a2b] py-3 text-neutral-100">
        <button type="button" aria-label="サイドバーを開く" onClick={() => setOpen(true)} className="rounded-md p-1.5 text-neutral-300 hover:bg-white/10"><PanelLeft className="h-4 w-4" /></button>
        <button type="button" aria-label="新規タスク" onClick={onNewTask} className="rounded-md p-1.5 text-neutral-300 hover:bg-white/10"><MessageSquareText className="h-4 w-4" /></button>
        <button type="button" aria-label="業務プリファレンスプロファイル" onClick={() => setProfileOpen(true)} className="rounded-md p-1.5 text-neutral-300 hover:bg-white/10"><ClipboardList className="h-4 w-4" /></button>
        <AgentProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
      </aside>
    );
  }
  return (
    <aside aria-label="企画ワークスペースサイドバー" className="relative z-20 hidden h-full w-[352px] shrink-0 p-3 md:block" data-testid="agent-sidebar">
      <div className="absolute inset-3 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#262a2b] p-4 text-neutral-100 shadow-xl">
        <div className="flex h-8 w-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-base font-medium text-neutral-200">
            <button type="button" aria-label="ホームに戻る" onClick={() => navigate('/designProduction')} className="shrink-0"><span aria-hidden="true">‹</span></button>
            <span className="truncate">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="検索" onClick={() => setSearching((value) => !value)} className="flex h-8 w-8 items-center justify-center rounded-lg p-1 text-neutral-300 hover:bg-white/10"><Search className="h-4 w-4" /></button>
            <button type="button" aria-label="サイドバーを閉じる" onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg p-1 text-neutral-300 hover:bg-white/10"><PanelLeftClose className="h-4 w-4" /></button>
          </div>
        </div>
        {searching && <input autoFocus aria-label="タスクを検索" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タスクを検索"
          className="mt-3 h-9 w-full rounded-lg border border-white/10 bg-[#1b1f20] px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-500" />}
        <nav aria-label="ワークベンチ入口" className="mt-4 grid gap-2">
          <button type="button" onClick={onNewTask} className="flex h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-lg font-medium leading-6 text-neutral-300 hover:bg-white/10">
            <MessageSquareText className="h-4 w-4" />新規タスク</button>
          <button type="button" onClick={() => setProfileOpen(true)} className="flex h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-lg font-medium leading-6 text-neutral-300 hover:bg-white/10">
            <ClipboardList className="h-4 w-4" />業務プリファレンスプロファイル</button>
        </nav>
        <div className="mt-2 h-px w-full bg-white/10" />
        <div className="flex min-h-0 flex-auto flex-col overflow-y-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="mt-[16.65625px] flex h-6 items-center justify-between text-base font-medium leading-5 text-neutral-400">
            <button type="button" aria-label="最近" onClick={() => setProjectFilter(null)} className="flex h-6 items-center gap-1">{projectFilter ? `‹ ${projectFilter}` : '最近'}</button>
            <button type="button" aria-label="新規ファイル" aria-haspopup="dialog" onClick={() => setProjectOpen(true)} className="flex h-8 w-8 items-center justify-center rounded-lg p-1 text-neutral-300 hover:bg-white/10"><FolderPlus className="h-4 w-4" /></button>
          </div>
          {!projectFilter && projects.length > 0 && <div className="mt-3 space-y-0" data-testid="agent-projects">
            {projects.map((project) => (
              <button key={project} type="button" onClick={() => setProjectFilter(project)} className="flex h-10 w-full items-center gap-2 rounded-lg pl-7 pr-2 text-left text-base text-neutral-300 hover:bg-white/10">
                <Folder className="h-4 w-4 flex-none text-neutral-400" /><span className="truncate">{project}</span>
              </button>
            ))}
          </div>}
          <div className="mt-4 space-y-0" data-testid="agent-recent-tasks">
            {tasks === null && <p className="pl-7 text-sm text-neutral-500">読み込み中…</p>}
            {tasks !== null && visible.length === 0 && <p className="pl-7 text-sm leading-6 text-neutral-500">{query ? '該当するタスクがありません。' : 'まだタスクがありません。'}</p>}
            {visible.map((task) => (
              <button key={task.id} type="button" aria-current={task.id === activeTaskId ? 'page' : undefined} onClick={() => navigate(`/agent/${task.id}`)}
                data-testid={`agent-task-${task.id}`}
                className={`relative flex min-h-[58px] w-full items-start gap-2 rounded-lg py-2 pl-7 pr-2 text-left text-base font-normal leading-5 text-neutral-300 hover:bg-white/10 ${task.id === activeTaskId ? 'bg-white/10' : ''}`}>
                {task.id === activeTaskId && <span aria-hidden="true" className="absolute left-3 top-4 h-1.5 w-1.5 rounded-full bg-cyan-300" />}
                <span className="min-w-0 flex-1 truncate">{task.title}<span className="mt-1 block text-xs leading-4 text-neutral-500"><span className="mr-1 inline-block rounded border border-white/10 px-1 text-[10px] leading-4">{task.task.subtype}</span>{formatDate(task.task.createdAt)}</span></span>
              </button>
            ))}
          </div>
        </div>
        <div aria-label="残りクレジット" className="-mx-4 -mb-4 flex h-[52px] w-[calc(100%+32px)] flex-none items-center gap-2 border-t border-white/10 bg-transparent px-6 text-sm leading-5 text-neutral-300">
          残りクレジット <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {credits === null ? '—' : credits.toLocaleString()}
        </div>
      </div>
      <AgentProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
      <AgentProjectCreateDialog open={projectOpen} onClose={() => setProjectOpen(false)} />
    </aside>
  );
}
