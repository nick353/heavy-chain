import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import html2canvas from 'html2canvas';
import { Camera, MessageSquare, RefreshCw, X, Send, ThumbsUp, MousePointerClick, ImageOff, FolderOpen, Gauge, CircleHelp } from 'lucide-react';
import { Button, Textarea, Input } from './index';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';

interface FeedbackFormProps {
  isOpen: boolean;
  onClose: () => void;
  screenshot: FeedbackScreenshotState;
  onRecapture: () => Promise<void>;
}

type FeedbackType = 'lost' | 'result' | 'save' | 'speed' | 'other';
type ScreenshotCaptureStatus = 'captured' | 'screenshot_capture_failed' | 'screenshot_upload_failed';

interface FeedbackScreenshotState {
  dataUrl: string | null;
  status: ScreenshotCaptureStatus;
  isCapturing: boolean;
  error: string | null;
}

const feedbackTypes = [
  { id: 'lost', label: 'どこを押すかわからない', icon: MousePointerClick, color: 'text-cyan-500 bg-cyan-50 dark:bg-cyan-900/20' },
  { id: 'result', label: '生成結果が微妙', icon: ImageOff, color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20' },
  { id: 'save', label: '保存先がわからない', icon: FolderOpen, color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' },
  { id: 'speed', label: '動作が遅い', icon: Gauge, color: 'text-red-500 bg-red-50 dark:bg-red-900/20' },
  { id: 'other', label: 'その他', icon: CircleHelp, color: 'text-green-500 bg-green-50 dark:bg-green-900/20' },
] as const;

const MAX_SCREENSHOT_DATA_URL_LENGTH = 6_500_000;

export function FeedbackForm({ isOpen, onClose, screenshot, onRecapture }: FeedbackFormProps) {
  const { user, currentBrand, profile } = useAuthStore();
  const [type, setType] = useState<FeedbackType>('lost');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState(profile?.email || user?.email || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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

      const { error } = await supabase.functions.invoke('submit-feedback', {
        body: {
          brand_id: currentBrand?.id || null,
          type,
          message: message.trim(),
          email: email.trim() || null,
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
        },
      });

      if (error) throw error;
      
      setSubmitted(true);
      toast.success('フィードバックを送信しました');
      
      // Reset after delay
      setTimeout(() => {
        setSubmitted(false);
        setMessage('');
        setEmail(profile?.email || user?.email || '');
        setType('lost');
        onClose();
      }, 2000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '送信に失敗しました。再度お試しください。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setSubmitted(false);
      setMessage('');
      setEmail(profile?.email || user?.email || '');
      setType('lost');
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
                  {/* Feedback Type */}
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                      困ったこと
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {feedbackTypes.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setType(item.id)}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 transition-all ${
                            type === item.id
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                              : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300'
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${item.color}`}>
                            <item.icon className="w-4 h-4" />
                          </div>
                          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                            {item.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Screenshot */}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                        画面スクショ
                      </label>
                      <button
                        type="button"
                        onClick={onRecapture}
                        disabled={isSubmitting || screenshot.isCapturing}
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
                  <Textarea
                    label="メッセージ"
                    placeholder={
                      type === 'lost'
                        ? 'どの画面で、次に何をすればよいかわからなくなりましたか？'
                        : type === 'result'
                        ? '期待していた見た目と、実際の結果の違いを教えてください'
                        : type === 'save'
                        ? '生成後、どこに保存・再利用したかったかを教えてください'
                        : type === 'speed'
                        ? '遅いと感じた画面や操作を教えてください'
                        : '気づいたことをそのまま書いてください'
                    }
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    required
                  />

                  {/* Email (optional) */}
                  <Input
                    type="email"
                    label="メールアドレス（任意）"
                    placeholder="返信をご希望の場合はメールアドレスを入力"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />

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
                      leftIcon={<Send className="w-4 h-4" />}
                    >
                      送信する
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
    await captureScreenshot();
    setIsOpen(true);
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
        className="fixed bottom-4 right-4 z-[2147483647] flex h-11 w-11 items-center justify-center rounded-full bg-primary-600 text-white shadow-lg transition-all hover:bg-primary-700 hover:shadow-xl sm:bottom-5 sm:right-5 lg:bottom-6 lg:right-6 lg:h-12 lg:w-12 group"
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
