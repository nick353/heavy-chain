import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X, Send, ThumbsUp, MousePointerClick, ImageOff, FolderOpen, Gauge, CircleHelp } from 'lucide-react';
import { Button, Textarea, Input } from './index';
import toast from 'react-hot-toast';

interface FeedbackFormProps {
  isOpen: boolean;
  onClose: () => void;
}

type FeedbackType = 'lost' | 'result' | 'save' | 'speed' | 'other';

const feedbackTypes = [
  { id: 'lost', label: 'どこを押すかわからない', icon: MousePointerClick, color: 'text-cyan-500 bg-cyan-50 dark:bg-cyan-900/20' },
  { id: 'result', label: '生成結果が微妙', icon: ImageOff, color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20' },
  { id: 'save', label: '保存先がわからない', icon: FolderOpen, color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' },
  { id: 'speed', label: '動作が遅い', icon: Gauge, color: 'text-red-500 bg-red-50 dark:bg-red-900/20' },
  { id: 'other', label: 'その他', icon: CircleHelp, color: 'text-green-500 bg-green-50 dark:bg-green-900/20' },
] as const;

export function FeedbackForm({ isOpen, onClose }: FeedbackFormProps) {
  const [type, setType] = useState<FeedbackType>('lost');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
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
      // In production, this would call an API endpoint
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      console.log('Internal beta feedback submitted:', { type, message, email });
      
      setSubmitted(true);
      toast.success('フィードバックを送信しました');
      
      // Reset after delay
      setTimeout(() => {
        setSubmitted(false);
        setMessage('');
        setEmail('');
        setType('lost');
        onClose();
      }, 2000);
    } catch {
      toast.error('送信に失敗しました。再度お試しください。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setSubmitted(false);
      setMessage('');
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
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg mx-4 bg-white dark:bg-surface-900 rounded-2xl shadow-2xl z-50 overflow-hidden"
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
                    社内betaの改善に使います
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

  return (
    <>
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 1 }}
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 right-4 z-40 hidden h-12 w-12 items-center justify-center rounded-full bg-primary-600 text-white shadow-lg transition-all hover:bg-primary-700 hover:shadow-xl lg:bottom-6 lg:right-6 lg:flex group"
        aria-label="フィードバックを送信"
      >
        <MessageSquare className="w-5 h-5 group-hover:scale-110 transition-transform" />
      </motion.button>

      <FeedbackForm isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
