import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import html2canvas from 'html2canvas';
import { Camera, MessageSquare, RefreshCw, X, Send, ThumbsUp } from 'lucide-react';
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

export function FeedbackForm({ isOpen, onClose, screenshot, onRecapture }: FeedbackFormProps) {
  const { user, currentBrand } = useAuthStore();
  const submission = useRef<{ userId: string; body: Record<string, unknown> } | null>(null);
  const type: FeedbackType = 'other';
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!message.trim()) {
      toast.error('メッセージを入力してください');
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
          message: message.trim(),
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
        submission.current = null;
        onClose();
      }, 2000);
    } catch (error) {
      setConfirmingReceipt(submission.current !== null);
      toast.error(error instanceof Error && error.message.includes('feedback_request_conflict')
        ? '前回の送信と内容が一致しません。受付状況を確認してください。'
        : '送信の完了を確認できません。再送ボタンで同じ内容の受付を確認できます。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setSubmitted(false);
      setMessage('');
      submission.current = null;
      setConfirmingReceipt(false);
      onClose();
    }
  };

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
                    <label htmlFor="feedback-message" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                      コメント
                    </label>
                    <textarea
                      id="feedback-message"
                      value={message}
                      maxLength={4000}
                      disabled={isSubmitting || confirmingReceipt}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={5}
                      required
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="気づいたことをそのまま書いてください"
                      className="block w-full resize-none rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-base leading-7 text-neutral-950 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-primary-400 focus:ring-4 focus:ring-primary-200/50 dark:border-neutral-700 dark:bg-surface-950 dark:text-white dark:placeholder:text-neutral-500 dark:focus:border-primary-400"
                    />
                  </div>

                  {confirmingReceipt && <p role="status" className="text-sm text-amber-800 dark:text-amber-200">
                    前回の送信結果を確認中です。「受付を再確認」で同じ内容と添付の受付を確認します。
                  </p>}

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

// Floating feedback button
export function FeedbackButton() {
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
    setIsOpen(true);
    await captureScreenshot();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <motion.button
        data-feedback-capture-ignore
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 1 }}
        onClick={handleOpen}
        type="button"
        className="fixed bottom-5 right-5 z-[2147483647] hidden h-14 w-14 touch-manipulation select-none items-center justify-center rounded-full bg-primary-600 text-white shadow-xl ring-4 ring-white/20 transition-all hover:bg-primary-700 hover:shadow-2xl active:scale-95 md:flex lg:bottom-6 lg:right-6 group"
        aria-label="フィードバックを送信"
      >
        <MessageSquare className="w-5 h-5 group-hover:scale-110 transition-transform" />
      </motion.button>

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
