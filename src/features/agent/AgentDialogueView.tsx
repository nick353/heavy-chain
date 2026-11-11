import { useEffect, useRef, useState } from 'react';
import { Box, Check, Loader2, RefreshCw } from 'lucide-react';
import { AssistantQuestionCard } from '../designDetail/AssistantQuestionCard';
import type { AssistantQuestion } from '../designDetail/assistantQuestions';
import { foundImageFile, searchReferenceImages, type FoundImage } from '../designDetail/referenceImageSearch';
import { AGENT_IMAGE_ACCEPT, AgentAttachmentError, uploadAgentImage } from './agentAttachments';
import { AgentAttachmentChips } from './AgentAttachMenu';
import { ErrorRow, GeneratedTile, StepList, StepSpinner, UserBubble } from './AgentParts';
import {
  agentDialogueProgress, agentDialogueResultLead, agentDialogueWaiting, parseAgentDialogueReply, type AgentDialogueSearch,
} from './agentDialogue';
import type { AgentAttachment, AgentStyleImage, AgentTask } from './agentFlow';

const PICK_LIMIT = 8;
const settled = (image: AgentStyleImage) => image.state !== 'pending' && image.state !== 'running';

/**
 * Light's 「デザイン依頼」 picker under a reference image search: each topic's found images (Wikimedia Commons, freely
 * licensed), 全選択, 素材を追加選択 (the user's own images) and 企画を生成 / 次へ. Going on without a pick is allowed; the
 * assistant then asks how to continue, as Light does.
 */
function AgentImagePicker({ searches, active, button, brandId, onConfirm, onError }: {
  searches: AgentDialogueSearch[]; active: boolean; button: string; brandId: string | null;
  onConfirm: (picked: AgentAttachment[]) => void; onError: (message: string) => void;
}) {
  const [results, setResults] = useState<Array<FoundImage[] | 'loading' | 'failed'>>(() => searches.map(() => 'loading'));
  const [chosen, setChosen] = useState<FoundImage[]>([]);
  const [own, setOwn] = useState<AgentAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const key = searches.map((search) => search.query).join('|');
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    searches.forEach((search, index) => {
      searchReferenceImages(search.query, { limit: 4, signal: controller.signal })
        .then((images) => setResults((current) => current.map((item, at) => at === index ? (images.length ? images : 'failed') : item)))
        .catch(() => { if (!controller.signal.aborted) setResults((current) => current.map((item, at) => at === index ? 'failed' : item)); });
    });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one saved reply's searches never change
  }, [key, active]);
  const found = results.flatMap((item) => Array.isArray(item) ? item : []);
  const room = PICK_LIMIT - own.length;
  const allChosen = found.length > 0 && found.slice(0, room).every((image) => chosen.some((item) => item.id === image.id));
  const toggle = (image: FoundImage) => setChosen((current) => current.some((item) => item.id === image.id)
    ? current.filter((item) => item.id !== image.id) : current.length >= room ? current : [...current, image]);
  const addOwn = async (files: FileList | null) => {
    if (!files?.length || !brandId) return;
    setBusy(true);
    const added: AgentAttachment[] = [];
    for (const file of Array.from(files).slice(0, Math.max(0, PICK_LIMIT - own.length - chosen.length))) {
      try { added.push(await uploadAgentImage(brandId, file)); }
      catch (error) { onError(error instanceof AgentAttachmentError ? error.message : `${file.name} を追加できませんでした`); }
    }
    setOwn((current) => [...current, ...added]);
    setBusy(false);
  };
  const confirm = async () => {
    if (!brandId) return;
    setBusy(true);
    const picked: AgentAttachment[] = [...own];
    for (const image of chosen) {
      // The chosen found image is stored as the brand's image so it travels with the next requests as a reference.
      try { const file = await foundImageFile(image); picked.push({ ...(await uploadAgentImage(brandId, file)), name: image.title.slice(0, 120) }); }
      catch { onError(`${image.title} を取り込めませんでした`); }
    }
    setBusy(false);
    onConfirm(picked);
  };
  return (
    <section className="rounded-2xl border border-white/10 bg-[#202426] p-4" data-testid="agent-dialogue-picker">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-base font-medium text-white"><Box className="h-5 w-5 text-cyan-300" />デザイン依頼</span>
        <span className={`rounded-md border px-2 py-0.5 text-xs ${active ? 'border-amber-400/70 text-amber-300' : 'border-emerald-400/60 text-emerald-300'}`}>{active ? '確認待ち' : '確認済み'}</span>
      </div>
      {searches.map((search, index) => {
        const list = results[index];
        return (
          <div key={search.query} className={index ? 'mt-4' : ''}>
            <p className="text-sm text-neutral-100">【{search.title}】お好みの構図・スタイルをお選びください（複数選択可）</p>
            {!active ? null : list === 'loading' ? <p className="mt-2 flex items-center gap-2 text-xs text-neutral-400"><RefreshCw className="h-3.5 w-3.5 animate-spin" />検索中...</p>
              : list === 'failed' ? <p className="mt-2 text-xs text-neutral-400">参考画像が見つかりませんでした</p>
              : <div className="mt-2 grid grid-cols-4 gap-2">{list.map((image) => {
                const checked = chosen.some((item) => item.id === image.id);
                return (
                  <button key={image.id} type="button" disabled={busy} data-testid="agent-dialogue-search-image" aria-pressed={checked} title={`${image.title}${image.license ? `（${image.license}）` : ''}`}
                    onClick={() => toggle(image)} className={`relative aspect-square overflow-hidden rounded-lg border-2 ${checked ? 'border-[#0bcabc]' : 'border-transparent'} bg-white/5`}>
                    <img src={image.thumbUrl} alt={image.title} loading="lazy" className="h-full w-full object-cover" />
                    {checked && <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#0bcabc]"><Check className="h-3 w-3 text-neutral-950" /></span>}
                  </button>
                );
              })}</div>}
          </div>
        );
      })}
      {active && (
        <>
          {own.length > 0 && <div className="mt-3"><AgentAttachmentChips items={own} onRemove={(id) => setOwn((current) => current.filter((item) => item.id !== id))} /></div>}
          <p className="mt-3 text-[10px] text-neutral-500">画像: Wikimedia Commons（各画像のライセンスに従います）</p>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <button type="button" disabled={busy || !found.length} onClick={() => setChosen(allChosen ? [] : found.slice(0, room))}
              className="h-8 rounded-lg border border-white/15 px-3 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-50">{allChosen ? '選択を解除' : '全選択'}</button>
            <button type="button" disabled={busy || !brandId || own.length + chosen.length >= PICK_LIMIT} onClick={() => fileRef.current?.click()}
              className="h-8 rounded-lg border border-white/15 px-3 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-50">素材を追加選択</button>
            <button type="button" data-testid="agent-dialogue-picker-confirm" disabled={busy || !brandId} onClick={() => void confirm()}
              className="flex h-8 items-center gap-1 rounded-lg bg-cyan-300 px-4 text-xs font-medium text-neutral-950 disabled:cursor-not-allowed disabled:bg-[#2c5e5b] disabled:text-neutral-400">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{button}
            </button>
          </div>
          <input ref={fileRef} type="file" accept={AGENT_IMAGE_ACCEPT} multiple aria-label="追加する素材を選択" className="sr-only" tabIndex={-1}
            onChange={(event) => { const files = event.target.files; void addOwn(files); event.target.value = ''; }} />
        </>
      )}
    </section>
  );
}

/** The generated styles under the progress lines, then Light's 「デザイン成果展示」 grouped by wave (or proposal). */
function DialogueResults({ task, urls, onRetryImage }: { task: AgentTask; urls: Record<string, string>; onRetryImage: (requestId: string) => void }) {
  const designs = task.designs ?? [];
  const plan = task.dialogueStart ? (task.turns ?? []).find((turn) => turn.id === task.dialogueStart!.plan) : null;
  const reply = plan?.step?.content ? parseAgentDialogueReply(plan.step.content) : null;
  const done = designs.length > 0 && designs.every(settled);
  const groups: Array<{ name: string; images: AgentStyleImage[] }> = [];
  for (const image of designs) {
    const last = groups[groups.length - 1];
    if (last && last.name === image.category) last.images.push(image); else groups.push({ name: image.category, images: [image] });
  }
  const lead = agentDialogueResultLead(task, reply?.series ?? '', designs.length, groups.length);
  const logicOf = (image: AgentStyleImage) => reply?.skus.find((sku) => sku.code === image.code)?.logic ?? '';
  const square = task.scene === 'AIグラフィックデザイン';
  return (
    <div className="space-y-4" data-testid="agent-dialogue-results">
      <StepList testId="agent-dialogue-progress" items={agentDialogueProgress(designs)} />
      {!done && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {designs.map((image) => <GeneratedTile key={image.key} image={image} url={urls[image.requestId]} label={`${image.code} · ${image.name}`} className={`${square ? 'aspect-square' : 'aspect-[3/4]'} w-full`} />)}
        </div>
      )}
      {done && (
        <>
          <p className="font-medium text-white">{lead.title}</p>
          <p>{lead.lead}</p>
          {groups.map((group) => (
            <section key={group.name} className="space-y-3">
              {group.name && <p className="font-medium text-white">【{group.name}】</p>}
              {group.images.map((image) => (
                <figure key={image.key} className="flex gap-3" data-testid="agent-dialogue-result">
                  <GeneratedTile image={image} url={urls[image.requestId]} label={`${image.code} · ${image.name}`} onRetry={() => onRetryImage(image.requestId)}
                    className={`${square ? 'aspect-square' : 'aspect-[3/4]'} w-32 flex-none`} />
                  <figcaption className="min-w-0 text-sm leading-6">
                    <p className="font-medium text-white">{/^[A-Z]-/.test(image.code) ? image.code : `SKU #${image.code}`}：{image.name}</p>
                    {logicOf(image) && <p className="text-neutral-300"><span className="text-neutral-400">{lead.logicLabel}：</span>{logicOf(image)}</p>}
                  </figcaption>
                </figure>
              ))}
            </section>
          ))}
          <p>以上、{reply?.series ? `【${reply.series}】` : ''}全{designs.length}{square ? '枚' : '款'}のデザイン成果となります。</p>
        </>
      )}
    </div>
  );
}

/**
 * Light's インスピレーション / AIグラフィックデザイン chat: the user's messages on the right, the assistant's replies with
 * their form ([Q]), image picker ([S]) and, after 「開始」, the generated styles.
 */
export function AgentDialogueView({ task, brandId, working, urls, attachments, onAnswer, onPick, onRetry, onRetryImage, onError }: {
  task: AgentTask; brandId: string | null; working: boolean; urls: Record<string, string>; attachments: AgentAttachment[];
  onAnswer: (questions: AssistantQuestion[], answers: string[][]) => void; onPick: (picked: AgentAttachment[]) => void;
  onRetry: (turnId: string) => void; onRetryImage: (requestId: string) => void; onError: (message: string) => void;
}) {
  const turns = task.turns ?? [];
  const lastId = turns.at(-1)?.id;
  const button = task.scene === 'AIグラフィックデザイン' ? '企画を生成' : '次へ';
  return (
    <div className="space-y-6" data-testid="agent-dialogue">
      {turns.length === 0 && <StepSpinner label={(task.attachments ?? []).some((item) => item.kind === 'image') ? '参考画像を解析し、デザイン要素を抽出しています…' : '依頼内容を確認しています…'} />}
      {turns.map((turn) => {
        const last = turn.id === lastId;
        const after = task.dialogueStart?.after === turn.id ? <DialogueResults task={task} urls={urls} onRetryImage={onRetryImage} /> : null;
        if (turn.role === 'user') {
          const files = attachments.filter((item) => turn.attachments?.includes(item.id));
          return (
            <div key={turn.id} className="space-y-2" data-testid="agent-dialogue-user">
              {turn.text && <UserBubble>{turn.text}</UserBubble>}
              {files.length > 0 && <div className="flex justify-end"><AgentAttachmentChips items={files} /></div>}
              {after}
            </div>
          );
        }
        const step = turn.step;
        if (!step || step.state === 'running') return <div key={turn.id}><StepSpinner label={agentDialogueWaiting(task, turn)} />{after}</div>;
        if (step.state !== 'completed' || !step.content) {
          return (
            <div key={turn.id}>
              {last ? <ErrorRow onRetry={() => onRetry(turn.id)}>返答を受け取れませんでした（{step.errorCode ?? step.state}）。</ErrorRow> : null}
              {after}
            </div>
          );
        }
        const reply = parseAgentDialogueReply(step.content);
        const answerable = last && !working;
        return (
          <article key={turn.id} className="space-y-4" data-testid="agent-dialogue-reply">
            {reply.body && <div className="whitespace-pre-wrap">{reply.body}</div>}
            {reply.questions.length > 0 && last && <AssistantQuestionCard questions={reply.questions} disabled={!answerable} intro={null} onConfirm={(answers) => onAnswer(reply.questions, answers)} />}
            {reply.searches.length > 0 && <AgentImagePicker searches={reply.searches} active={answerable} button={button} brandId={brandId} onConfirm={onPick} onError={onError} />}
            {after}
          </article>
        );
      })}
    </div>
  );
}
