import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, MessageSquare, Mic, RefreshCw, Square, Trash2, X, Send, ThumbsUp } from 'lucide-react';
import { Button } from './index';
import toast from 'react-hot-toast';
import { cloudflareDataPlane } from '../../lib/cloudflareApi';
import { useAuthStore } from '../../stores/authStore';

interface FeedbackFormProps {
  isOpen: boolean;
  onClose: () => void;
  screenshot: FeedbackScreenshotState;
  onRecapture: () => Promise<void>;
}

type FeedbackType = 'lost' | 'cutout' | 'result' | 'save' | 'speed' | 'other';
type ScreenshotCaptureStatus = 'captured' | 'screenshot_capture_failed' | 'screenshot_upload_failed';

interface FeedbackScreenshotState {
  dataUrl: string | null;
  status: ScreenshotCaptureStatus;
  isCapturing: boolean;
  error: string | null;
}

const MAX_SCREENSHOT_DATA_URL_LENGTH = 6_500_000;
/** The API keeps voice memos up to 4 MiB; three minutes of speech stays well below that. */
const MAX_RECORDING_SECONDS = 180;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const VOICE_ONLY_MESSAGE = '（音声メモのみ）';

type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null;
  start: () => void; stop: () => void;
};
const speechRecognition = () => {
  const scope = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
};
const recorderType = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  .find((type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) ?? '';
const readDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error('audio_read_failed'));
  reader.readAsDataURL(blob);
});
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Voice memo: records audio to attach, and transcribes it into the comment while speaking (where the browser supports it). */
function useVoiceMemo(onTranscript: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [interim, setInterim] = useState('');
  const [audio, setAudio] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<{ recorder: MediaRecorder; stream: MediaStream; recognition: SpeechRecognitionLike | null; timer: number; active: boolean } | null>(null);
  const transcriptCallback = useRef(onTranscript);
  transcriptCallback.current = onTranscript;
  const canTranscribe = typeof window !== 'undefined' && Boolean(speechRecognition());

  const stop = useCallback(() => {
    const current = session.current;
    if (!current) return;
    current.active = false;
    window.clearInterval(current.timer);
    current.recognition?.stop();
    if (current.recorder.state !== 'inactive') current.recorder.stop();
    setRecording(false); setInterim('');
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('このブラウザでは録音できません。文字で入力してください。');
      return;
    }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setError('マイクを使えませんでした。ブラウザのマイク許可を確認してください。'); return; }
    const type = recorderType();
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: (recorder.mimeType || type || 'audio/webm').split(';')[0] });
      if (!blob.size) return;
      if (blob.size > MAX_AUDIO_BYTES) { setError('録音が長すぎるため添付できません。短く録り直してください。'); return; }
      setAudio((previous) => { if (previous) URL.revokeObjectURL(previous.url); return { blob, url: URL.createObjectURL(blob) }; });
    };
    const Recognition = speechRecognition();
    let recognition: SpeechRecognitionLike | null = null;
    if (Recognition) {
      recognition = new Recognition();
      recognition.lang = 'ja-JP'; recognition.continuous = true; recognition.interimResults = true;
      recognition.onresult = (event) => {
        let pending = '';
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index];
          if (result.isFinal) transcriptCallback.current(result[0].transcript.trim());
          else pending += result[0].transcript;
        }
        setInterim(pending);
      };
      // Chrome ends recognition after a pause; keep listening while the recording runs.
      recognition.onend = () => { if (session.current?.active) { try { recognition?.start(); } catch { /* already restarting */ } } };
      recognition.onerror = (event) => { if (event.error === 'not-allowed') setError('書き起こしを開始できませんでした。録音は続いています。'); };
    }
    const timer = window.setInterval(() => setSeconds((value) => {
      if (value + 1 >= MAX_RECORDING_SECONDS) stop();
      return value + 1;
    }), 1000);
    session.current = { recorder, stream, recognition, timer, active: true };
    recorder.start();
    try { recognition?.start(); } catch { /* transcription is optional */ }
    setSeconds(0); setRecording(true);
  }, [stop]);

  const discard = useCallback(() => {
    setAudio((previous) => { if (previous) URL.revokeObjectURL(previous.url); return null; });
  }, []);
  const reset = useCallback(() => { stop(); discard(); setError(null); setSeconds(0); }, [stop, discard]);
  useEffect(() => () => {
    const current = session.current;
    if (current) { current.active = false; window.clearInterval(current.timer); current.recognition?.stop();
      if (current.recorder.state !== 'inactive') current.recorder.stop(); current.stream.getTracks().forEach((track) => track.stop()); }
  }, []);
  return { recording, seconds, interim, audio, error, canTranscribe, start, stop, discard, reset };
}

export function FeedbackForm({ isOpen, onClose, screenshot, onRecapture }: FeedbackFormProps) {
  const { user, currentBrand } = useAuthStore();
  const submission = useRef<{ userId: string; body: Record<string, unknown> } | null>(null);
  const type: FeedbackType = 'other';
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const voice = useVoiceMemo((text) => { if (text) setMessage((current) => (current.trim() ? `${current.trimEnd()}\n${text}` : text)); });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (voice.recording) voice.stop();

    if (!message.trim() && !voice.audio) {
      setFormError('コメントを入力するか、音声で録音してください');
      return;
    }

    setIsSubmitting(true);

    try {
      if (!user) {
        throw new Error('ログインが必要です');
      }

      if (!cloudflareDataPlane) throw new Error('フィードバック接続が未設定です');
      // Keep the exact payload/ID after a lost response; a retry completes the
      // same receipt instead of creating a duplicate with a new screenshot.
      if (!submission.current || submission.current.userId !== user.id) submission.current = { userId: user.id, body: {
          request_id: crypto.randomUUID(),
          brand_id: currentBrand?.id || null,
          type,
          message: message.trim() || VOICE_ONLY_MESSAGE,
          page_url: window.location.href,
          pathname: window.location.pathname,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
          },
          user_agent: window.navigator.userAgent,
          screenshot_data_url: screenshot.dataUrl && screenshot.dataUrl.length <= MAX_SCREENSHOT_DATA_URL_LENGTH
            ? screenshot.dataUrl
            : null,
          screenshot_capture_status: screenshot.dataUrl && screenshot.dataUrl.length > MAX_SCREENSHOT_DATA_URL_LENGTH
            ? 'screenshot_upload_failed'
            : screenshot.status,
          audio_data_url: voice.audio ? await readDataUrl(voice.audio.blob) : null,
        } };
      const result = await cloudflareDataPlane.submitFeedback(submission.current.body);
      if (result.ok !== true || result.feedback.submission_state !== 'accepted') throw new Error('受付結果を確認できません。同じ送信を再確認してください');

      setSubmitted(true);
      setConfirmingReceipt(false);
      toast.success('フィードバックを送信しました');

      // Reset after delay
      setTimeout(() => {
        setSubmitted(false);
        setMessage('');
        voice.reset();
        submission.current = null;
        onClose();
      }, 2000);
    } catch (error) {
      setConfirmingReceipt(submission.current !== null);
      setFormError(error instanceof Error && error.message.includes('feedback_request_conflict')
        ? '前回の送信と内容が一致しません。受付状況を確認してください。'
        : error instanceof Error && error.message.includes('rate_limited')
          ? '短時間に送信が多すぎます。少し時間をおいて送ってください。'
          : '送信の完了を確認できません。「受付を再確認」で同じ内容の受付を確認できます。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setSubmitted(false);
      setMessage('');
      voice.reset();
      submission.current = null;
      setConfirmingReceipt(false);
      setFormError(null);
      onClose();
    }
  };

  const locked = isSubmitting || confirmingReceipt;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2147483646]"
          />

          {/* Modal */}
          <motion.div
            role="dialog"
            aria-label="フィードバック"
            data-testid="feedback-dialog"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-4 right-4 top-4 z-[2147483647] mx-auto max-h-[calc(100vh-2rem)] w-auto max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 dark:border-neutral-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h2 className="font-semibold text-neutral-900 dark:text-white">
                    使いにくかった場所を教えてください
                  </h2>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    社内betaの改善に使います。画面スクショも一緒に送れます
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                disabled={isSubmitting}
                aria-label="閉じる"
                className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <X className="w-5 h-5 text-neutral-400" />
              </button>
            </div>

            {/* Content */}
            <AnimatePresence mode="wait">
              {submitted ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="p-12 text-center"
                  data-testid="feedback-sent"
                >
                  <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                    <ThumbsUp className="w-8 h-8 text-green-600 dark:text-green-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-neutral-900 dark:text-white mb-2">
                    ありがとうございます！
                  </h3>
                  <p className="text-neutral-600 dark:text-neutral-400">
                    フィードバックを受け付けました。
                    <br />
                    サービス改善に活用させていただきます。
                  </p>
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  onSubmit={handleSubmit}
                  className="p-6 space-y-5"
                >
                  {/* Screenshot */}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                        画面スクショ
                      </label>
                      <button
                        type="button"
                        onClick={onRecapture}
                        disabled={isSubmitting || confirmingReceipt || screenshot.isCapturing}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary-600 transition hover:bg-primary-50 disabled:opacity-50 dark:text-primary-300 dark:hover:bg-primary-900/20"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${screenshot.isCapturing ? 'animate-spin' : ''}`} />
                        再撮影
                      </button>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                      {screenshot.isCapturing ? (
                        <div className="flex h-36 items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-300">
                          <Camera className="h-4 w-4 animate-pulse" />
                          スクショを撮影中...
                        </div>
                      ) : screenshot.dataUrl ? (
                        <img
                          src={screenshot.dataUrl}
                          alt="送信される画面スクショ"
                          data-testid="feedback-screenshot"
                          className="h-36 w-full object-cover object-top"
                        />
                      ) : (
                        <div className="flex h-36 items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-300">
                          スクショを取得できませんでした。コメントだけ送信できます。
                        </div>
                      )}
                    </div>
                    {screenshot.error && (
                      <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">
                        {screenshot.error}
                      </p>
                    )}
                  </div>

                  {/* Message */}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label htmlFor="feedback-message" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                        コメント
                      </label>
                      {voice.recording ? (
                        <button type="button" onClick={voice.stop} data-testid="feedback-voice-stop"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300">
                          <Square className="h-3.5 w-3.5 fill-current" />
                          録音を止める {clock(voice.seconds)}
                        </button>
                      ) : (
                        <button type="button" onClick={() => void voice.start()} disabled={locked} data-testid="feedback-voice-start"
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary-600 transition hover:bg-primary-50 disabled:opacity-50 dark:text-primary-300 dark:hover:bg-primary-900/20">
                          <Mic className="h-3.5 w-3.5" />
                          {voice.audio ? '録り直す' : '音声で入力'}
                        </button>
                      )}
                    </div>
                    <textarea
                      id="feedback-message"
                      value={message}
                      maxLength={4000}
                      disabled={locked}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={5}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="気づいたことをそのまま書いてください（「音声で入力」で話した内容が文字になります）"
                      className="block w-full resize-none rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-base leading-7 text-neutral-950 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-primary-400 focus:ring-4 focus:ring-primary-200/50 dark:border-neutral-700 dark:bg-surface-950 dark:text-white dark:placeholder:text-neutral-500 dark:focus:border-primary-400"
                    />
                    {voice.recording && (
                      <p className="mt-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-300" role="status">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                        {voice.canTranscribe ? `録音中・書き起こし中${voice.interim ? `：${voice.interim}` : ''}` : '録音中（このブラウザは書き起こしに対応していません。音声はそのまま添付されます）'}
                      </p>
                    )}
                    {voice.audio && !voice.recording && (
                      <div className="mt-3 flex items-center gap-2" data-testid="feedback-voice-attachment">
                        <audio src={voice.audio.url} controls className="h-9 min-w-0 flex-1" />
                        <button type="button" onClick={voice.discard} disabled={locked} aria-label="録音を削除"
                          className="rounded-lg p-2 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-50 dark:hover:bg-neutral-800">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    {voice.audio && !voice.recording && <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">この録音もいっしょに送信されます。</p>}
                    {voice.error && <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">{voice.error}</p>}
                  </div>

                  {confirmingReceipt && <p role="status" className="text-sm text-amber-800 dark:text-amber-200">
                    前回の送信結果を確認中です。「受付を再確認」で同じ内容と添付の受付を確認します。
                  </p>}
                  {formError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{formError}</p>}

                  {/* Submit */}
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleClose}
                      disabled={isSubmitting}
                    >
                      キャンセル
                    </Button>
                    <Button
                      type="submit"
                      isLoading={isSubmitting}
                      disabled={screenshot.isCapturing && !confirmingReceipt}
                      leftIcon={<Send className="w-4 h-4" />}
                    >
                      {confirmingReceipt ? '受付を再確認' : '送信する'}
                    </Button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Feedback tab on the left edge of every screen for signed-in users: captures the screen, then opens the form. */
export function FeedbackButton() {
  const user = useAuthStore((state) => state.user);
  const [isOpen, setIsOpen] = useState(false);
  const [screenshot, setScreenshot] = useState<FeedbackScreenshotState>({
    dataUrl: null,
    status: 'screenshot_capture_failed',
    isCapturing: false,
    error: null,
  });

  const captureScreenshot = useCallback(async () => {
    setScreenshot((current) => ({ ...current, isCapturing: true, error: null }));
    try {
      // Loaded on first use so the capture library is not part of every page load.
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(document.body, {
        backgroundColor: '#070b0d',
        height: window.innerHeight,
        logging: false,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        useCORS: true,
        width: window.innerWidth,
        windowHeight: window.innerHeight,
        windowWidth: window.innerWidth,
        x: window.scrollX,
        y: window.scrollY,
        ignoreElements: (element) => element.hasAttribute('data-feedback-capture-ignore'),
      });
      setScreenshot({
        dataUrl: canvas.toDataURL('image/png'),
        status: 'captured',
        isCapturing: false,
        error: null,
      });
    } catch (error) {
      setScreenshot({
        dataUrl: null,
        status: 'screenshot_capture_failed',
        isCapturing: false,
        error: error instanceof Error ? error.message : 'スクショ取得に失敗しました',
      });
    }
  }, []);

  const handleOpen = async () => {
    // Capture before the form opens so the screenshot shows the screen as the user saw it.
    setScreenshot((current) => ({ ...current, isCapturing: true, error: null }));
    setIsOpen(true);
    await captureScreenshot();
  };

  if (typeof document === 'undefined' || !user) return null;

  return createPortal(
    <>
      <button
        data-feedback-capture-ignore
        data-testid="feedback-tab"
        onClick={handleOpen}
        type="button"
        className="group fixed left-0 top-1/2 z-[2147483645] flex -translate-y-1/2 select-none items-center gap-1.5 rounded-r-md bg-[#0bcabc]/90 px-px py-2 hover:px-[3px] focus-visible:px-[3px] text-[11px] font-semibold leading-none tracking-[0.15em] text-[#06201e] shadow-lg shadow-black/30 transition-colors duration-150 hover:bg-[#2ee0d2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        style={{ writingMode: 'vertical-rl' }}
        aria-label="フィードバックを送信"
        title="フィードバックを送信（画面のスクショ付き）"
      >
        {/* 14px wide while collapsed, so it stays clear of the 16px gutter in front of left rails and headings. */}
        <MessageSquare className="h-3 w-3" />
        {/* Icon only until hover/focus: the full label covered rail labels and headings at the left edge. */}
        <span className="hidden group-hover:inline group-focus-visible:inline">フィードバック</span>
      </button>

      <div data-feedback-capture-ignore>
        <FeedbackForm
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          screenshot={screenshot}
          onRecapture={captureScreenshot}
        />
      </div>
    </>,
    document.body,
  );
}
