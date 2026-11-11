import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowUp, Box, Check, ChevronRight, Code2, Download, Loader2, Paperclip, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { generateImage } from '../lib/imageApi';
import { HEAVY_IMAGE_PROVIDER } from '../lib/heavyImageProvider';
import { resolveGeneratedImageUrlWithStatus } from '../lib/storage';
import { isHeavyWorkspaceBrandName, isHeavyWorkspaceRuntime } from '../lib/heavyWorkspace';
import { useAuthStore } from '../stores/authStore';
import { AgentSidebar } from '../features/agent/AgentSidebar';
import { AgentAttachMenu, AgentAttachmentChips } from '../features/agent/AgentAttachMenu';
import { ErrorRow, GeneratedTile, StepList, StepSpinner, UserBubble } from '../features/agent/AgentParts';
import { AgentDialogueView } from '../features/agent/AgentDialogueView';
import type { AssistantQuestion } from '../features/designDetail/assistantQuestions';
import {
  AGENT_SCOPE_REGIONS, DEFAULT_AGENT_SCOPE, agentConversationId, agentImagePrompt, agentMissingNames, agentNotePrompt,
  agentRequestRejection, agentRequirementsPrompt, agentResearchPrompt, agentRoundSources, agentScopeOptions, agentScopeSummary, agentThemeSearches, assistantStepFrom, buildAgentResearchReportHtml, isAutomaticAgentTaskTitle, parseAgentDirection,
  loadAgentTask, parseAgentRequirements, parseAgentResearch, parsePlanResponse, parseThemeResponse, planPrompt, pruneAgentScope, themePrompt, updateAgentTask,
  agentBuildDesignImages, agentBuildDirectionImages, agentChosenCodes, agentDesignPrompt, agentDesignProgress, agentFinalPrompt, agentImageLabel, agentReferenceImages,
  agentBuildDialogueImages, agentDialogueAspect, agentDialogueHistory, agentDialogueImagePrompt, agentDialogueIsStart, agentDialogueMode, agentDialoguePlan, agentDialoguePrompt, agentDialogueSources,
  parseAgentDialogueReply, AGENT_DIALOGUE_TURN_LIMIT, type AgentTurn,
  agentStructurePrompt, agentStyleImagePrompt, agentUsesMerchFlow, agentWording, buildAgentDesignHtml, buildAgentFinalHtml, buildAgentStructureHtml, parseAgentFinal, parseAgentStructure, AGENT_STYLE_COUNT,
  type AgentAssistantStep, type AgentAttachment, type AgentImageStep, type AgentNote, type AgentNoteStage, type AgentResearchScope, type AgentStyleImage, type AgentTask, type AgentTaskDocument,
} from '../features/agent/agentTasks';

const NONE = 'どれも気に入らない';
const api = () => { if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured'); return cloudflareDataPlane; };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
type AssistantKind = 'theme' | 'plan' | 'requirements' | 'research' | 'note' | 'structure' | 'design' | 'final' | 'dialogue';
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
function ScopeForm({ confirmed, disabled, regionTitle, onConfirm }: { confirmed: AgentResearchScope | null; disabled: boolean; regionTitle: string; onConfirm: (scope: ScopeDraft) => void }) {
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
      <ScopeField title={regionTitle} options={AGENT_SCOPE_REGIONS} selected={value.regions} editable={editable} onToggle={toggle('regions')} />
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

type ReportDoc = { title: string; html: string };
/** Light's ダウンロード saves the report as an HTML file named after it. */
function downloadReport(report: ReportDoc) {
  const url = URL.createObjectURL(new Blob([report.html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${report.title.replace(/[\\/:*?"<>|]/g, '_')}.html`; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Light's 「オンラインで表示」 opens the report in a window over the page (the HTML in a sandboxed frame), not in a new tab. */
function ReportModal({ report, onClose }: { report: ReportDoc; onClose: () => void }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={report.title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" data-testid="agent-report-viewer"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex h-[88vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#202426] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <span aria-hidden="true" className="flex size-7 flex-none items-center justify-center rounded-lg bg-[#f2683c] text-white"><Code2 className="h-4 w-4" /></span>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{report.title}</p>
          <button type="button" onClick={() => downloadReport(report)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-cyan-300 hover:bg-white/10"><Download className="h-4 w-4" />ダウンロード</button>
          <button type="button" aria-label="閉じる" onClick={onClose} className="rounded-lg p-1.5 text-neutral-300 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="relative flex-1 bg-white">
          <iframe title={report.title} srcDoc={report.html} sandbox="allow-popups allow-popups-to-escape-sandbox" className="absolute inset-0 h-full w-full border-0" />
        </div>
      </div>
    </div>
  );
}

function ReportCard({ title, note, testId, noteTestId, onOpen, onDownload }: { title: string; note: string; testId: string; noteTestId?: string; onOpen: () => void; onDownload: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#202426] px-4 py-3" data-testid={testId}>
      <span aria-hidden="true" className="flex size-8 flex-none items-center justify-center rounded-lg bg-[#f2683c] text-white"><Code2 className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{title}</p>
        {note && <p className="truncate text-xs text-neutral-400" data-testid={noteTestId}>{note}</p>}
      </div>
      <button type="button" onClick={onOpen} className="flex-none text-sm text-cyan-300 hover:underline">オンラインで表示</button>
      <button type="button" onClick={onDownload} className="flex-none text-sm text-cyan-300 hover:underline">ダウンロード</button>
    </div>
  );
}

/** An image the task generates: a skeleton while it is made, the picture when done, a retry when it failed. */
/** Light's 「最終の…に使用するスタイル画像を選択」: four to a row, the code and name over the bottom, the check at the top left. */
function StylePicker({ images, urls, chosen, disabled, title, hint, button, onConfirm }: {
  images: AgentStyleImage[]; urls: Record<string, string>; chosen: string[] | null; disabled: boolean; title: string; hint: string; button: string; onConfirm: (keys: string[]) => void;
}) {
  const ready = images.filter((image) => image.state === 'completed');
  const [picked, setPicked] = useState<string[]>([]);
  const value = chosen ?? picked;
  const editable = !chosen && !disabled;
  const all = ready.length > 0 && ready.every((image) => value.includes(image.key));
  return (
    <section aria-label={title} className="space-y-3 rounded-2xl border border-white/10 bg-[#202426] p-5" data-testid="agent-style-picker">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-base font-medium text-white"><Box className="h-5 w-5 text-cyan-300" />{title}</span>
        <span className={`flex-none rounded-md border px-2 py-0.5 text-xs ${chosen ? 'border-emerald-400/60 text-emerald-300' : 'border-amber-400/70 text-amber-300'}`}>{chosen ? '確認済み' : '確認待ち'}</span>
      </div>
      <p className="text-xs text-neutral-400">{hint}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ready.map((image) => {
          const on = value.includes(image.key);
          return (
            <button key={image.key} type="button" role="checkbox" aria-checked={on} aria-label={agentImageLabel(image)} disabled={!editable}
              onClick={() => setPicked((current) => current.includes(image.key) ? current.filter((key) => key !== image.key) : [...current, image.key])}
              className={`relative aspect-[3/4] overflow-hidden rounded-lg border-2 text-left ${on ? 'border-[#0bcabc]' : 'border-transparent'} disabled:cursor-default`}>
              {urls[image.requestId] ? <img src={urls[image.requestId]} alt="" className="h-full w-full object-cover" /> : <span className="block h-full w-full animate-pulse bg-white/10" />}
              <span aria-hidden="true" className={`absolute left-2 top-2 flex size-[18px] items-center justify-center rounded-full border ${on ? 'border-[#0bcabc] bg-[#0bcabc] text-neutral-900' : 'border-white/70 bg-black/20'}`}>{on && <Check className="h-3 w-3" />}</span>
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-5 text-xs text-white">{agentImageLabel(image)}</span>
            </button>
          );
        })}
      </div>
      {!chosen && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" role="checkbox" aria-checked={all} disabled={!editable} onClick={() => setPicked(all ? [] : ready.map((image) => image.key))}
            className="flex items-center gap-1.5 text-sm text-neutral-300 hover:text-white disabled:cursor-default">
            <span aria-hidden="true" className={`flex size-[18px] items-center justify-center rounded-full border ${all ? 'border-cyan-300 bg-cyan-300 text-neutral-900' : 'border-white/40'}`}>{all && <Check className="h-3 w-3" />}</span>全選択
            <span className="ml-2 text-neutral-400">選択しました <span className="text-cyan-300">{value.length}</span> 枚の画像</span>
          </button>
          <button type="button" disabled={!editable || value.length === 0} onClick={() => onConfirm(ready.filter((image) => value.includes(image.key)).map((image) => image.key))}
            className="h-8 rounded-lg bg-cyan-300 px-4 text-sm font-medium text-neutral-950 disabled:cursor-not-allowed disabled:bg-[#2c5e5b] disabled:text-neutral-400">{button}</button>
        </div>
      )}
    </section>
  );
}

/** Light's 「ビジュアル方向性を選択」: one or more directions, each with what it is and why it is recommended. */
function DirectionPicker({ themes, chosen, disabled, hint, images, urls, onRevise, onConfirm }: {
  themes: string[]; chosen: string[] | null; disabled: boolean; hint: string; images: AgentStyleImage[]; urls: Record<string, string>; onRevise: () => void; onConfirm: (themes: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const value = chosen ?? picked;
  const editable = !chosen && !disabled;
  return (
    <section aria-label="ビジュアル方向性を選択" className="space-y-3 rounded-2xl border border-white/10 bg-[#202426] p-5" data-testid="agent-design-request">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-base font-medium text-white"><Box className="h-5 w-5 text-cyan-300" />ビジュアル方向性を選択</span>
        <span className={`rounded-md border px-2 py-0.5 text-xs ${chosen ? 'border-emerald-400/60 text-emerald-300' : 'border-amber-400/70 text-amber-300'}`}>{chosen ? '確認済み' : '確認待ち'}</span>
      </div>
      <p className="text-xs text-neutral-400">{hint}</p>
      {/* Light lays the directions out two to a row, each line cut short, with the select circle at the top right. */}
      <div className="grid gap-2 sm:grid-cols-2" data-testid="agent-directions">
        {themes.map((theme, index) => {
          const direction = parseAgentDirection(theme);
          const on = value.includes(theme);
          // Light shows a product picture of each direction on the card's left; Heavy makes one with its own image service.
          const image = images.find((entry) => entry.key === `d${index + 1}`);
          return (
            <button key={theme} type="button" role="checkbox" aria-checked={on} disabled={!editable} title={[direction.name, direction.description, direction.recommendation].filter(Boolean).join('\n')}
              onClick={() => setPicked((current) => current.includes(theme) ? current.filter((entry) => entry !== theme) : [...current, theme])}
              className={`flex min-w-0 items-start gap-2 rounded-xl border px-2 py-2 text-left transition ${on ? 'border-cyan-300/70 bg-cyan-300/10' : 'border-white/10 hover:bg-white/5'} disabled:cursor-default`}>
              {image && <GeneratedTile image={image} url={urls[image.requestId]} label={direction.name} className="h-[110px] w-20 flex-none" />}
              <span className="min-w-0 flex-1 space-y-1 py-1">
                <span className="line-clamp-1 text-sm font-medium text-white">{direction.name}</span>
                {direction.description && <span className="line-clamp-2 text-xs leading-5 text-neutral-300">{direction.description}</span>}
                {direction.recommendation && <span className="line-clamp-2 text-xs leading-5 text-neutral-500">{direction.recommendation}</span>}
              </span>
              <span aria-hidden="true" className={`mt-0.5 flex size-[18px] flex-none items-center justify-center rounded-full border ${on ? 'border-cyan-300 bg-cyan-300 text-neutral-900' : 'border-white/40'}`}>{on && <Check className="h-3 w-3" />}</span>
            </button>
          );
        })}
      </div>
      {!chosen && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" role="checkbox" aria-checked={value.length === themes.length} disabled={!editable} onClick={() => setPicked(value.length === themes.length ? [] : themes)}
            className="flex items-center gap-1.5 text-sm text-neutral-300 hover:text-white disabled:cursor-default">
            <span aria-hidden="true" className={`flex size-[18px] items-center justify-center rounded-full border ${value.length === themes.length ? 'border-cyan-300 bg-cyan-300 text-neutral-900' : 'border-white/40'}`}>{value.length === themes.length && <Check className="h-3 w-3" />}</span>全選択
          </button>
          <span className="flex items-center gap-2">
            <button type="button" disabled={disabled} onClick={onRevise} className="h-8 rounded-lg border border-white/15 px-3 text-sm text-neutral-200 hover:bg-white/10">修正・補足する</button>
            <button type="button" disabled={!editable || value.length === 0} onClick={() => onConfirm(value)}
              className="h-8 rounded-lg bg-cyan-300 px-4 text-sm font-medium text-neutral-950 disabled:cursor-not-allowed disabled:bg-[#2c5e5b] disabled:text-neutral-400">確認して続行</button>
          </span>
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
  const [report, setReport] = useState<ReportDoc | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [pendingAttachments, setPendingAttachments] = useState<AgentAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const imageSlots = useRef(new Set<string>());
  const commitChain = useRef<Promise<unknown>>(Promise.resolve());
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

  /** Saves run one after another: the style images settle two at a time and each writes the task. */
  const commit = useCallback((change: (task: AgentTask) => AgentTask, extra?: { title?: string; objects?: unknown[] }) => {
    const run = commitChain.current.then(async () => {
      const current = docRef.current;
      if (!current) throw new Error('agent_task_missing');
      const next = await updateAgentTask(current, change, extra);
      docRef.current = next;
      if (mounted.current) setDoc(next);
      return next;
    });
    commitChain.current = run.catch(() => undefined);
    return run;
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
    ['theme', 'note', 'structure', 'design', 'final', 'dialogue'].includes(kind) ? `${kind}-${step.requestId.slice(0, 8)}` : kind), [taskId]);

  const runAssistant = useCallback(async (kind: AssistantKind, step: AgentAssistantStep, prompt: string | null, apply: (task: AgentTask, step: AgentAssistantStep) => AgentTask, mode?: AssistantMode,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []) => {
    if (inFlight.current.has(step.requestId) || !brandId) return;
    inFlight.current.add(step.requestId);
    const conversationId = conversationFor(kind, step);
    try {
      let result = step;
      if (prompt) {
        // Light sends the attached images along with every step; Heavy sends the newest ones as references.
        const references = docRef.current ? agentReferenceImages(docRef.current.task) : [];
        const receipt = await api().sendDesignAssistantRequest({ requestId: step.requestId, brandId, projectId: taskId, conversationId, prompt, history, references, ...(mode ? { mode } : {}) });
        result = assistantStepFrom(receipt, step.requestId);
      }
      if (result.state === 'running') result = await pollAssistant(result, conversationId);
      if (result.state !== 'running') await commit((task) => apply(task, result));
    } catch (error) {
      // Turned away or never stored: waiting will not settle it, so the step fails and its retry appears (production
      // 2026-11-12: an oversized theme request was rejected and the page kept reading back a request that did not exist).
      const rejected = agentRequestRejection(error);
      if (rejected) {
        try { await commit((task) => apply(task, { requestId: step.requestId, state: 'failed', errorCode: rejected })); return; } catch { /* fall through to the notice */ }
      }
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

  // Light's steps after the directions (2026-11-12): 商品構成計画 → AI designs → the final plan.
  const startStructure = useCallback(async () => {
    const step: AgentAssistantStep = { requestId: crypto.randomUUID(), state: 'running', at: new Date().toISOString() };
    const saved = await commit((task) => ({ ...task, structure: step }));
    await runAssistant('structure', step, agentStructurePrompt(saved.task), (task, result) => ({ ...task, structure: { ...result, at: step.at } }), 'agent');
  }, [commit, runAssistant]);
  const startDesign = useCallback(async () => {
    const step: AgentAssistantStep = { requestId: crypto.randomUUID(), state: 'running', at: new Date().toISOString() };
    const saved = await commit((task) => ({ ...task, design: step }));
    await runAssistant('design', step, agentDesignPrompt(saved.task), (task, result) => ({ ...task, design: { ...result, at: step.at } }), 'agent');
  }, [commit, runAssistant]);
  const startFinal = useCallback(async () => {
    const step: AgentAssistantStep = { requestId: crypto.randomUUID(), state: 'running', at: new Date().toISOString() };
    const saved = await commit((task) => ({ ...task, final: step }));
    await runAssistant('final', step, agentFinalPrompt(saved.task), (task, result) => ({ ...task, final: { ...result, at: step.at } }), 'agent');
  }, [commit, runAssistant]);

  /** Writes one generated image back into the direction images or the style images, whichever holds it. */
  const applyStyleImage = useCallback((requestId: string, change: (image: AgentStyleImage) => AgentStyleImage) => commit((task) => ({
    ...task,
    designs: task.designs?.map((image) => image.requestId === requestId ? change(image) : image) ?? task.designs,
    directionImages: task.directionImages ? { ...task.directionImages, images: task.directionImages.images.map((image) => image.requestId === requestId ? change(image) : image) } : task.directionImages,
  })), [commit]);
  const settleStyleImage = useCallback(async (image: AgentStyleImage, receipt: Record<string, unknown>) => {
    const parsed = readImageReceipt(receipt);
    if (parsed.state === 'completed' && parsed.storagePath) {
      await applyStyleImage(image.requestId, (current) => ({ ...current, state: 'completed', storagePath: parsed.storagePath, imageId: parsed.imageId, jobId: parsed.jobId, errorCode: undefined }));
      await api().acknowledgeImageAction(receipt).catch(() => undefined);
      return true;
    }
    if (parsed.state === 'failed') { await applyStyleImage(image.requestId, (current) => ({ ...current, state: 'failed', errorCode: parsed.errorCode ?? 'image_failed' })); return true; }
    return false;
  }, [applyStyleImage]);
  /**
   * One style or direction image. A pending image is marked as sent before it is sent, so a reload reads it back by its
   * request id instead of making another; one that was marked but never reached the server is sent again with the same
   * idempotency key, which the image service answers once.
   */
  const runStyleImage = useCallback(async (image: AgentStyleImage) => {
    if (!brandId) return;
    const auth = useAuthStore.getState();
    const ready = Boolean(auth.user?.id && auth.currentBrand?.id === brandId && (!isHeavyWorkspaceRuntime() || isHeavyWorkspaceBrandName(auth.currentBrand.name)));
    const send = async () => {
      // The インスピレーション / AIグラフィックデザイン chat draws garments or flat square prints; the planning flow draws garments.
      const current = docRef.current?.task;
      const dialogue = current?.flow === 'dialogue';
      const receipt = await generateImage(dialogue ? agentDialogueImagePrompt(current!, image.prompt) : agentStyleImagePrompt(image.prompt), brandId, { rightsConfirmed: ready, idempotencyKey: image.requestId, retainUntilAcknowledged: true,
        featureType: 'lightchain-design-agent', generationProvider: HEAVY_IMAGE_PROVIDER, aspectRatio: dialogue ? agentDialogueAspect(current!) : '3:4',
        assertContext: () => { if (useAuthStore.getState().currentBrand?.id !== brandId) throw new Error('agent_context_changed'); } });
      await settleStyleImage(image, { ...receipt, state: receipt.success === false ? 'failed' : (receipt as { state?: string }).state ?? 'completed' } as Record<string, unknown>);
    };
    try {
      if (image.state === 'pending') {
        await applyStyleImage(image.requestId, (current) => ({ ...current, state: 'running', at: new Date().toISOString() }));
        await send();
        return;
      }
      for (let attempt = 0; attempt < 60 && mounted.current; attempt += 1) {
        let receipt: Record<string, unknown>;
        try { receipt = await api().readImageAIRequest(image.requestId); }
        catch (error) { if (/_404_/.test(error instanceof Error ? error.message : '')) { await send(); return; } throw error; }
        if (await settleStyleImage(image, receipt)) return;
        await wait(4000);
      }
    } catch {
      if (mounted.current) setNotice('画像の生成結果を確認できませんでした。再読み込みすると結果を確認します。');
      await wait(5000);
    }
  }, [applyStyleImage, brandId, settleStyleImage]);

  // Light's インスピレーション / AIグラフィックデザイン chat (2026-11-12): each user message gets one reply; earlier turns go as history.
  const applyTurn = (turnId: string) => (task: AgentTask, result: AgentAssistantStep): AgentTask => ({ ...task, turns: (task.turns ?? []).map((turn) => turn.id === turnId ? { ...turn, step: result } : turn) });
  /** Asks for the reply to the newest user turn (or to the request itself when there is none yet). */
  const askDialogue = useCallback(async (saved: AgentTaskDocument, reply: AgentTurn) => {
    const turns = saved.task.turns ?? [];
    const index = turns.findIndex((turn) => turn.id === reply.id);
    const latest = index > 0 && turns[index - 1].role === 'user' ? turns[index - 1] : null;
    const before = { ...saved.task, turns: turns.slice(0, latest ? index - 1 : index) };
    const prompt = agentDialoguePrompt(before, latest, reply.mode ?? 'agent');
    const history = agentDialogueHistory(before);
    await runAssistant('dialogue', reply.step!, prompt, applyTurn(reply.id), reply.mode ?? 'agent', history);
  }, [runAssistant]);
  const startDialogue = useCallback(async () => {
    const reply: AgentTurn = { id: crypto.randomUUID(), role: 'assistant', at: new Date().toISOString(), mode: 'agent', step: { requestId: crypto.randomUUID(), state: 'running' } };
    const saved = await commit((task) => ({ ...task, turns: [...(task.turns ?? []), reply] }));
    await askDialogue(saved, reply);
  }, [askDialogue, commit]);
  /** Light's 「開始」 under the 執行書: one image per style, in the plan's order, two at a time. */
  const startDialogueGeneration = useCallback((after: string) => commit((task) => {
    const plan = agentDialoguePlan(task);
    if (!plan || task.dialogueStart) return task;
    return { ...task, dialogueStart: { after, plan: plan.turn.id, at: new Date().toISOString() }, designs: agentBuildDialogueImages(task, () => crypto.randomUUID()) };
  }), [commit]);

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
    if (task.flow === 'dialogue') {
      const turns = task.turns ?? [];
      const last = turns.at(-1);
      if (!last) { guard(startDialogue, 'タスクを開始できませんでした。', 'start'); return; }
      if (last.role === 'assistant' && last.step?.state === 'running') { const step = last.step; guard(() => runAssistant('dialogue', step, null, applyTurn(last.id), last.mode ?? 'agent')); return; }
      // The assistant read the user's approval as 「開始」: generate the 執行書's styles.
      if (last.role === 'assistant' && last.step?.state === 'completed' && last.step.content && !task.dialogueStart && parseAgentDialogueReply(last.step.content).start && agentDialoguePlan(task)) {
        guard(() => startDialogueGeneration(last.id), '生成を開始できませんでした。'); return;
      }
      const series = task.dialogueStart && task.designs?.length ? (() => { const plan = turns.find((turn) => turn.id === task.dialogueStart!.plan); return plan?.step?.content ? parseAgentDialogueReply(plan.step.content).series : ''; })() : '';
      if (series && doc.title !== series && isAutomaticAgentTaskTitle(doc.title, task)) guard(() => commit((current) => current, { title: series }));
      return;
    }
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
    // Light shows a product picture on each direction card; Heavy generates one per direction once the directions arrive.
    if (task.flow === 'conversation' && lastRound.step.state === 'completed' && lastRound.themes.length && task.directionImages?.round !== lastRound.step.requestId && !task.choice) {
      const round = lastRound.step.requestId; const themes = lastRound.themes;
      guard(() => commit((current) => ({ ...current, directionImages: { round, images: agentBuildDirectionImages(current, themes, () => crypto.randomUUID()) } })));
      return;
    }
    if (!task.choice) return;
    if (agentUsesMerchFlow(task)) {
      const structure = task.structure;
      if (!structure) { guard(startStructure, '商品構成計画の作成を開始できませんでした。', 'structure'); return; }
      if (structure.state === 'running') { guard(() => runAssistant('structure', structure, null, (current, result) => ({ ...current, structure: { ...result, at: structure.at } }), 'agent')); return; }
      if (structure.state !== 'completed') return;
      // 「修正・補足する」 on the plan: a note written after it asks for a revised plan (until 「AIデザイン修正の生成へ進む」).
      if (!task.proceed && structure.at && (task.notes ?? []).some((note) => note.stage === 'structure' && note.reply.state === 'completed' && note.at > structure.at!)) {
        guard(startStructure, '商品構成計画の作り直しを開始できませんでした。'); return;
      }
      if (!task.proceed) return;
      const design = task.design;
      if (!design) { guard(startDesign, 'AIデザインの設計を開始できませんでした。', 'design'); return; }
      if (design.state === 'running') { guard(() => runAssistant('design', design, null, (current, result) => ({ ...current, design: { ...result, at: design.at } }), 'agent')); return; }
      if (design.state !== 'completed') return;
      if (!task.designs) { guard(() => commit((current) => ({ ...current, designs: agentBuildDesignImages(current, () => crypto.randomUUID()) }))); return; }
      if (task.designs.some((image) => image.state === 'pending' || image.state === 'running') || !task.styleChoice) return;
      const final = task.final;
      if (!final) { guard(startFinal, '企画書の作成を開始できませんでした。', 'final'); return; }
      if (final.state === 'running') { guard(() => runAssistant('final', final, null, (current, result) => ({ ...current, final: { ...result, at: final.at } }), 'agent')); return; }
      if (final.state !== 'completed' || !final.content) return;
      const finalTitle = parseAgentFinal(final.content).title;
      if (finalTitle && doc.title !== finalTitle && isAutomaticAgentTaskTitle(doc.title, task)) { guard(() => commit((current) => current, { title: finalTitle })); }
      return;
    }
    if (!task.plan) { const theme = task.choice.theme; guard(() => startPlan(theme), '企画書の作成を開始できませんでした。', 'plan'); return; }
    if (task.plan.state === 'running') { const step = task.plan; guard(() => runAssistant('plan', step, null, (current, result) => ({ ...current, plan: result }), textMode(task))); return; }
    if (task.plan.state !== 'completed' || !task.plan.content) return;
    const parsed = parsePlanResponse(task.plan.content);
    if (parsed.title && doc.title !== parsed.title && isAutomaticAgentTaskTitle(doc.title, task)) { const title = parsed.title; guard(() => commit((current) => current, { title })); return; }
    if (!task.image) { const theme = task.choice.theme; guard(() => startImage(parsed.imagePrompt ?? `Apparel planning mood board for a womenswear collection, ${theme}, fabric swatches, color palette, editorial photo`)); return; }
    if (task.image.state === 'running') { const step = task.image; guard(() => reconcileImage(step)); }
  }, [doc, brandId, status, tick, guard, startRequirements, startResearch, startThemeRound, startPlan, startImage, reconcileImage, runAssistant, commit, startStructure, startDesign, startFinal, startDialogue, startDialogueGeneration]);

  // The direction and style images run beside the text steps, two at a time.
  useEffect(() => {
    if (!doc || !brandId || status !== 'ready') return;
    const queue = [...(doc.task.directionImages?.images ?? []), ...(doc.task.designs ?? [])].filter((image) => image.state === 'pending' || image.state === 'running');
    for (const image of queue) {
      if (imageSlots.current.size >= 2) break;
      if (imageSlots.current.has(image.requestId)) continue;
      imageSlots.current.add(image.requestId);
      void runStyleImage(image).finally(() => { imageSlots.current.delete(image.requestId); if (mounted.current) setTick((value) => value + 1); });
    }
  }, [doc, brandId, status, tick, runStyleImage]);

  // Signed addresses for the generated images (cards, the picker, the side panel and the reports).
  useEffect(() => {
    const images = [...(doc?.task.directionImages?.images ?? []), ...(doc?.task.designs ?? [])].filter((image) => image.state === 'completed' && image.storagePath && !imageUrls[image.requestId]);
    if (!images.length) return;
    let active = true;
    void Promise.all(images.map(async (image) => [image.requestId, await resolveGeneratedImageUrlWithStatus(image.storagePath!)] as const)).then((entries) => {
      if (!active) return;
      setImageUrls((current) => ({ ...current, ...Object.fromEntries(entries.filter(([, resolved]) => resolved.ok).map(([id, resolved]) => [id, (resolved as { url: string }).url])) }));
    });
    return () => { active = false; };
  }, [doc, imageUrls]);

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
  const proceedToDesigns = () => { setNotice(null); guard(() => commit((task) => ({ ...task, proceed: { at: new Date().toISOString() } })), '保存できませんでした。'); };
  const confirmStyles = (keys: string[]) => { setNotice(null); guard(() => commit((task) => ({ ...task, styleChoice: { keys, at: new Date().toISOString() } })), '選択を保存できませんでした。'); };
  const retryStructure = () => { setNotice(null); guard(() => commit((task) => ({ ...task, structure: null }))); };
  const retryDesign = () => { setNotice(null); guard(() => commit((task) => ({ ...task, design: null, designs: null }))); };
  const retryFinal = () => { setNotice(null); guard(() => commit((task) => ({ ...task, final: null }))); };
  /** A failed image gets a new request id (the old one already has its answer). */
  const retryStyleImage = (requestId: string) => { setNotice(null); void applyStyleImage(requestId, (image) => ({ ...image, requestId: crypto.randomUUID(), state: 'pending', errorCode: undefined })).catch(() => setNotice('再生成を開始できませんでした。')); };
  const openReport = (doc: ReportDoc) => setReport(doc);
  const confirmScope = (scope: ScopeDraft) => {
    setNotice(null);
    guard(() => commit((task) => ({ ...task, scope: { regions: scope.regions, ec: scope.ec, sns: scope.sns, other: scope.other.trim(), at: new Date().toISOString() } })), '調査範囲を保存できませんでした。');
  };

  const task = doc?.task ?? null;
  const conversation = task?.flow === 'conversation';
  const noteStage = (current: AgentTask): AgentNoteStage => (current.flow === 'conversation' && !current.aligned ? 'requirements'
    : current.flow === 'conversation' && !current.scope ? 'scope'
      : current.flow === 'conversation' && current.research?.state !== 'completed' ? 'research'
        : !current.choice ? 'themes'
          : !agentUsesMerchFlow(current) ? 'plan'
            : !current.proceed ? 'structure' : !current.styleChoice ? 'designs' : 'final');
  const sendNote = () => {
    const value = draft.trim();
    if ((!value && !pendingAttachments.length) || !doc || attaching) return;
    // guard() skips work while another step is starting; keep the text instead of dropping it.
    if (busy.current) { setNotice('ほかの処理が終わってから送信してください。'); return; }
    const attached = pendingAttachments;
    setDraft(''); setPendingAttachments([]); setNotice(null);
    guard(async () => {
      const requestId = crypto.randomUUID();
      const text = (value || `添付：${attached.map((item) => item.name).join('、')}`).slice(0, 1200);
      const note: AgentNote = { id: requestId, text, at: new Date().toISOString(), stage: noteStage(docRef.current!.task), reply: { requestId, state: 'running' },
        ...(attached.length ? { attachments: attached.map((item) => item.id) } : {}) };
      const saved = await commit((current) => ({ ...current, notes: [...(current.notes ?? []), note], ...(attached.length ? { attachments: [...(current.attachments ?? []), ...attached].slice(-12) } : {}) }));
      const prompt = agentNotePrompt({ ...saved.task, notes: (saved.task.notes ?? []).filter((entry) => entry.id !== note.id) }, note);
      await runAssistant('note', note.reply, prompt, applyNote(note.id), textMode(saved.task));
    }, '送信できませんでした。');
  };

  const dialogue = task?.flow === 'dialogue';
  /** One message of the インスピレーション / AIグラフィックデザイン chat; typing 「開始」 under the 執行書 starts the generation at once. */
  const sendTurn = (entry: { text: string; prompt?: string; attachments?: AgentAttachment[] }) => {
    if (!doc) return false;
    if (busy.current) { setNotice('ほかの処理が終わってから送信してください。'); return false; }
    if ((doc.task.turns ?? []).length >= AGENT_DIALOGUE_TURN_LIMIT) { setNotice('この会話はこれ以上続けられません。新しいタスクを作成してください。'); return false; }
    setNotice(null);
    guard(async () => {
      const current = docRef.current!.task;
      const now = new Date().toISOString();
      const added = entry.attachments ?? [];
      const user: AgentTurn = { id: crypto.randomUUID(), role: 'user', at: now, text: entry.text.slice(0, 1200), ...(entry.prompt ? { prompt: entry.prompt.slice(0, 3000) } : {}),
        ...(added.length ? { attachments: added.map((item) => item.id) } : {}) };
      const withFiles = (task: AgentTask) => (added.length ? { attachments: [...(task.attachments ?? []), ...added].slice(-12) } : {});
      const plan = agentDialoguePlan(current);
      if (!entry.prompt && !current.dialogueStart && plan && (current.turns ?? []).at(-1)?.id === plan.turn.id && agentDialogueIsStart(entry.text)) {
        await commit((task) => ({ ...task, ...withFiles(task), turns: [...(task.turns ?? []), user],
          dialogueStart: { after: user.id, plan: plan.turn.id, at: now }, designs: agentBuildDialogueImages(task, () => crypto.randomUUID()) }));
        return;
      }
      const reply: AgentTurn = { id: crypto.randomUUID(), role: 'assistant', at: now, mode: agentDialogueMode(current), step: { requestId: crypto.randomUUID(), state: 'running' } };
      const saved = await commit((task) => ({ ...task, ...withFiles(task), turns: [...(task.turns ?? []), user, reply] }));
      await askDialogue(saved, reply);
    }, '送信できませんでした。');
    return true;
  };
  /** Light posts the form's answers as the user's message, joined by 「，」. */
  const answerDialogue = (questions: AssistantQuestion[], answers: string[][]) => {
    const picked = answers.flat().map((value) => value.trim()).filter(Boolean);
    sendTurn({ text: picked.join('，') || 'おまかせ', prompt: `【確認の回答】\n${questions.map((question, index) => `${question.title}: ${(answers[index] ?? []).filter(Boolean).join('、') || 'おまかせ'}`).join('\n')}` });
  };
  const pickDialogue = (picked: AgentAttachment[]) => {
    sendTurn({ text: picked.length ? `参考画像を${picked.length}枚選択しました` : '参考画像を選択せずに進みます', attachments: picked,
      prompt: `【参考画像の選択】\n${picked.length ? picked.map((item) => item.name).join('、') : '選択なし（検索結果の画像を選択しませんでした）'}` });
  };
  const retryDialogue = (turnId: string) => {
    setNotice(null);
    guard(async () => {
      const step: AgentAssistantStep = { requestId: crypto.randomUUID(), state: 'running' };
      const saved = await commit((task) => ({ ...task, turns: (task.turns ?? []).map((turn) => turn.id === turnId ? { ...turn, step } : turn) }));
      const reply = (saved.task.turns ?? []).find((turn) => turn.id === turnId);
      if (reply) await askDialogue(saved, reply);
    }, '再試行できませんでした。');
  };
  const sendComposer = () => {
    if (!dialogue) { sendNote(); return; }
    const value = draft.trim();
    if ((!value && !pendingAttachments.length) || attaching) return;
    const attached = pendingAttachments;
    if (sendTurn({ text: value || `添付：${attached.map((item) => item.name).join('、')}`, attachments: attached })) { setDraft(''); setPendingAttachments([]); }
  };
  const dialogueSources = task && dialogue ? agentDialogueSources(task) : null;

  const plan = task?.plan?.state === 'completed' && task.plan.content ? parsePlanResponse(task.plan.content) : null;
  const merch = Boolean(task && agentUsesMerchFlow(task));
  const wording = task ? agentWording(task) : null;
  const done = Boolean(task && (dialogue ? task.dialogueStart && (task.designs ?? []).length > 0 && (task.designs ?? []).every((image) => image.state !== 'pending' && image.state !== 'running')
    : merch ? task.final?.state === 'completed' : task.image?.state === 'completed'));
  const stepFailed = (state?: string) => state === 'failed' || state === 'unknown';
  const notes = task?.notes ?? [];
  const designs = task?.designs ?? [];
  const designsBusy = designs.some((image) => image.state === 'pending' || image.state === 'running');
  const designsSettled = designs.length > 0 && !designsBusy;
  const working = Boolean(task && (task.requirements?.state === 'running' || task.research?.state === 'running' || task.plan?.state === 'running'
    || task.image?.state === 'running' || task.rounds.at(-1)?.step.state === 'running' || notes.some((note) => note.reply.state === 'running')
    || task.structure?.state === 'running' || task.design?.state === 'running' || task.final?.state === 'running' || designsBusy
    || (task.turns ?? []).some((turn) => turn.step?.state === 'running')));
  const waitingOnUser = Boolean(conversation && task?.requirements?.state === 'completed' && (!task.aligned || !task.scope));
  const statusLabel = !task ? '' : done ? '完了'
    : dialogue ? (working ? '作成中' : ['failed', 'unknown'].includes((task.turns ?? []).at(-1)?.step?.state ?? '') ? '失敗' : '確認待ち')
    : [task.plan?.state, task.image?.state, task.research?.state, task.requirements?.state, task.structure?.state, task.design?.state, task.final?.state].some(stepFailed) ? '失敗'
      : task.choice ? '作成中' : task.rounds.at(-1)?.step.state === 'completed' || waitingOnUser ? '確認待ち' : '調査中';
  const research = task?.research?.state === 'completed' && task.research.content ? parseAgentResearch(task.research.content) : null;
  const roundSources = task && !conversation ? agentRoundSources(task) : null;
  const lastRound = task?.rounds.at(-1);
  const stepItems = (labels: readonly string[], finished: boolean[]) => labels.map((label, index) => (
    { label, status: finished[index] ? '完了' as const : finished.findIndex((value) => !value) === index ? '進行中' as const : '待機中' as const }));
  const intakeSteps = task && wording ? stepItems(wording.intakeSteps, [task.requirements?.state === 'completed', Boolean(task.aligned), Boolean(task.scope)]) : [];
  const researchDone = task?.research?.state === 'completed';
  const researchSteps = task?.scope && wording ? stepItems(wording.researchSteps(task.scope), task.subtype === '顧客提案'
    ? [researchDone, Boolean(researchDone && lastRound?.step.state === 'completed')] : [researchDone, researchDone, Boolean(task.choice)]) : [];
  const structureSteps = task && wording && merch && task.choice
    ? stepItems(wording.structureSteps(agentChosenCodes(task)), [task.structure?.state === 'completed', task.structure?.state === 'completed', Boolean(task.proceed)]) : [];
  const designCount = designs.length || (task?.structure?.state === 'completed' && task.structure.content ? parseAgentStructure(task.structure.content).styles.length : 0) || AGENT_STYLE_COUNT;
  const designSteps = task && wording && task.proceed
    ? stepItems(wording.designSteps(designCount, agentChosenCodes(task)), task.subtype === '顧客提案'
      ? [designsSettled, designsSettled, designsSettled, Boolean(task.styleChoice)] : [task.design?.state === 'completed', designsSettled, designsSettled, Boolean(task.styleChoice)]) : [];
  const finalSteps = task && wording && task.styleChoice ? stepItems(wording.finalSteps, [task.final?.state === 'completed', task.final?.state === 'completed']) : [];
  const urlsByKey = Object.fromEntries(designs.filter((image) => imageUrls[image.requestId]).map((image) => [image.key, imageUrls[image.requestId]]));
  const final = task?.final?.state === 'completed' && task.final.content ? parseAgentFinal(task.final.content) : null;
  /** The task's reports, newest first (Light's タスク成果物). */
  const deliverables: Array<{ key: string; title: string; html: () => string }> = task && wording ? [
    ...(merch && final ? [{ key: 'final', title: wording.finalReport.title, html: () => buildAgentFinalHtml(task, urlsByKey) }] : []),
    ...(merch && designsSettled ? [{ key: 'design', title: wording.designReport.title, html: () => buildAgentDesignHtml(task, urlsByKey) }] : []),
    ...(merch && task.structure?.state === 'completed' ? [{ key: 'structure', title: wording.structureReport.title, html: () => buildAgentStructureHtml(task) }] : []),
    ...(research ? [{ key: 'research', title: conversation ? wording.researchReport.title : '調査とビジュアル方向レポート', html: () => buildAgentResearchReportHtml(task) }] : []),
  ] : [];
  const showDeliverable = (key: string) => { const entry = deliverables.find((item) => item.key === key); if (entry) openReport({ title: entry.title, html: entry.html() }); };
  const saveDeliverable = (key: string) => { const entry = deliverables.find((item) => item.key === key); if (entry) downloadReport({ title: entry.title, html: entry.html() }); };
  const referenceImages = (task?.directionImages?.images ?? []).filter((image) => image.state === 'completed' && imageUrls[image.requestId]);
  const generatedImages = designs.filter((image) => image.state === 'completed' && imageUrls[image.requestId]);
  const stamp = (value?: string) => { if (!value) return ''; const date = new Date(value); const pad = (n: number) => String(n).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`; };
  const confirmDirections = (themes: string[]) => {
    setNotice(null);
    guard(() => commit((current) => ({ ...current, choice: { theme: themes.map((theme) => parseAgentDirection(theme).name).join(' / '), themes, at: new Date().toISOString() } })), '選択を保存できませんでした。');
  };

  return (
    <main className="dark flex h-[calc(100vh-50px)] min-h-full bg-[#171b1c] text-white" data-testid="agent-task-page"
      data-agent-task={doc?.id ?? ''} data-agent-status={statusLabel} data-agent-plan={task?.plan?.requestId ?? task?.final?.requestId ?? ''} data-agent-image={task?.image?.jobId ?? ''}>
      <AgentSidebar title={task?.subtype ?? 'インスピレーションワークスペース'} activeTaskId={doc?.id ?? taskId} refreshKey={`${doc?.id}:${doc?.title}`} onNewTask={() => navigate('/agent')} />
      <section className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-[752px] flex-1 px-4 py-10">
          {status === 'loading' && <StepSpinner label="タスクを読み込んでいます…" />}
          {status === 'missing' && <div role="alert" className="rounded-xl border border-white/10 bg-[#202426] p-6 text-sm text-neutral-300">このタスクは見つかりません。<button type="button" onClick={() => navigate('/agent')} className="ml-2 text-cyan-300 underline">新規タスクへ</button></div>}
          {task && wording && (
            <div className="space-y-8 text-sm leading-6 text-neutral-200">
              <UserBubble testId="agent-task-prompt">{task.prompt}</UserBubble>
              {(task.attachments ?? []).length > 0 && !notes.some((note) => note.attachments?.length) && !(task.turns ?? []).some((turn) => turn.attachments?.length) && <div className="flex justify-end"><AgentAttachmentChips items={task.attachments ?? []} /></div>}
              {dialogue && <AgentDialogueView task={task} brandId={brandId} working={working} urls={imageUrls} attachments={task.attachments ?? []}
                onAnswer={answerDialogue} onPick={pickDialogue} onRetry={retryDialogue} onRetryImage={retryStyleImage} onError={(message) => setNotice(message)} />}
              {!dialogue && (
                <>
              {conversation && (
                <>
                  <StepList items={intakeSteps} testId="agent-intake-steps" />
                  {task.requirements?.state === 'running' && <StepSpinner label="要件を整理しています…" />}
                  {stepFailed(task.requirements?.state) && <ErrorRow onRetry={retryRequirements}>要件の整理に失敗しました（{task.requirements?.errorCode ?? task.requirements?.state}）。</ErrorRow>}
                  {task.requirements?.state === 'completed' && task.requirements.content && <RequirementsView content={task.requirements.content} />}
                  <Notes notes={notes} stage="requirements" />
                  {task.requirements?.state === 'completed' && !task.aligned && (
                    <div className="flex flex-wrap justify-end gap-2" data-testid="agent-align-actions">
                      <button type="button" onClick={() => composerRef.current?.focus()} className="h-10 rounded-full border border-white/15 px-4 text-sm text-neutral-200 hover:bg-white/10">{wording.supplement}</button>
                      <button type="button" disabled={working} onClick={continueAligned} className="h-10 rounded-full bg-[#0bcabc] px-4 text-sm font-medium text-neutral-950 hover:bg-[#2ad6c9] disabled:opacity-50">問題ありません、続行</button>
                    </div>
                  )}
                  {task.aligned && <UserBubble>問題ありません、続行</UserBubble>}
                  {task.aligned && <ScopeForm confirmed={task.scope ?? null} disabled={working} regionTitle={wording.regionTitle} onConfirm={confirmScope} />}
                  {task.scope && <UserBubble testId="agent-scope-summary">{agentScopeSummary(task.scope)}</UserBubble>}
                  <Notes notes={notes} stage="scope" />
                  {task.scope && <StepList testId="agent-research-steps" items={researchSteps} />}
                  {task.research?.state === 'running' && <StepSpinner label="考え中…（ウェブ検索で資料を集めています。1〜3分かかります）" />}
                  {stepFailed(task.research?.state) && <ErrorRow onRetry={retryResearch}>調査に失敗しました（{task.research?.errorCode ?? task.research?.state}）。</ErrorRow>}
                  {task.research?.state === 'completed' && task.research.content && (
                    <>
                      <p>{wording.researchDone}</p>
                      <ReportCard testId="agent-research-report" noteTestId="agent-research-source-count" title={wording.researchReport.title}
                        note={research?.search === 'ok' ? `${wording.researchReport.note} · 資料${research.sources.length}件` : 'ウェブ検索を使えませんでした · AIモデルの知識に基づく整理'}
                        onOpen={() => showDeliverable('research')} onDownload={() => saveDeliverable('research')} />
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
                    {/* An attempt a retry already replaced has nothing to show: only the last round reports its failure. */}
                    {last && (round.step.state === 'failed' || round.step.state === 'unknown') && (
                      <ErrorRow onRetry={last && !task.choice ? () => void retryThemes() : undefined}>テーマの提案に失敗しました（{round.step.errorCode ?? round.step.state}）。</ErrorRow>
                    )}
                    {/* Light goes straight from the report card to the direction form; the research itself is in the report. */}
                    {round.summary && !conversation && <div className="whitespace-pre-wrap" data-testid="agent-summary">{round.summary}</div>}
                    {round.step.state === 'completed' && round.themes.length > 0 && conversation && (
                      <DirectionPicker themes={round.themes} chosen={confirmed ? (last ? task.choice?.themes ?? [task.choice?.theme ?? ''] : []) : null} disabled={working}
                        hint={wording.directionHint} images={task.directionImages?.round === round.step.requestId ? task.directionImages.images : []} urls={imageUrls}
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
              {merch && task.choice && (
                <>
                  {/* Light posts the chosen directions as the user's message, then the 商品構成計画 steps. */}
                  <UserBubble testId="agent-choice">{(task.choice.themes ?? [task.choice.theme]).map((theme) => parseAgentDirection(theme).name).join('、')}</UserBubble>
                  <StepList testId="agent-structure-steps" items={structureSteps} />
                  {task.structure?.state === 'running' && <StepSpinner label="考え中…" />}
                  {stepFailed(task.structure?.state) && <ErrorRow onRetry={task.proceed ? undefined : retryStructure}>{wording.structureReport.title}の作成に失敗しました（{task.structure?.errorCode ?? task.structure?.state}）。</ErrorRow>}
                  {task.structure?.state === 'completed' && (
                    <ReportCard testId="agent-structure-report" title={wording.structureReport.title} note={wording.structureReport.note}
                      onOpen={() => showDeliverable('structure')} onDownload={() => saveDeliverable('structure')} />
                  )}
                  <Notes notes={notes} stage="structure" />
                  {task.structure?.state === 'completed' && !task.proceed && (
                    <div className="flex flex-wrap justify-end gap-2" data-testid="agent-structure-actions">
                      <button type="button" onClick={() => composerRef.current?.focus()} className="h-8 rounded-lg border border-white/15 px-3 text-sm text-neutral-200 hover:bg-white/10">修正・補足する</button>
                      <button type="button" disabled={working} onClick={proceedToDesigns} className="h-8 rounded-lg bg-cyan-300 px-4 text-sm font-medium text-neutral-950 disabled:cursor-not-allowed disabled:bg-[#2c5e5b] disabled:text-neutral-400">{wording.proceed}</button>
                    </div>
                  )}
                  {task.proceed && (
                    <>
                      <UserBubble>{wording.proceed}</UserBubble>
                      {wording.proceedMessage(designCount) && <p>{wording.proceedMessage(designCount)}</p>}
                      <StepList testId="agent-design-steps" items={designSteps} />
                      {task.design?.state === 'running' && <StepSpinner label="考え中…" />}
                      {stepFailed(task.design?.state) && <ErrorRow onRetry={task.styleChoice ? undefined : retryDesign}>AIデザインの設計に失敗しました（{task.design?.errorCode ?? task.design?.state}）。</ErrorRow>}
                      {designs.length > 0 && (
                        <>
                          {agentDesignProgress(designs).map((message) => <p key={message}>{message}</p>)}
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="agent-design-images">
                            {designs.map((image) => (
                              <figure key={image.key} className="space-y-1">
                                <GeneratedTile image={image} url={imageUrls[image.requestId]} label={agentImageLabel(image)} className="aspect-[3/4] w-full"
                                  onRetry={task.styleChoice ? undefined : () => retryStyleImage(image.requestId)} />
                                <figcaption className="truncate text-xs text-neutral-400">{agentImageLabel(image)}</figcaption>
                              </figure>
                            ))}
                          </div>
                        </>
                      )}
                      {designsSettled && (
                        <>
                          <ReportCard testId="agent-design-report" title={wording.designReport.title} note={wording.designReport.note}
                            onOpen={() => showDeliverable('design')} onDownload={() => saveDeliverable('design')} />
                          <StylePicker images={designs} urls={imageUrls} chosen={task.styleChoice?.keys ?? null} disabled={working}
                            title={wording.pickTitle} hint={wording.pickHint} button={wording.pickButton} onConfirm={confirmStyles} />
                        </>
                      )}
                      <Notes notes={notes} stage="designs" />
                    </>
                  )}
                  {task.styleChoice && (
                    <>
                      <UserBubble testId="agent-style-choice">{[...designs.filter((image) => task.styleChoice!.keys.includes(image.key)).map(agentImageLabel), wording.pickButton].join('、')}</UserBubble>
                      <StepList testId="agent-final-steps" items={finalSteps} />
                      {task.final?.state === 'running' && <StepSpinner label="考え中…" />}
                      {stepFailed(task.final?.state) && <ErrorRow onRetry={retryFinal}>企画書の作成に失敗しました（{task.final?.errorCode ?? task.final?.state}）。</ErrorRow>}
                      {final && (
                        <>
                          <ReportCard testId="agent-final-report" title={wording.finalReport.title} note={wording.finalReport.note}
                            onOpen={() => showDeliverable('final')} onDownload={() => saveDeliverable('final')} />
                          {final.summary.length > 0 && (
                            <div className="space-y-2" data-testid="agent-final-summary">
                              <p>{final.summary[0]}</p>
                              {final.summary.length > 1 && <p className="pt-2 font-medium text-white">企画の要点</p>}
                              {final.summary.slice(1).map((line, index) => {
                                const match = /^([^：:]{1,14})[：:]\s*(.+)$/.exec(line);
                                return match ? <p key={index}><span className="font-medium text-white">{match[1]}：</span>{match[2]}</p> : <p key={index}>{line}</p>;
                              })}
                            </div>
                          )}
                        </>
                      )}
                      <Notes notes={notes} stage="final" />
                    </>
                  )}
                </>
              )}
              {!merch && task.choice && <p className="rounded-xl bg-white/5 px-4 py-3 text-sm text-neutral-300" data-testid="agent-choice">選択したテーマ：<span className="font-medium text-white">{task.choice.theme}</span></p>}
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
                </>
              )}
              {notice && <p role="alert" className="text-sm text-amber-300">{notice}</p>}
            </div>
          )}
        </div>
        {task && (
          // Light's input under the conversation: extra conditions or questions at any step, with 添付を追加 (ファイル / 画像).
          <form className="sticky bottom-0 mx-auto w-full max-w-[752px] bg-gradient-to-t from-[#171b1c] via-[#171b1c] to-transparent px-4 pb-4 pt-6" data-testid="agent-followup-composer"
            onSubmit={(event) => { event.preventDefault(); sendComposer(); }}>
            <div className="rounded-2xl border border-white/10 bg-[#262a2b] px-4 pb-3 pt-3 focus-within:border-cyan-300/50">
              <AgentAttachmentChips items={pendingAttachments} onRemove={(id) => setPendingAttachments((current) => current.filter((item) => item.id !== id))} />
              <textarea ref={composerRef} value={draft} disabled={working} onChange={(event) => setDraft(event.target.value)} rows={2}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendComposer(); } }}
                placeholder="条件を追加、または続けて質問…" aria-label="条件を追加、または続けて質問…"
                className="block w-full resize-none bg-transparent text-sm leading-6 text-white outline-none placeholder:text-neutral-500 disabled:cursor-not-allowed" />
              <div className="mt-2 flex items-center gap-3">
                <AgentAttachMenu brandId={brandId} disabled={working} count={(task.attachments ?? []).length + pendingAttachments.length} onBusy={setAttaching}
                  onAdd={(items) => setPendingAttachments((current) => [...current, ...items])} onError={(message) => setNotice(message)} />
                <span className="ml-auto text-xs text-neutral-500">Enterで送信・Shift+Enterで改行</span>
                <button type="submit" aria-label="送信" disabled={working || attaching || (!draft.trim() && !pendingAttachments.length)} className="flex size-10 items-center justify-center rounded-full bg-[#0bcabc] text-neutral-950 disabled:bg-[#2c5e5b] disabled:text-neutral-400">
                  {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </form>
        )}
      </section>
      {task && (panelOpen ? (
        // Light floats 概要 as a rounded card 12px from the window edges. It lists only the task's results: タスク成果物,
        // 参考スタイル and スタイルを生成 (conversation tasks), or 参考資料 with the cited sentence (テーマ企画).
        <aside aria-label="概要" className="hidden w-[337px] shrink-0 p-3 lg:block" data-testid="agent-summary-panel">
          <div className="relative h-full overflow-y-auto rounded-2xl border border-white/10 bg-[#262a2b] p-4 text-sm text-neutral-300">
          <button type="button" aria-label="概要を閉じる" onClick={() => setPanelOpen(false)} className="absolute right-3 top-3 rounded-md p-1.5 text-neutral-400 hover:bg-white/10"><PanelRightClose className="h-4 w-4" /></button>
          <h2 className="text-base font-medium text-white">概要</h2>
          {deliverables.length > 0 && (
            <div className="mt-5" data-testid="agent-task-deliverables">
              <h3 className="text-base font-medium text-white">タスク成果物</h3>
              <ul className="mt-2 space-y-2">
                {deliverables.map((entry) => (
                  <li key={entry.key}>
                    <button type="button" onClick={() => showDeliverable(entry.key)} className="flex w-full items-center gap-2 text-left text-xs text-neutral-200 hover:text-white" data-testid="agent-task-deliverable">
                      <Paperclip className="h-3.5 w-3.5 flex-none" /><span className="truncate">{entry.title}.html</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {conversation && referenceImages.length > 0 && <ImageShelf title="参考スタイル" testId="agent-reference-styles" stamp={stamp(task.directionImages?.images[0]?.at)} images={referenceImages} urls={imageUrls} />}
          {(conversation || dialogue) && generatedImages.length > 0 && <ImageShelf title="スタイルを生成" testId="agent-generated-styles" stamp={stamp(designs[0]?.at)} images={generatedImages} urls={imageUrls} />}
          {dialogue && dialogueSources && dialogueSources.sources.length > 0 && (
            <div className="mt-5 border-t border-white/10 pt-5">
              <h3 className="text-base font-medium text-white">参考資料</h3>
              <ol className="mt-2" data-testid="agent-dialogue-sources">
                {dialogueSources.sources.map((source) => (
                  <li key={source.url} className="border-b border-white/10 py-3 text-xs leading-5 last:border-b-0">
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cyan-300 hover:underline">{hostOf(source.url)}</a>
                    <span className="block text-neutral-300">{source.quote ?? source.title}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {!conversation && !dialogue && (
            <div className={deliverables.length ? 'mt-5 border-t border-white/10 pt-5' : 'mt-5'}>
              <h3 className="text-base font-medium text-white">参考資料</h3>
              {!roundSources && <p className="mt-2 text-xs leading-5 text-neutral-500">{agentThemeSearches(task) ? 'テーマができると、ウェブ検索で参照した資料がここに表示されます。' : 'Heavy Chainはウェブ検索を行いません。概要とテーマはAIモデルの知識に基づいて作成しています。'}</p>}
              {roundSources && roundSources.sources.length > 0 && (
                <ol className="mt-2" data-testid="agent-research-sources">
                  {roundSources.sources.map((source) => (
                    // Light: the site, then the sentence it was cited for, a line between sources.
                    <li key={source.url} className="border-b border-white/10 py-3 text-xs leading-5 last:border-b-0">
                      <a href={source.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cyan-300 hover:underline">{hostOf(source.url)}</a>
                      <span className="block text-neutral-300">{source.quote ?? source.title}</span>
                    </li>
                  ))}
                </ol>
              )}
              {roundSources && roundSources.sources.length === 0 && (
                <p className="mt-2 text-xs leading-5 text-neutral-500">{roundSources.search === 'ok' ? '参照した資料はありません。' : 'ウェブ検索を使えませんでした。テーマはAIモデルの知識に基づいて作成しています。'}</p>
              )}
            </div>
          )}
          </div>
        </aside>
      ) : (
        <button type="button" aria-label="概要を開く" onClick={() => setPanelOpen(true)} className="absolute right-3 top-[62px] hidden rounded-md p-1.5 text-neutral-400 hover:bg-white/10 lg:block"><PanelRightOpen className="h-4 w-4" /></button>
      ))}
      {report && <ReportModal report={report} onClose={() => setReport(null)} />}
    </main>
  );
}

/** Light's 参考スタイル / スタイルを生成 in 概要: the time, four thumbnails to a row, 「すべて表示」 to see every one. */
function ImageShelf({ title, testId, stamp, images, urls }: { title: string; testId: string; stamp: string; images: AgentStyleImage[]; urls: Record<string, string> }) {
  const [all, setAll] = useState(false);
  const shown = all ? images : images.slice(0, 8);
  return (
    <div className="mt-5 border-t border-white/10 pt-5" data-testid={testId}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium text-white">{title}</h3>
        {images.length > 8 && <button type="button" onClick={() => setAll((value) => !value)} className="flex items-center text-xs text-neutral-300 hover:text-white">{all ? '閉じる' : 'すべて表示'}<ChevronRight className="h-3.5 w-3.5" /></button>}
      </div>
      {stamp && <p className="mt-2 text-xs text-neutral-400">{stamp}</p>}
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {shown.map((image) => <img key={image.requestId} src={urls[image.requestId]} alt={agentImageLabel(image)} title={agentImageLabel(image)} className="aspect-[3/4] w-full rounded-md object-cover" />)}
      </div>
    </div>
  );
}
