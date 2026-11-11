import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowUp, Box, Check, Code2, Loader2, Paperclip, PanelRightClose, PanelRightOpen, RotateCcw, UserRound } from 'lucide-react';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { generateImage } from '../lib/imageApi';
import { HEAVY_IMAGE_PROVIDER } from '../lib/heavyImageProvider';
import { resolveGeneratedImageUrlWithStatus } from '../lib/storage';
import { isHeavyWorkspaceBrandName, isHeavyWorkspaceRuntime } from '../lib/heavyWorkspace';
import { useAuthStore } from '../stores/authStore';
import { AgentSidebar } from '../features/agent/AgentSidebar';
import {
  AGENT_INTAKE_STEPS, AGENT_SCOPE_REGIONS, DEFAULT_AGENT_SCOPE, agentConversationId, agentImagePrompt, agentMissingNames, agentNotePrompt,
  agentRequirementsPrompt, agentResearchPrompt, agentResearchSteps, agentRoundSources, agentScopeOptions, agentScopeSummary, agentThemeSearches, assistantStepFrom, buildAgentResearchReportHtml, isAutomaticAgentTaskTitle, parseAgentDirection,
  loadAgentTask, parseAgentRequirements, parseAgentResearch, parsePlanResponse, parseThemeResponse, planPrompt, pruneAgentScope, themePrompt, updateAgentTask,
  type AgentAssistantStep, type AgentImageStep, type AgentNote, type AgentNoteStage, type AgentResearchScope, type AgentTask, type AgentTaskDocument,
} from '../features/agent/agentTasks';

const NONE = 'どれも気に入らない';
const api = () => { if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured'); return cloudflareDataPlane; };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
type AssistantKind = 'theme' | 'plan' | 'requirements' | 'research' | 'note';
type AssistantMode = 'agent' | 'agent-research' | undefined;

function readImageReceipt(receipt: Record<string, unknown>) {
  const image = Array.isArray(receipt.images) && record(receipt.images[0]) ? receipt.images[0] : {};
  return {
    state: text(receipt.state) ?? (receipt.success === false ? 'failed' : undefined),
    storagePath: text(receipt.storagePath) ?? text(image.storagePath) ?? text(image.storage_path),
    imageId: text(receipt.imageId) ?? text(image.imageId) ?? text(image.id),
    jobId: text(receipt.jobId) ?? text(image.jobId),
    errorCode: text(receipt.errorCode) ?? text(receipt.error),
  };
}

function StepSpinner({ label }: { label: string }) {
  return <p role="status" className="flex items-center gap-2 text-sm text-neutral-400"><Loader2 className="h-4 w-4 animate-spin" />{label}</p>;
}

/** Light posts the user's own words as a teal bubble on the right with the avatar beside it. */
function UserBubble({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="flex items-start justify-end gap-3" data-testid={testId}>
      <div className="max-w-[78%] whitespace-pre-wrap rounded-2xl bg-[#0bcabc] px-4 py-3 text-sm leading-6 text-neutral-950">{children}</div>
      <span aria-hidden="true" className="flex size-8 flex-none items-center justify-center rounded-full bg-white/10 text-neutral-300"><UserRound className="h-4 w-4" /></span>
    </div>
  );
}

/** Light's step list: teal dots; the accessible name says 完了 / 進行中 like Light's. */
function StepList({ items, testId }: { items: Array<{ label: string; status: '完了' | '進行中' | '待機中' }>; testId?: string }) {
  return (
    <ul className="space-y-2 text-sm text-neutral-200" data-testid={testId}>
      {items.map((item) => (
        <li key={item.label} aria-label={`${item.status} ${item.label}`} className="flex items-start gap-2">
          <span aria-hidden="true" className={`mt-2 size-1.5 flex-none rounded-full ${item.status === '待機中' ? 'bg-neutral-600' : 'bg-[#0bcabc]'}`} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function ErrorRow({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
      <span>{children}</span>
      {onRetry && <button type="button" onClick={onRetry} className="flex flex-none items-center gap-1 rounded-lg border border-white/20 px-3 py-1 text-white hover:bg-white/10"><RotateCcw className="h-3.5 w-3.5" />再試行</button>}
    </div>
  );
}

function RequirementsView({ content }: { content: string }) {
  const parsed = parseAgentRequirements(content);
  const names = agentMissingNames(parsed.missing);
  return (
    <div className="space-y-3 text-sm leading-6 text-neutral-200" data-testid="agent-requirements">
      {parsed.reply && <p className="whitespace-pre-wrap">{parsed.reply}</p>}
      {parsed.lines.length > 0 && (
        <div>
          <p className="font-medium text-white">今回の要件の理解：</p>
          <dl className="mt-1 space-y-0.5">
            {parsed.lines.map((line, index) => <div key={index} className="flex gap-1"><dt className="flex-none text-neutral-400">{line.label ? `${line.label}：` : ''}</dt><dd>{line.value}</dd></div>)}
          </dl>
        </div>
      )}
      {parsed.missing.length > 0 && <p><span className="text-neutral-400">補足が必要：</span>{parsed.missing.join(' ')}</p>}
      {names && <p>【{names}】を確認してください。直接補足できます。補足がなければ、そのまま調査範囲に進めます。</p>}
    </div>
  );
}

function NoteReply({ note }: { note: AgentNote }) {
  if (note.reply.state === 'running') return <StepSpinner label="考え中…" />;
  if (note.reply.state !== 'completed' || !note.reply.content) return <p role="alert" className="text-sm text-amber-300">返答を受け取れませんでした（{note.reply.errorCode ?? note.reply.state}）。もう一度送信してください。</p>;
  return /\[要件\]|【要件】/.test(note.reply.content) ? <RequirementsView content={note.reply.content} />
    : <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-200">{parseAgentRequirements(note.reply.content).reply}</p>;
}

function Notes({ notes, stage }: { notes: AgentNote[]; stage: AgentNoteStage }) {
  const list = notes.filter((note) => note.stage === stage);
  if (!list.length) return null;
  return <>{list.map((note) => <div key={note.id} className="space-y-4" data-testid="agent-note"><UserBubble>{note.text}</UserBubble><NoteReply note={note} /></div>)}</>;
}

type ScopeDraft = Pick<AgentResearchScope, 'regions' | 'ec' | 'sns' | 'other'>;
function ScopeField({ title, options, selected, editable, onToggle }: { title: string; options: ReadonlyArray<{ value: string; label: string }>; selected: string[]; editable: boolean; onToggle: (value: string) => void }) {
  return (
    <fieldset className="space-y-3 border-b border-white/10 pb-4">
      <legend className="mb-3 text-sm text-neutral-300">{title}<span aria-hidden="true" className="text-red-400"> *</span></legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <button key={option.value} type="button" aria-pressed={on} disabled={!editable} onClick={() => onToggle(option.value)}
              className={`h-10 min-w-10 whitespace-nowrap rounded-lg px-4 text-sm transition-colors ${on ? 'bg-[#0bcabc] text-neutral-950 hover:bg-[#2ad6c9]' : 'border border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/10 hover:text-white'} disabled:cursor-default ${!editable && !on ? 'opacity-60' : ''}`}>
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Light's 「調査範囲を確認」 card. Heavy's text steps use no points, so the start button carries no point badge. */
function ScopeForm({ confirmed, disabled, onConfirm }: { confirmed: AgentResearchScope | null; disabled: boolean; onConfirm: (scope: ScopeDraft) => void }) {
  const [draft, setDraft] = useState<ScopeDraft>({ ...DEFAULT_AGENT_SCOPE });
  const value: ScopeDraft = confirmed ?? draft;
  const editable = !confirmed && !disabled;
  const toggle = (key: 'regions' | 'ec' | 'sns') => (item: string) => setDraft((current) => pruneAgentScope({
    ...current, [key]: current[key].includes(item) ? current[key].filter((entry) => entry !== item) : [...current[key], item],
  }));
  const ready = value.regions.length > 0 && value.ec.length > 0 && value.sns.length > 0;
  return (
    <section aria-label="調査範囲を確認" className="space-y-4 rounded-2xl border border-white/10 bg-[#202426] p-5" data-testid="agent-research-scope">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-base font-medium text-white"><Box className="h-5 w-5 text-cyan-300" />調査範囲を確認</span>
        <span className={`rounded-md border px-2 py-0.5 text-xs ${confirmed ? 'border-emerald-400/60 text-emerald-300' : 'border-amber-400/70 text-amber-300'}`}>{confirmed ? '確認済み' : '確認待ち'}</span>
      </div>
      <ScopeField title="地域（複数選択）" options={AGENT_SCOPE_REGIONS} selected={value.regions} editable={editable} onToggle={toggle('regions')} />
      <ScopeField title="ECプラットフォーム（複数選択）" options={agentScopeOptions(value.regions, 'ec')} selected={value.ec} editable={editable} onToggle={toggle('ec')} />
      <ScopeField title="SNSプラットフォーム（複数選択）" options={agentScopeOptions(value.regions, 'sns')} selected={value.sns} editable={editable} onToggle={toggle('sns')} />
      <label className="block space-y-3">
        <span className="text-sm text-neutral-300">その他の独立サイト／プラットフォーム</span>
        <textarea value={value.other} readOnly={!editable} onChange={(event) => setDraft((current) => ({ ...current, other: event.target.value.slice(0, 400) }))}
          placeholder="その他のECプラットフォームや独立サイト名をカンマで区切って入力してください"
          className="block h-24 w-full resize-none rounded-xl border border-white/10 bg-[#171b1c] px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-cyan-300/60" />
      </label>
      {!confirmed && (
        <div className="flex justify-end gap-2">
          <button type="button" disabled={disabled} onClick={() => setDraft({ ...DEFAULT_AGENT_SCOPE })} className="h-8 rounded-lg border border-white/15 px-3 text-sm text-neutral-200 hover:bg-white/10">選択をリセット</button>
          <button type="button" disabled={!ready || disabled} onClick={() => onConfirm(value)}
            className="h-8 rounded-lg bg-cyan-300 px-4 text-sm font-medium text-neutral-950 disabled:cursor-not-allowed disabled:bg-[#2c5e5b] disabled:text-neutral-400">確認して調査を開始</button>
        </div>
      )}
    </section>
  );
}

const REPORT_TITLE = '調査とビジュアル方向レポート';
/** Light's report file (オンラインで表示 / ダウンロード); Heavy builds the HTML from the stored research. */
function openReport(task: AgentTask, download: boolean) {
  const url = URL.createObjectURL(new Blob([buildAgentResearchReportHtml(task)], { type: 'text/html;charset=utf-8' }));
  if (download) {
    const link = document.createElement('a'); link.href = url; link.download = `${REPORT_TITLE}.html`; document.body.appendChild(link); link.click(); link.remove();
  } else window.open(url, '_blank', 'noopener');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function ReportCard({ task }: { task: AgentTask }) {
  const research = parseAgentResearch(task.research?.content ?? '');
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#202426] px-4 py-3" data-testid="agent-research-report">
      <span aria-hidden="true" className="flex size-8 flex-none items-center justify-center rounded-lg bg-[#f2683c] text-white"><Code2 className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{REPORT_TITLE}</p>
        <p className="truncate text-xs text-neutral-400" data-testid="agent-research-source-count">
          {research.search === 'ok' ? `ウェブ検索の資料${research.sources.length}件 · 市場・トレンド・価格の根拠と企画への示唆` : 'ウェブ検索を使えませんでした · AIモデルの知識に基づく整理'}
        </p>
      </div>
      <button type="button" onClick={() => openReport(task, false)} className="flex-none text-sm text-cyan-300 hover:underline">オンラインで表示</button>
      <button type="button" onClick={() => openReport(task, true)} className="flex-none text-sm text-cyan-300 hover:underline">ダウンロード</button>
    </div>
  );
}

/** Light's 「ビジュアル方向性を選択」: one or more directions, each with what it is and why it is recommended. */
function DirectionPicker({ themes, chosen, disabled, onRevise, onConfirm }: { themes: string[]; chosen: string[] | null; disabled: boolean; onRevise: () => void; onConfirm: (themes: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const value = chosen ?? picked;
  const editable = !chosen && !disabled;
  return (
    <section aria-label="ビジュアル方向性を選択" className="space-y-3 rounded-2xl border border-white/10 bg-[#202426] p-5" data-testid="agent-design-request">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-base font-medium text-white"><Box className="h-5 w-5 text-cyan-300" />ビジュアル方向性を選択</span>
        <span className={`rounded-md border px-2 py-0.5 text-xs ${chosen ? 'border-emerald-400/60 text-emerald-300' : 'border-amber-400/70 text-amber-300'}`}>{chosen ? '確認済み' : '確認待ち'}</span>
      </div>
      <p className="text-xs text-neutral-400">商品構成計画に進む方向性を1つ以上選択してください</p>
      <div className="space-y-2">
        {themes.map((theme) => {
          const direction = parseAgentDirection(theme);
          const on = value.includes(theme);
          return (
            <button key={theme} type="button" role="checkbox" aria-checked={on} disabled={!editable} onClick={() => setPicked((current) => current.includes(theme) ? current.filter((entry) => entry !== theme) : [...current, theme])}
              className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${on ? 'border-cyan-300/70 bg-cyan-300/10' : 'border-white/10 hover:bg-white/5'} disabled:cursor-default`}>
              <span aria-hidden="true" className={`mt-0.5 flex size-4 flex-none items-center justify-center rounded border ${on ? 'border-cyan-300 bg-cyan-300 text-neutral-900' : 'border-white/40'}`}>{on && <Check className="h-3 w-3" />}</span>
              <span className="min-w-0 space-y-1">
                <span className="block text-sm font-medium text-white">{direction.name}</span>
                {direction.description && <span className="block text-xs leading-5 text-neutral-300">{direction.description}</span>}
                {direction.recommendation && <span className="block text-xs leading-5 text-cyan-200/80">{direction.recommendation}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {!chosen && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" disabled={!editable} onClick={() => setPicked(themes)} className="h-8 rounded-lg border border-white/15 px-3 text-sm text-neutral-200 hover:bg-white/10">全選択</button>
          <button type="button" disabled={disabled} onClick={onRevise} className="h-8 rounded-lg border border-white/15 px-3 text-sm text-neutral-200 hover:bg-white/10">修正・補足する</button>
          <button type="button" disabled={!editable || value.length === 0} onClick={() => onConfirm(value)}
            className="h-8 rounded-lg bg-cyan-300 px-4 text-sm font-medium text-neutral-950 disabled:cursor-not-allowed disabled:bg-[#2c5e5b] disabled:text-neutral-400">確認して続行</button>
        </div>
      )}
    </section>
  );
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/**
 * /agent/:taskId — one planning task. Steps advance automatically; every request identity is stored on the task
 * before it is sent, so a reload only reads back the in-flight request and never sends it twice. New tasks follow
 * Light's conversation (requirements → 「問題ありません、続行」 → research scope → web research → themes → plan);
 * tasks made before it start at the themes.
 */
export default function HeavyAgentTaskPage() {
  const { taskId = '' } = useParams();
  const navigate = useNavigate();
  const brandId = useAuthStore((state) => state.currentBrand?.id ?? null);
  const [doc, setDoc] = useState<AgentTaskDocument | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [selected, setSelected] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const docRef = useRef<AgentTaskDocument | null>(null);
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  const busy = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const retries = useRef<Record<string, number>>({});
  /**
   * One automatic step at a time; when it settles the advance effect runs again. An automatic step (retryKey) that fails
   * re-reads the task and tries again twice before saying so: right after the task is created its first save can fail
   * once (2026-11-11: 「タスクを開始できませんでした。」 showed while the retry 7 s later went through).
   */
  const guard = useCallback((work: () => Promise<unknown>, failure?: string, retryKey?: string) => {
    if (busy.current) return;
    busy.current = true;
    void work().then(() => { if (retryKey) delete retries.current[retryKey]; }).catch(async () => {
      const used = retryKey ? retries.current[retryKey] ?? 0 : Infinity;
      if (used < 2 && retryKey) {
        retries.current[retryKey] = used + 1;
        await wait(1500);
        const fresh = await loadAgentTask(taskId).catch(() => null);
        if (fresh && mounted.current) { docRef.current = fresh; setDoc(fresh); }
        return;
      }
      if (failure && mounted.current) setNotice(failure);
    }).finally(() => { busy.current = false; if (mounted.current) setTick((value) => value + 1); });
  }, [taskId]);

  const commit = useCallback(async (change: (task: AgentTask) => AgentTask, extra?: { title?: string; objects?: unknown[] }) => {
    const current = docRef.current;
    if (!current) throw new Error('agent_task_missing');
    const next = await updateAgentTask(current, change, extra);
    docRef.current = next;
    if (mounted.current) setDoc(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    setStatus('loading'); setDoc(null); docRef.current = null; setSelected(null); setImageUrl(null);
    void loadAgentTask(taskId).then((loaded) => {
      if (!active) return;
      docRef.current = loaded; setDoc(loaded); setStatus(loaded ? 'ready' : 'missing');
    }).catch(() => { if (active) setStatus('missing'); });
    return () => { active = false; };
  }, [taskId, brandId]);

  /** Reads an assistant request until it settles; returns the final step (never re-sends). */
  const pollAssistant = useCallback(async (step: AgentAssistantStep, conversationId: string): Promise<AgentAssistantStep> => {
    for (let attempt = 0; attempt < 100 && mounted.current; attempt += 1) {
      const receipt = await api().readDesignAssistantRequest({ requestId: step.requestId, brandId: brandId!, projectId: taskId, conversationId });
      if (receipt.state !== 'running') return assistantStepFrom(receipt, step.requestId);
      await wait(3000);
    }
    return step;
  }, [brandId, taskId]);

  const conversationFor = useCallback((kind: AssistantKind, step: AgentAssistantStep) => agentConversationId(taskId,
    kind === 'theme' ? `theme-${step.requestId.slice(0, 8)}` : kind === 'note' ? `note-${step.requestId.slice(0, 8)}` : kind), [taskId]);

  const runAssistant = useCallback(async (kind: AssistantKind, step: AgentAssistantStep, prompt: string | null, apply: (task: AgentTask, step: AgentAssistantStep) => AgentTask, mode?: AssistantMode) => {
    if (inFlight.current.has(step.requestId) || !brandId) return;
    inFlight.current.add(step.requestId);
    const conversationId = conversationFor(kind, step);
    try {
      let result = step;
      if (prompt) {
        const receipt = await api().sendDesignAssistantRequest({ requestId: step.requestId, brandId, projectId: taskId, conversationId, prompt, history: [], references: [], ...(mode ? { mode } : {}) });
        result = assistantStepFrom(receipt, step.requestId);
      }
      if (result.state === 'running') result = await pollAssistant(result, conversationId);
      if (result.state !== 'running') await commit((task) => apply(task, result));
    } catch {
      // The request may still have reached the server; reading it back on the next visit decides, it is not re-sent.
      if (mounted.current) setNotice('通信が中断されました。再読み込みすると続きを確認します。');
      // The advance effect resumes a running step at once; pause so a dropped connection is not read back in a tight loop.
      await wait(5000);
    } finally { inFlight.current.delete(step.requestId); }
  }, [brandId, commit, conversationFor, pollAssistant, taskId]);

  const textMode = (task: AgentTask): AssistantMode => (task.flow === 'conversation' ? 'agent' : undefined);
  /** Light's テーマ企画 searches the web for its themes; its theme request runs as research. */
  const themeMode = (task: AgentTask): AssistantMode => (agentThemeSearches(task) ? 'agent-research' : textMode(task));
  const applyRound = (requestId: string) => (task: AgentTask, result: AgentAssistantStep): AgentTask => ({ ...task, rounds: task.rounds.map((round) => round.step.requestId !== requestId ? round
    : { ...round, step: result, ...(result.state === 'completed' && result.content ? parseThemeResponse(result.content) : { summary: '', themes: [] }) }) });
  const applyNote = (noteId: string) => (task: AgentTask, result: AgentAssistantStep): AgentTask => ({ ...task, notes: (task.notes ?? []).map((note) => note.id === noteId ? { ...note, reply: result } : note) });

  const startRequirements = useCallback(async () => {
    const step: AgentAssistantStep = { requestId: crypto.randomUUID(), state: 'running' };
    const saved = await commit((task) => ({ ...task, requirements: step }));
    await runAssistant('requirements', step, agentRequirementsPrompt(saved.task), (task, result) => ({ ...task, requirements: result }), 'agent');
  }, [commit, runAssistant]);

  const startResearch = useCallback(async () => {
    const step: AgentAssistantStep = { requestId: crypto.randomUUID(), state: 'running' };
    const saved = await commit((task) => ({ ...task, research: step }));
    await runAssistant('research', step, agentResearchPrompt(saved.task), (task, result) => ({ ...task, research: result }), 'agent-research');
  }, [commit, runAssistant]);

  const startThemeRound = useCallback(async () => {
    const requestId = crypto.randomUUID();
    const step: AgentAssistantStep = { requestId, state: 'running' };
    const saved = await commit((task) => ({ ...task, rounds: [...task.rounds, { step, summary: '', themes: [], at: new Date().toISOString() }] }));
    const prompt = themePrompt({ ...saved.task, rounds: saved.task.rounds.slice(0, -1) });
    await runAssistant('theme', step, prompt, applyRound(requestId), themeMode(saved.task));
  }, [commit, runAssistant]);

  const startPlan = useCallback(async (theme: string) => {
    const requestId = crypto.randomUUID();
    const step: AgentAssistantStep = { requestId, state: 'running' };
    const saved = await commit((task) => ({ ...task, plan: step }));
    await runAssistant('plan', step, planPrompt(saved.task, theme), (task, result) => ({ ...task, plan: result }), textMode(saved.task));
  }, [commit, runAssistant]);

  const finishImage = useCallback(async (step: AgentImageStep, receipt: Record<string, unknown>) => {
    const parsed = readImageReceipt(receipt);
    if (parsed.state === 'completed' && parsed.storagePath) {
      const current = docRef.current!;
      const objects = [{ id: `agent-image-${step.requestId}`, type: 'image', src: parsed.storagePath, label: '企画ビジュアル', x: 80, y: 80, width: 440, height: 440,
        rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, visible: true, zIndex: 1,
        metadata: { feature: 'heavy-agent-visual', prompt: step.prompt, imageId: parsed.imageId, storagePath: parsed.storagePath, jobId: parsed.jobId, persistenceStatus: 'completed' } }];
      await commit((task) => ({ ...task, image: { ...step, state: 'completed', storagePath: parsed.storagePath, imageId: parsed.imageId, jobId: parsed.jobId } }),
        { objects: [...(Array.isArray(current.snapshot.objects) ? current.snapshot.objects.filter((object) => !(record(object) && object.id === `agent-image-${step.requestId}`)) : []), ...objects] });
      await api().acknowledgeImageAction(receipt).catch(() => undefined);
    } else if (parsed.state === 'failed') {
      await commit((task) => ({ ...task, image: { ...step, state: 'failed', errorCode: parsed.errorCode ?? 'image_failed' } }));
    }
  }, [commit]);

  const startImage = useCallback(async (prompt: string) => {
    if (!brandId) return;
    const auth = useAuthStore.getState();
    const ready = Boolean(auth.user?.id && auth.currentBrand?.id === brandId && (!isHeavyWorkspaceRuntime() || isHeavyWorkspaceBrandName(auth.currentBrand.name)));
    const step: AgentImageStep = { requestId: crypto.randomUUID(), state: 'running', prompt: agentImagePrompt(prompt) };
    await commit((task) => ({ ...task, image: step }));
    inFlight.current.add(step.requestId);
    try {
      const receipt = await generateImage(step.prompt, brandId, { rightsConfirmed: ready, idempotencyKey: step.requestId, retainUntilAcknowledged: true,
        featureType: 'lightchain-design-agent', generationProvider: HEAVY_IMAGE_PROVIDER,
        assertContext: () => { if (useAuthStore.getState().currentBrand?.id !== brandId) throw new Error('agent_context_changed'); } });
      await finishImage(step, { ...receipt, state: receipt.success === false ? 'failed' : (receipt as { state?: string }).state ?? 'completed' } as Record<string, unknown>);
    } catch {
      if (mounted.current) setNotice('画像の生成結果を確認できませんでした。再読み込みすると結果を確認します。');
    } finally { inFlight.current.delete(step.requestId); }
  }, [brandId, commit, finishImage]);

  const reconcileImage = useCallback(async (step: AgentImageStep) => {
    if (inFlight.current.has(step.requestId)) return;
    inFlight.current.add(step.requestId);
    try {
      for (let attempt = 0; attempt < 60 && mounted.current; attempt += 1) {
        const receipt = await api().readImageAIRequest(step.requestId);
        const parsed = readImageReceipt(receipt);
        if (parsed.state === 'completed' || parsed.state === 'failed') { await finishImage(step, receipt); return; }
        await wait(4000);
      }
    } catch { /* unknown stays visible as running; nothing is re-sent */ }
    finally { inFlight.current.delete(step.requestId); }
  }, [finishImage]);

  // Advance the task to its next step (or resume the step in flight) whenever it changes.
  useEffect(() => {
    if (!doc || !brandId || status !== 'ready' || busy.current) return;
    const task = doc.task;
    const pendingNote = (task.notes ?? []).find((note) => note.reply.state === 'running');
    if (pendingNote) { guard(() => runAssistant('note', pendingNote.reply, null, applyNote(pendingNote.id), textMode(task))); return; }
    if (task.flow === 'conversation') {
      const requirements = task.requirements;
      if (!requirements) { guard(startRequirements, 'タスクを開始できませんでした。', 'start'); return; }
      if (requirements.state === 'running') { guard(() => runAssistant('requirements', requirements, null, (current, result) => ({ ...current, requirements: result }), 'agent')); return; }
      if (requirements.state !== 'completed' || !task.aligned || !task.scope) return;
      if (!task.research) { guard(startResearch, '調査を開始できませんでした。', 'research'); return; }
      if (task.research.state === 'running') { const step = task.research; guard(() => runAssistant('research', step, null, (current, result) => ({ ...current, research: result }), 'agent-research')); return; }
      if (task.research.state !== 'completed') return;
    }
    const lastRound = task.rounds[task.rounds.length - 1];
    if (!lastRound) { guard(startThemeRound, 'タスクを開始できませんでした。', 'start'); return; }
    if (lastRound.step.state === 'running') { guard(() => runAssistant('theme', lastRound.step, null, applyRound(lastRound.step.requestId), themeMode(task))); return; }
    // Light's 「修正・補足する」: a note written after the directions asks for revised ones.
    if (!task.choice && task.flow === 'conversation' && lastRound.at && (task.notes ?? []).some((note) => note.stage === 'themes' && note.reply.state === 'completed' && note.at > lastRound.at!)) {
      guard(startThemeRound, '方向性の出し直しを開始できませんでした。'); return;
    }
    if (!task.choice) return;
    if (!task.plan) { const theme = task.choice.theme; guard(() => startPlan(theme), '企画書の作成を開始できませんでした。', 'plan'); return; }
    if (task.plan.state === 'running') { const step = task.plan; guard(() => runAssistant('plan', step, null, (current, result) => ({ ...current, plan: result }), textMode(task))); return; }
    if (task.plan.state !== 'completed' || !task.plan.content) return;
    const parsed = parsePlanResponse(task.plan.content);
    if (parsed.title && doc.title !== parsed.title && isAutomaticAgentTaskTitle(doc.title, task)) { const title = parsed.title; guard(() => commit((current) => current, { title })); return; }
    if (!task.image) { const theme = task.choice.theme; guard(() => startImage(parsed.imagePrompt ?? `Apparel planning mood board for a womenswear collection, ${theme}, fabric swatches, color palette, editorial photo`)); return; }
    if (task.image.state === 'running') { const step = task.image; guard(() => reconcileImage(step)); }
  }, [doc, brandId, status, tick, guard, startRequirements, startResearch, startThemeRound, startPlan, startImage, reconcileImage, runAssistant, commit]);

  useEffect(() => {
    const path = doc?.task.image?.state === 'completed' ? doc.task.image.storagePath : null;
    if (!path) { setImageUrl(null); return; }
    let active = true;
    void resolveGeneratedImageUrlWithStatus(path).then((resolved) => { if (active && resolved.ok) setImageUrl(resolved.url); });
    return () => { active = false; };
  }, [doc?.task.image?.state, doc?.task.image?.storagePath]);

  const submitChoice = () => {
    if (!selected || !doc) return;
    setNotice(null);
    const theme = selected;
    setSelected(null);
    if (theme === NONE) { guard(startThemeRound, '新しいテーマを依頼できませんでした。'); return; }
    guard(() => commit((task) => ({ ...task, choice: { theme, at: new Date().toISOString() } })), '選択を保存できませんでした。');
  };
  const retryThemes = async () => { setNotice(null); guard(startThemeRound, '再試行できませんでした。'); };
  const retryPlan = async () => { if (!doc?.task.choice) return; setNotice(null); guard(() => commit((task) => ({ ...task, plan: null, image: null }))); };
  const retryImage = async () => { setNotice(null); guard(() => commit((task) => ({ ...task, image: null }))); };
  const retryRequirements = () => { setNotice(null); guard(() => commit((task) => ({ ...task, requirements: null }))); };
  const retryResearch = () => { setNotice(null); guard(() => commit((task) => ({ ...task, research: null }))); };
  const continueAligned = () => { setNotice(null); guard(() => commit((task) => ({ ...task, aligned: { at: new Date().toISOString() } })), '保存できませんでした。'); };
  const confirmScope = (scope: ScopeDraft) => {
    setNotice(null);
    guard(() => commit((task) => ({ ...task, scope: { regions: scope.regions, ec: scope.ec, sns: scope.sns, other: scope.other.trim(), at: new Date().toISOString() } })), '調査範囲を保存できませんでした。');
  };

  const task = doc?.task ?? null;
  const conversation = task?.flow === 'conversation';
  const noteStage = (current: AgentTask): AgentNoteStage => (current.flow === 'conversation' && !current.aligned ? 'requirements'
    : current.flow === 'conversation' && !current.scope ? 'scope'
      : current.flow === 'conversation' && current.research?.state !== 'completed' ? 'research'
        : !current.choice ? 'themes' : 'plan');
  const sendNote = () => {
    const value = draft.trim();
    if (!value || !doc) return;
    // guard() skips work while another step is starting; keep the text instead of dropping it.
    if (busy.current) { setNotice('ほかの処理が終わってから送信してください。'); return; }
    setDraft(''); setNotice(null);
    guard(async () => {
      const requestId = crypto.randomUUID();
      const note: AgentNote = { id: requestId, text: value.slice(0, 1200), at: new Date().toISOString(), stage: noteStage(docRef.current!.task), reply: { requestId, state: 'running' } };
      const saved = await commit((current) => ({ ...current, notes: [...(current.notes ?? []), note] }));
      const prompt = agentNotePrompt({ ...saved.task, notes: (saved.task.notes ?? []).filter((entry) => entry.id !== note.id) }, note);
      await runAssistant('note', note.reply, prompt, applyNote(note.id), textMode(saved.task));
    }, '送信できませんでした。');
  };

  const plan = task?.plan?.state === 'completed' && task.plan.content ? parsePlanResponse(task.plan.content) : null;
  const done = Boolean(task?.image?.state === 'completed');
  const stepFailed = (state?: string) => state === 'failed' || state === 'unknown';
  const notes = task?.notes ?? [];
  const working = Boolean(task && (task.requirements?.state === 'running' || task.research?.state === 'running' || task.plan?.state === 'running'
    || task.image?.state === 'running' || task.rounds.at(-1)?.step.state === 'running' || notes.some((note) => note.reply.state === 'running')));
  const waitingOnUser = Boolean(conversation && task?.requirements?.state === 'completed' && (!task.aligned || !task.scope));
  const statusLabel = !task ? '' : done ? '完了'
    : stepFailed(task.plan?.state) || stepFailed(task.image?.state) || stepFailed(task.research?.state) || stepFailed(task.requirements?.state) ? '失敗'
      : task.choice ? '作成中' : task.rounds.at(-1)?.step.state === 'completed' || waitingOnUser ? '確認待ち' : '調査中';
  const research = task?.research?.state === 'completed' && task.research.content ? parseAgentResearch(task.research.content) : null;
  const roundSources = task && !conversation ? agentRoundSources(task) : null;
  const sourceList = research ?? roundSources;
  const intakeSteps = task ? AGENT_INTAKE_STEPS.map((label, index) => {
    const finished = [task.requirements?.state === 'completed', Boolean(task.aligned), Boolean(task.scope)];
    const status = finished[index] ? '完了' as const : finished.findIndex((value) => !value) === index ? '進行中' as const : '待機中' as const;
    return { label, status };
  }) : [];

  const researchSteps = task?.scope ? agentResearchSteps(task.scope).map((label, index) => {
    const finished = [task.research?.state === 'completed', task.research?.state === 'completed', Boolean(task.choice)];
    return { label, status: finished[index] ? '完了' as const : finished.findIndex((value) => !value) === index ? '進行中' as const : '待機中' as const };
  }) : [];
  const confirmDirections = (themes: string[]) => {
    setNotice(null);
    guard(() => commit((current) => ({ ...current, choice: { theme: themes.map((theme) => parseAgentDirection(theme).name).join(' / '), themes, at: new Date().toISOString() } })), '選択を保存できませんでした。');
  };

  return (
    <main className="dark flex h-[calc(100vh-50px)] min-h-full bg-[#171b1c] text-white" data-testid="agent-task-page"
      data-agent-task={doc?.id ?? ''} data-agent-status={statusLabel} data-agent-plan={task?.plan?.requestId ?? ''} data-agent-image={task?.image?.jobId ?? ''}>
      <AgentSidebar title={task?.subtype ?? 'インスピレーションワークスペース'} activeTaskId={doc?.id ?? taskId} refreshKey={`${doc?.id}:${doc?.title}`} onNewTask={() => navigate('/agent')} />
      <section className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-[752px] flex-1 px-4 py-10">
          {status === 'loading' && <StepSpinner label="タスクを読み込んでいます…" />}
          {status === 'missing' && <div role="alert" className="rounded-xl border border-white/10 bg-[#202426] p-6 text-sm text-neutral-300">このタスクは見つかりません。<button type="button" onClick={() => navigate('/agent')} className="ml-2 text-cyan-300 underline">新規タスクへ</button></div>}
          {task && (
            <div className="space-y-8 text-sm leading-6 text-neutral-200">
              <UserBubble testId="agent-task-prompt">{task.prompt}</UserBubble>
              {conversation && (
                <>
                  <StepList items={intakeSteps} testId="agent-intake-steps" />
                  {task.requirements?.state === 'running' && <StepSpinner label="要件を整理しています…" />}
                  {stepFailed(task.requirements?.state) && <ErrorRow onRetry={retryRequirements}>要件の整理に失敗しました（{task.requirements?.errorCode ?? task.requirements?.state}）。</ErrorRow>}
                  {task.requirements?.state === 'completed' && task.requirements.content && <RequirementsView content={task.requirements.content} />}
                  <Notes notes={notes} stage="requirements" />
                  {task.requirements?.state === 'completed' && !task.aligned && (
                    <div className="flex flex-wrap justify-end gap-2" data-testid="agent-align-actions">
                      <button type="button" onClick={() => composerRef.current?.focus()} className="h-10 rounded-full border border-white/15 px-4 text-sm text-neutral-200 hover:bg-white/10">条件を補足する</button>
                      <button type="button" disabled={working} onClick={continueAligned} className="h-10 rounded-full bg-[#0bcabc] px-4 text-sm font-medium text-neutral-950 hover:bg-[#2ad6c9] disabled:opacity-50">問題ありません、続行</button>
                    </div>
                  )}
                  {task.aligned && <UserBubble>問題ありません、続行</UserBubble>}
                  {task.aligned && <ScopeForm confirmed={task.scope ?? null} disabled={working} onConfirm={confirmScope} />}
                  {task.scope && <UserBubble testId="agent-scope-summary">{agentScopeSummary(task.scope)}</UserBubble>}
                  <Notes notes={notes} stage="scope" />
                  {task.scope && <StepList testId="agent-research-steps" items={researchSteps} />}
                  {task.research?.state === 'running' && <StepSpinner label="考え中…（ウェブ検索で資料を集めています。1〜3分かかります）" />}
                  {stepFailed(task.research?.state) && <ErrorRow onRetry={retryResearch}>調査に失敗しました（{task.research?.errorCode ?? task.research?.state}）。</ErrorRow>}
                  {task.research?.state === 'completed' && task.research.content && (
                    <>
                      <p>調査が完了しました。続いて調査結果をHTMLレポートに整理して表示します。</p>
                      <ReportCard task={task} />
                    </>
                  )}
                  <Notes notes={notes} stage="research" />
                </>
              )}
              {/* The first round only appears once the request is admitted; show progress before that too. */}
              {(!conversation || task.research?.state === 'completed') && task.rounds.length === 0 && !done && !notice && <StepSpinner label="市場とトレンドを整理し、テーマを考えています…" />}
              {task.rounds.map((round, index) => {
                const last = index === task.rounds.length - 1;
                const confirmed = !last || Boolean(task.choice);
                return (
                  <article key={round.step.requestId} className="space-y-4" data-testid="agent-theme-round">
                    {round.step.state === 'running' && <StepSpinner label={agentThemeSearches(task) ? '市場とトレンドを調べ、テーマを考えています…（ウェブ検索で資料を集めています。1〜3分かかります）' : '市場とトレンドを整理し、テーマを考えています…'} />}
                    {(round.step.state === 'failed' || round.step.state === 'unknown') && (
                      <ErrorRow onRetry={last && !task.choice ? () => void retryThemes() : undefined}>テーマの提案に失敗しました（{round.step.errorCode ?? round.step.state}）。</ErrorRow>
                    )}
                    {round.summary && <div className="whitespace-pre-wrap" data-testid="agent-summary">{round.summary}</div>}
                    {round.step.state === 'completed' && round.themes.length > 0 && conversation && (
                      <DirectionPicker themes={round.themes} chosen={confirmed ? (last ? task.choice?.themes ?? [task.choice?.theme ?? ''] : []) : null} disabled={working}
                        onRevise={() => composerRef.current?.focus()} onConfirm={confirmDirections} />
                    )}
                    {round.step.state === 'completed' && round.themes.length > 0 && !conversation && (
                      <>
                        <p className="text-sm text-neutral-300">次のテーマから一つ選んでください。あるいは、「どれも気に入らない」を選択して、新しいテーマを提案させることも可能です。</p>
                        <div className="rounded-2xl border border-white/10 bg-[#202426] p-4" data-testid="agent-design-request">
                          <div className="mb-3 flex items-center justify-between">
                            <span className="flex items-center gap-2 text-base font-medium text-white"><Box className="h-5 w-5 text-cyan-300" />デザイン依頼</span>
                            <span className={`rounded-md border px-2 py-0.5 text-xs ${confirmed ? 'border-emerald-400/60 text-emerald-300' : 'border-amber-400/70 text-amber-300'}`}>{confirmed ? '確認済み' : '確認待ち'}</span>
                          </div>
                          <div role="radiogroup" aria-label="デザインテーマ" className="space-y-2">
                            {[...round.themes, NONE].map((theme) => {
                              const chosen = confirmed ? (last ? task.choice?.theme === theme : theme === NONE) : selected === theme;
                              return (
                                <button key={theme} type="button" role="radio" aria-checked={chosen} disabled={confirmed} onClick={() => setSelected(theme)}
                                  className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${chosen ? 'border-cyan-300/70 bg-cyan-300/10 text-white' : 'border-white/10 text-neutral-200 hover:bg-white/5'} disabled:cursor-default`}>
                                  <span>{theme}</span>
                                  <span aria-hidden="true" className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border ${chosen ? 'border-cyan-300 bg-cyan-300 text-neutral-900' : 'border-white/40'}`}>{chosen && <Check className="h-3 w-3" />}</span>
                                </button>
                              );
                            })}
                          </div>
                          {!confirmed && <div className="mt-3 flex justify-end"><button type="button" disabled={!selected} onClick={submitChoice} className="h-8 rounded-lg bg-cyan-300 px-4 text-sm font-medium text-neutral-950 disabled:cursor-not-allowed disabled:bg-[#687174] disabled:text-neutral-400">送信</button></div>}
                        </div>
                      </>
                    )}
                    {round.step.state === 'completed' && round.themes.length === 0 && round.step.content && <div className="whitespace-pre-wrap">{round.step.content}</div>}
                  </article>
                );
              })}
              <Notes notes={notes} stage="themes" />
              {task.choice && <p className="rounded-xl bg-white/5 px-4 py-3 text-sm text-neutral-300" data-testid="agent-choice">選択したテーマ：<span className="font-medium text-white">{task.choice.theme}</span></p>}
              {task.plan?.state === 'running' && <StepSpinner label="企画書を作成しています…" />}
              {(task.plan?.state === 'failed' || task.plan?.state === 'unknown') && <ErrorRow onRetry={() => void retryPlan()}>企画書の作成に失敗しました。</ErrorRow>}
              {plan && (
                <article className="space-y-5 rounded-2xl border border-white/10 bg-[#202426] p-6" data-testid="agent-plan">
                  <h2 className="text-lg font-semibold text-white">{plan.title ?? doc?.title}</h2>
                  {plan.sections.map((section) => (
                    <section key={section.heading}>
                      <h3 className="mb-1 text-sm font-semibold text-cyan-200">{section.heading}</h3>
                      <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-neutral-200">{section.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
                    </section>
                  ))}
                </article>
              )}
              {task.image?.state === 'running' && <StepSpinner label="企画ビジュアルを生成しています…" />}
              {task.image?.state === 'failed' && <ErrorRow onRetry={() => void retryImage()}>企画ビジュアルの生成に失敗しました。</ErrorRow>}
              {task.image?.state === 'completed' && (
                <figure className="overflow-hidden rounded-2xl border border-white/10 bg-[#202426]" data-testid="agent-visual">
                  {imageUrl ? <img src={imageUrl} alt="企画ビジュアル" className="w-full object-contain" /> : <div className="h-64 animate-pulse bg-white/5" />}
                  <figcaption className="px-4 py-2 text-xs text-neutral-400">企画ビジュアル</figcaption>
                </figure>
              )}
              <Notes notes={notes} stage="plan" />
              {notice && <p role="alert" className="text-sm text-amber-300">{notice}</p>}
            </div>
          )}
        </div>
        {task && (
          // Light's input under the conversation: extra conditions or questions at any step; disabled while a step runs.
          <form className="sticky bottom-0 mx-auto w-full max-w-[752px] bg-gradient-to-t from-[#171b1c] via-[#171b1c] to-transparent px-4 pb-4 pt-6" data-testid="agent-followup-composer"
            onSubmit={(event) => { event.preventDefault(); sendNote(); }}>
            <div className="rounded-2xl border border-white/10 bg-[#262a2b] px-4 pb-3 pt-3 focus-within:border-cyan-300/50">
              <textarea ref={composerRef} value={draft} disabled={working} onChange={(event) => setDraft(event.target.value)} rows={2}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendNote(); } }}
                placeholder="条件を追加、または続けて質問…" aria-label="条件を追加、または続けて質問…"
                className="block w-full resize-none bg-transparent text-sm leading-6 text-white outline-none placeholder:text-neutral-500 disabled:cursor-not-allowed" />
              <div className="mt-2 flex items-center justify-end gap-3">
                <span className="text-xs text-neutral-500">Enterで送信・Shift+Enterで改行</span>
                <button type="submit" aria-label="送信" disabled={working || !draft.trim()} className="flex size-10 items-center justify-center rounded-full bg-[#0bcabc] text-neutral-950 disabled:bg-[#2c5e5b] disabled:text-neutral-400">
                  {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </form>
        )}
      </section>
      {task && (panelOpen ? (
        // Light floats 概要 as a rounded card 12px from the window edges, like the sidebar on the left.
        <aside aria-label="概要" className="hidden w-[337px] shrink-0 p-3 lg:block" data-testid="agent-summary-panel">
          <div className="relative h-full overflow-y-auto rounded-2xl border border-white/10 bg-[#262a2b] p-4 text-sm text-neutral-300">
          <button type="button" aria-label="概要を閉じる" onClick={() => setPanelOpen(false)} className="absolute right-3 top-3 rounded-md p-1.5 text-neutral-400 hover:bg-white/10"><PanelRightClose className="h-4 w-4" /></button>
          <h2 className="text-base font-medium text-white">概要</h2>
          <dl className="mt-4 space-y-3">
            <div><dt className="text-xs text-neutral-500">業務シーン</dt><dd>{task.subtype && task.subtype !== task.scene ? `${task.scene}（${task.subtype}）` : task.scene}</dd></div>
            <div><dt className="text-xs text-neutral-500">ステータス</dt><dd>{statusLabel}</dd></div>
            {task.scope && <div><dt className="text-xs text-neutral-500">調査範囲</dt><dd>{agentScopeSummary(task.scope)}</dd></div>}
            {task.choice && <div><dt className="text-xs text-neutral-500">テーマ</dt><dd>{task.choice.theme}</dd></div>}
            <div><dt className="text-xs text-neutral-500">作成日</dt><dd>{new Date(task.createdAt).toLocaleString('ja-JP')}</dd></div>
            {task.profile && <div><dt className="text-xs text-neutral-500">業務プリファレンス</dt><dd className="whitespace-pre-wrap">{task.profile}</dd></div>}
          </dl>
          {research && (
            <>
              <h2 className="mt-6 text-base font-medium text-white">タスク成果物</h2>
              <button type="button" onClick={() => openReport(task, false)} className="mt-2 flex w-full items-center gap-2 text-left text-xs text-neutral-200 hover:text-white" data-testid="agent-task-deliverable">
                <Paperclip className="h-3.5 w-3.5 flex-none" /><span className="truncate">{REPORT_TITLE}.html</span>
              </button>
            </>
          )}
          <h2 className="mt-6 text-base font-medium text-white">参考資料</h2>
          {!conversation && !roundSources && <p className="mt-2 text-xs leading-5 text-neutral-500">{agentThemeSearches(task) ? 'テーマができると、ウェブ検索で参照した資料がここに表示されます。' : 'Heavy Chainはウェブ検索を行いません。概要とテーマはAIモデルの知識に基づいて作成しています。'}</p>}
          {conversation && !research && <p className="mt-2 text-xs leading-5 text-neutral-500">調査が終わると、ウェブ検索で参照した資料がここに表示されます。</p>}
          {sourceList && sourceList.sources.length > 0 && (
            <ol className="mt-2 space-y-2" data-testid="agent-research-sources">
              {sourceList.sources.map((source, index) => (
                <li key={source.url} className="text-xs leading-5">
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">{index + 1}. {source.title}</a>
                  <span className="block text-neutral-500">{hostOf(source.url)}</span>
                </li>
              ))}
            </ol>
          )}
          {sourceList && sourceList.sources.length === 0 && (
            <p className="mt-2 text-xs leading-5 text-neutral-500">{sourceList.search === 'ok' ? '参照した資料はありません。' : 'ウェブ検索を使えませんでした。調査結果とテーマはAIモデルの知識に基づいて作成しています。'}</p>
          )}
          </div>
        </aside>
      ) : (
        <button type="button" aria-label="概要を開く" onClick={() => setPanelOpen(true)} className="absolute right-3 top-[62px] hidden rounded-md p-1.5 text-neutral-400 hover:bg-white/10 lg:block"><PanelRightOpen className="h-4 w-4" /></button>
      ))}
    </main>
  );
}
