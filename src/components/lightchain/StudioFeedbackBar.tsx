import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { cloudflareDataPlane } from '../../lib/cloudflareApi';
import {
  STUDIO_FEEDBACK_IMPROVE_MAX, STUDIO_FEEDBACK_OTHER, STUDIO_FEEDBACK_REMARK_MAX, STUDIO_FEEDBACK_TEXT, dislikeStudioFeedback, emptyStudioFeedback,
  likeStudioFeedback, studioFeedbackFromRows, studioFeedbackPopoverBelow, studioFeedbackReasons, submitStudioFeedbackImprove,
  submitStudioFeedbackReasons, toggleStudioFeedbackReason, type StudioFeedbackFunction, type StudioFeedbackSave, type StudioFeedbackState,
  type StudioFeedbackStep,
} from '../../lib/studioFeedback';

type StudioFeedbackApi = {
  list(documentId: string): Promise<{ feedback?: unknown[] }>;
  save(documentId: string, objectId: string, body: StudioFeedbackSave): Promise<unknown>;
};
const defaultApi: StudioFeedbackApi | null = cloudflareDataPlane ? {
  list: documentId => cloudflareDataPlane!.listStudioFeedback(documentId),
  save: (documentId, objectId, body) => cloudflareDataPlane!.saveStudioFeedback(documentId, objectId, body),
} : null;

/** プロジェクトごとに1回だけ読み、押した内容はこの画面の中でも覚える（結果を選び直しても塗りつぶしが戻る）。 */
const loadedDocuments = new Map<string, Promise<Map<string, StudioFeedbackState>>>();
const localStates = new Map<string, StudioFeedbackState>();
const stateKey = (documentId: string, objectId: string) => JSON.stringify([documentId, objectId]);
const loadDocument = (api: StudioFeedbackApi, documentId: string) => {
  let pending = loadedDocuments.get(documentId);
  if (!pending) {
    pending = api.list(documentId).then(result => studioFeedbackFromRows(result.feedback ?? []));
    pending.catch(() => loadedDocuments.delete(documentId));
    loadedDocuments.set(documentId, pending);
  }
  return pending;
};

/**
 * 本家のスタジオで生成結果を選んだときの下の帯: 👍（GOOD）👎（BAD）｜フィードバックする｜再生成。
 * 再生成は入力欄のある結果だけに出す（onRegenerate を渡したとき）。
 */
export function StudioFeedbackBar({ documentId, objectId, fn, onRegenerate, regenerateDisabled, api = defaultApi }: {
  documentId: string;
  objectId: string;
  fn: StudioFeedbackFunction | null;
  onRegenerate?: () => void;
  regenerateDisabled?: boolean;
  api?: StudioFeedbackApi | null;
}) {
  const key = stateKey(documentId, objectId);
  const [feedback, setFeedback] = useState<{ key: string; state: StudioFeedbackState }>(() => ({ key, state: localStates.get(key) ?? emptyStudioFeedback() }));
  const state = feedback.key === key ? feedback.state : localStates.get(key) ?? emptyStudioFeedback();
  const [popover, setPopover] = useState<'reasons' | 'improve' | null>(null);
  const [below, setBelow] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dislikeRef = useRef<HTMLButtonElement>(null);
  const reasonsRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const touchedRef = useRef('');

  // 開き直したときに、保存された👍👎と理由を戻す（この画面で押した後なら、押した内容が先）。
  useEffect(() => {
    setPopover(null);
    if (!api || !documentId || !objectId) return;
    let live = true;
    void loadDocument(api, documentId).then(states => {
      if (!live || touchedRef.current === key) return;
      const saved = localStates.get(key) ?? states.get(objectId);
      if (saved) setFeedback({ key, state: saved });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [api, documentId, objectId, key]);

  // 窓の外を押すと閉じる（本家と同じ）。
  useEffect(() => {
    if (!popover) return;
    const close = (event: MouseEvent) => { if (!containerRef.current?.contains(event.target as Node)) setPopover(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [popover]);

  useLayoutEffect(() => {
    if (popover !== 'reasons') return;
    const anchor = dislikeRef.current?.getBoundingClientRect(), box = reasonsRef.current?.getBoundingClientRect();
    if (anchor && box) setBelow(studioFeedbackPopoverBelow(anchor.top, box.height));
  }, [popover, state.reasons.includes(STUDIO_FEEDBACK_OTHER)]);

  const apply = (step: StudioFeedbackStep, notify: boolean) => {
    touchedRef.current = key;
    localStates.set(key, step.state);
    setFeedback({ key, state: step.state });
    if (!step.save || !api || !documentId || !objectId) return;
    savingRef.current = true;
    void api.save(documentId, objectId, step.save).then(() => {
      void loadedDocuments.get(documentId)?.then(states => { states.set(objectId, step.state); }).catch(() => undefined);
      if (notify) toast.success(STUDIO_FEEDBACK_TEXT.sent);
    }).catch(() => toast.error(STUDIO_FEEDBACK_TEXT.failed)).finally(() => { savingRef.current = false; });
  };
  const edit = (next: StudioFeedbackState) => { touchedRef.current = key; localStates.set(key, next); setFeedback({ key, state: next }); };

  const like = () => { setPopover(null); if (!savingRef.current) apply(likeStudioFeedback(state, fn), false); };
  const dislike = () => { setPopover('reasons'); if (!savingRef.current) apply(dislikeStudioFeedback(state, fn), false); };
  const reasons = studioFeedbackReasons(fn);
  const iconButton = 'fashion-studio-feedback-icon';

  return (
    <div ref={containerRef} className="flex items-center" data-testid="studio-feedback-bar">
      <button type="button" className={iconButton} aria-label={STUDIO_FEEDBACK_TEXT.good} title={STUDIO_FEEDBACK_TEXT.good} aria-pressed={state.direction === 1}
        data-testid="studio-feedback-like" onClick={event => { event.stopPropagation(); like(); }}>
        <ThumbsUp className="h-5 w-5" fill={state.direction === 1 ? 'currentColor' : 'none'} />
      </button>
      <button ref={dislikeRef} type="button" className={iconButton} aria-label={STUDIO_FEEDBACK_TEXT.bad} title={STUDIO_FEEDBACK_TEXT.bad} aria-pressed={state.direction === 0}
        aria-expanded={popover === 'reasons'} data-testid="studio-feedback-dislike" onClick={event => { event.stopPropagation(); dislike(); }}>
        <ThumbsDown className="h-5 w-5" fill={state.direction === 0 ? 'currentColor' : 'none'} />
      </button>
      <span className="fashion-studio-node-toolbar-divider" aria-hidden="true" />
      <div className="relative">
        <button type="button" aria-expanded={popover === 'improve'} data-testid="studio-feedback-improve"
          className={popover === 'improve' ? 'is-active' : ''} onClick={event => { event.stopPropagation(); setPopover('improve'); }}>{STUDIO_FEEDBACK_TEXT.improve}</button>
        {popover === 'improve' && <div role="dialog" aria-label={STUDIO_FEEDBACK_TEXT.improve} className="fashion-studio-feedback-popover is-improve" data-testid="studio-feedback-improve-popover"
          onClick={event => event.stopPropagation()}>
          <textarea value={state.improve} maxLength={STUDIO_FEEDBACK_IMPROVE_MAX} placeholder={STUDIO_FEEDBACK_TEXT.improvePlaceholder} aria-label={STUDIO_FEEDBACK_TEXT.improve}
            onChange={event => edit({ ...state, improve: event.target.value })} />
          <div className="flex justify-end">
            <button type="button" className="fashion-studio-feedback-primary is-small" data-testid="studio-feedback-improve-submit"
              onClick={() => { setPopover(null); if (!savingRef.current) apply(submitStudioFeedbackImprove(state, fn), true); }}>{STUDIO_FEEDBACK_TEXT.send}</button>
          </div>
        </div>}
      </div>
      {onRegenerate && <>
        <span className="fashion-studio-node-toolbar-divider" aria-hidden="true" />
        <button type="button" disabled={regenerateDisabled} onClick={onRegenerate}>{STUDIO_FEEDBACK_TEXT.regenerate}</button>
      </>}
      {popover === 'reasons' && <div ref={reasonsRef} role="dialog" aria-label={STUDIO_FEEDBACK_TEXT.bad} data-testid="studio-feedback-reasons"
        className={`fashion-studio-feedback-popover is-reasons${below ? ' is-below' : ''}`} onClick={event => event.stopPropagation()}>
        <div className="flex flex-wrap items-center">
          {reasons.map(reason => <button key={reason} type="button" aria-pressed={state.reasons.includes(reason)} data-testid="studio-feedback-reason"
            className={`fashion-studio-feedback-reason${state.reasons.includes(reason) ? ' is-selected' : ''}`}
            onClick={() => edit(toggleStudioFeedbackReason(state, reason))}>{reason}</button>)}
          {state.reasons.includes(STUDIO_FEEDBACK_OTHER) && <textarea rows={2} value={state.remark} maxLength={STUDIO_FEEDBACK_REMARK_MAX}
            placeholder={STUDIO_FEEDBACK_TEXT.remarkPlaceholder} aria-label={STUDIO_FEEDBACK_TEXT.remarkPlaceholder} data-testid="studio-feedback-remark"
            className="fashion-studio-feedback-remark" onChange={event => edit({ ...state, remark: event.target.value })} />}
        </div>
        <div className="flex w-full items-center justify-end gap-x-2">
          <button type="button" className="fashion-studio-feedback-secondary" onClick={() => setPopover(null)}>{STUDIO_FEEDBACK_TEXT.cancel}</button>
          <button type="button" className="fashion-studio-feedback-primary" data-testid="studio-feedback-reasons-submit"
            onClick={() => { setPopover(null); if (!savingRef.current) apply(submitStudioFeedbackReasons(state, fn), true); }}>{STUDIO_FEEDBACK_TEXT.send}</button>
        </div>
      </div>}
    </div>
  );
}
