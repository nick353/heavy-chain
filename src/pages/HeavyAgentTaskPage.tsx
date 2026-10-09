import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Check, Loader2, PanelRightClose, PanelRightOpen, RotateCcw } from 'lucide-react';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { generateImage } from '../lib/imageApi';
import { HEAVY_IMAGE_PROVIDER } from '../lib/heavyImageProvider';
import { resolveGeneratedImageUrlWithStatus } from '../lib/storage';
import { isHeavyWorkspaceBrandName, isHeavyWorkspaceRuntime } from '../lib/heavyWorkspace';
import { useAuthStore } from '../stores/authStore';
import { AgentSidebar } from '../features/agent/AgentSidebar';
import {
  agentConversationId, agentImagePrompt, assistantStepFrom, isAutomaticAgentTaskTitle, loadAgentTask, parsePlanResponse, parseThemeResponse, planPrompt, themePrompt, updateAgentTask,
  type AgentAssistantStep, type AgentImageStep, type AgentTask, type AgentTaskDocument,
} from '../features/agent/agentTasks';

const NONE = 'どれも気に入らない';
const api = () => { if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured'); return cloudflareDataPlane; };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

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

/**
 * /agent/:taskId — one planning task. Steps advance automatically; every request identity is stored on the task
 * before it is sent, so a reload only reads back the in-flight request and never sends it twice.
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
  const docRef = useRef<AgentTaskDocument | null>(null);
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  const busy = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  /** One automatic step at a time; when it settles the advance effect runs again. */
  const guard = useCallback((work: () => Promise<unknown>, failure?: string) => {
    if (busy.current) return;
    busy.current = true;
    void work().catch(() => { if (failure && mounted.current) setNotice(failure); })
      .finally(() => { busy.current = false; if (mounted.current) setTick((value) => value + 1); });
  }, []);

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

  const runAssistant = useCallback(async (kind: 'theme' | 'plan', step: AgentAssistantStep, prompt: string | null, apply: (task: AgentTask, step: AgentAssistantStep) => AgentTask) => {
    if (inFlight.current.has(step.requestId) || !brandId) return;
    inFlight.current.add(step.requestId);
    const conversationId = agentConversationId(taskId, kind === 'theme' ? `theme-${step.requestId.slice(0, 8)}` : 'plan');
    try {
      let result = step;
      if (prompt) {
        const receipt = await api().sendDesignAssistantRequest({ requestId: step.requestId, brandId, projectId: taskId, conversationId, prompt, history: [], references: [] });
        result = assistantStepFrom(receipt, step.requestId);
      }
      if (result.state === 'running') result = await pollAssistant(result, conversationId);
      if (result.state !== 'running') await commit((task) => apply(task, result));
    } catch {
      // The request may still have reached the server; reading it back on the next visit decides, it is not re-sent.
      if (mounted.current) setNotice('通信が中断されました。再読み込みすると続きを確認します。');
    } finally { inFlight.current.delete(step.requestId); }
  }, [brandId, commit, pollAssistant, taskId]);

  const startThemeRound = useCallback(async () => {
    const requestId = crypto.randomUUID();
    const step: AgentAssistantStep = { requestId, state: 'running' };
    const saved = await commit((task) => ({ ...task, rounds: [...task.rounds, { step, summary: '', themes: [] }] }));
    const prompt = themePrompt({ ...saved.task, rounds: saved.task.rounds.slice(0, -1) });
    await runAssistant('theme', step, prompt, (task, result) => ({ ...task, rounds: task.rounds.map((round) => round.step.requestId !== requestId ? round
      : { step: result, ...(result.state === 'completed' && result.content ? parseThemeResponse(result.content) : { summary: '', themes: [] }) }) }));
  }, [commit, runAssistant]);

  const startPlan = useCallback(async (theme: string) => {
    const requestId = crypto.randomUUID();
    const step: AgentAssistantStep = { requestId, state: 'running' };
    const saved = await commit((task) => ({ ...task, plan: step }));
    await runAssistant('plan', step, planPrompt(saved.task, theme), (task, result) => ({ ...task, plan: result }));
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
    const lastRound = task.rounds[task.rounds.length - 1];
    if (!lastRound) { guard(startThemeRound, 'タスクを開始できませんでした。'); return; }
    if (lastRound.step.state === 'running') {
      guard(() => runAssistant('theme', lastRound.step, null, (current, result) => ({ ...current, rounds: current.rounds.map((round) => round.step.requestId !== result.requestId ? round
        : { step: result, ...(result.state === 'completed' && result.content ? parseThemeResponse(result.content) : { summary: '', themes: [] }) }) })));
      return;
    }
    if (!task.choice) return;
    if (!task.plan) { const theme = task.choice.theme; guard(() => startPlan(theme), '企画書の作成を開始できませんでした。'); return; }
    if (task.plan.state === 'running') { const step = task.plan; guard(() => runAssistant('plan', step, null, (current, result) => ({ ...current, plan: result }))); return; }
    if (task.plan.state !== 'completed' || !task.plan.content) return;
    const parsed = parsePlanResponse(task.plan.content);
    if (parsed.title && doc.title !== parsed.title && isAutomaticAgentTaskTitle(doc.title, task)) { const title = parsed.title; guard(() => commit((current) => current, { title })); return; }
    if (!task.image) { const theme = task.choice.theme; guard(() => startImage(parsed.imagePrompt ?? `Apparel planning mood board for a womenswear collection, ${theme}, fabric swatches, color palette, editorial photo`)); return; }
    if (task.image.state === 'running') { const step = task.image; guard(() => reconcileImage(step)); }
  }, [doc, brandId, status, tick, guard, startThemeRound, startPlan, startImage, reconcileImage, runAssistant, commit]);

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

  const task = doc?.task ?? null;
  const plan = task?.plan?.state === 'completed' && task.plan.content ? parsePlanResponse(task.plan.content) : null;
  const done = Boolean(task?.image?.state === 'completed');
  const statusLabel = !task ? '' : done ? '完了' : task.choice ? '作成中' : task.rounds.at(-1)?.step.state === 'completed' ? '確認待ち' : '調査中';

  return (
    <main className="dark flex h-[calc(100vh-50px)] min-h-full bg-[#171b1c] text-white" data-testid="agent-task-page"
      data-agent-task={doc?.id ?? ''} data-agent-status={statusLabel} data-agent-plan={task?.plan?.requestId ?? ''} data-agent-image={task?.image?.jobId ?? ''}>
      <AgentSidebar title={task?.subtype ?? 'インスピレーションワークスペース'} activeTaskId={doc?.id ?? taskId} refreshKey={`${doc?.id}:${doc?.title}`} onNewTask={() => navigate('/agent')} />
      <section className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-[672px] px-4 py-10">
          {status === 'loading' && <StepSpinner label="タスクを読み込んでいます…" />}
          {status === 'missing' && <div role="alert" className="rounded-xl border border-white/10 bg-[#202426] p-6 text-sm text-neutral-300">このタスクは見つかりません。<button type="button" onClick={() => navigate('/agent')} className="ml-2 text-cyan-300 underline">新規タスクへ</button></div>}
          {task && (
            <div className="space-y-8 text-[15px] leading-7 text-neutral-200">
              <h1 className="text-xl font-semibold leading-8 text-white" data-testid="agent-task-prompt">{task.prompt}</h1>
              {/* The first round only appears once the request is admitted; show progress before that too. */}
              {task.rounds.length === 0 && !done && !notice && <StepSpinner label="市場とトレンドを整理し、テーマを考えています…" />}
              {task.rounds.map((round, index) => {
                const last = index === task.rounds.length - 1;
                const confirmed = !last || Boolean(task.choice);
                return (
                  <article key={round.step.requestId} className="space-y-4" data-testid="agent-theme-round">
                    {round.step.state === 'running' && <StepSpinner label="市場とトレンドを整理し、テーマを考えています…" />}
                    {(round.step.state === 'failed' || round.step.state === 'unknown') && (
                      <div role="alert" className="flex items-center justify-between rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
                        テーマの提案に失敗しました（{round.step.errorCode ?? round.step.state}）。
                        {last && !task.choice && <button type="button" onClick={() => void retryThemes()} className="flex items-center gap-1 rounded-lg border border-white/20 px-3 py-1 text-white hover:bg-white/10"><RotateCcw className="h-3.5 w-3.5" />再試行</button>}
                      </div>
                    )}
                    {round.summary && <div className="whitespace-pre-wrap" data-testid="agent-summary">{round.summary}</div>}
                    {round.step.state === 'completed' && round.themes.length > 0 && (
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
              {task.choice && <p className="rounded-xl bg-white/5 px-4 py-3 text-sm text-neutral-300" data-testid="agent-choice">選択したテーマ：<span className="font-medium text-white">{task.choice.theme}</span></p>}
              {task.plan?.state === 'running' && <StepSpinner label="企画書を作成しています…" />}
              {(task.plan?.state === 'failed' || task.plan?.state === 'unknown') && (
                <div role="alert" className="flex items-center justify-between rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">企画書の作成に失敗しました。
                  <button type="button" onClick={() => void retryPlan()} className="flex items-center gap-1 rounded-lg border border-white/20 px-3 py-1 text-white hover:bg-white/10"><RotateCcw className="h-3.5 w-3.5" />再試行</button></div>
              )}
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
              {task.image?.state === 'failed' && <div role="alert" className="flex items-center justify-between rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">企画ビジュアルの生成に失敗しました。
                <button type="button" onClick={() => void retryImage()} className="flex items-center gap-1 rounded-lg border border-white/20 px-3 py-1 text-white hover:bg-white/10"><RotateCcw className="h-3.5 w-3.5" />再試行</button></div>}
              {task.image?.state === 'completed' && (
                <figure className="overflow-hidden rounded-2xl border border-white/10 bg-[#202426]" data-testid="agent-visual">
                  {imageUrl ? <img src={imageUrl} alt="企画ビジュアル" className="w-full object-contain" /> : <div className="h-64 animate-pulse bg-white/5" />}
                  <figcaption className="px-4 py-2 text-xs text-neutral-400">企画ビジュアル</figcaption>
                </figure>
              )}
              {notice && <p role="alert" className="text-sm text-amber-300">{notice}</p>}
            </div>
          )}
        </div>
      </section>
      {task && (panelOpen ? (
        <aside aria-label="概要" className="relative hidden w-[320px] shrink-0 overflow-y-auto border-l border-white/10 bg-[#1d2122] p-5 text-sm text-neutral-300 lg:block" data-testid="agent-summary-panel">
          <button type="button" aria-label="概要を閉じる" onClick={() => setPanelOpen(false)} className="absolute right-3 top-3 rounded-md p-1.5 text-neutral-400 hover:bg-white/10"><PanelRightClose className="h-4 w-4" /></button>
          <h2 className="text-base font-medium text-white">概要</h2>
          <dl className="mt-4 space-y-3">
            <div><dt className="text-xs text-neutral-500">業務シーン</dt><dd>{task.scene}（{task.subtype}）</dd></div>
            <div><dt className="text-xs text-neutral-500">ステータス</dt><dd>{statusLabel}</dd></div>
            {task.choice && <div><dt className="text-xs text-neutral-500">テーマ</dt><dd>{task.choice.theme}</dd></div>}
            <div><dt className="text-xs text-neutral-500">作成日</dt><dd>{new Date(task.createdAt).toLocaleString('ja-JP')}</dd></div>
            {task.profile && <div><dt className="text-xs text-neutral-500">業務プリファレンス</dt><dd className="whitespace-pre-wrap">{task.profile}</dd></div>}
          </dl>
          <h2 className="mt-6 text-base font-medium text-white">参考資料</h2>
          <p className="mt-2 text-xs leading-5 text-neutral-500">Heavy Chainはウェブ検索を行いません。概要とテーマはAIモデルの知識に基づいて作成しています。</p>
        </aside>
      ) : (
        <button type="button" aria-label="概要を開く" onClick={() => setPanelOpen(true)} className="absolute right-3 top-[62px] hidden rounded-md p-1.5 text-neutral-400 hover:bg-white/10 lg:block"><PanelRightOpen className="h-4 w-4" /></button>
      ))}
    </main>
  );
}
