import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Wand2 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { editImageWithPrompt, generateImage } from '../lib/imageApi';
import toast from 'react-hot-toast';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  timestamp: Date;
}

interface ChatEditorProps {
  initialImage?: string;
  onImageGenerated?: (imageUrl: string) => void;
}

export function ChatEditor({ initialImage, onImageGenerated }: ChatEditorProps) {
  const { currentBrand } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentImage, setCurrentImage] = useState(initialImage);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialImage) {
      setCurrentImage(initialImage);
      setMessages([{
        id: '1',
        role: 'assistant',
        content: '画像を読み込みました。編集したい内容を教えてください。例: 「背景を青空に変えて」「もっと明るくして」「ズームアウトして」',
        imageUrl: initialImage,
        timestamp: new Date(),
      }]);
    } else {
      setMessages([{
        id: '1',
        role: 'assistant',
        content: 'こんにちは！画像生成・編集アシスタントです。生成したい画像を説明してください。例: 「白いTシャツの商品写真、シンプルな白背景」',
        timestamp: new Date(),
      }]);
    }
  }, [initialImage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !currentBrand) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      let result;

      if (currentImage) {
        // Edit existing image
        result = await editImageWithPrompt(currentImage, input, currentBrand.id);
      } else {
        // Generate new image
        result = await generateImage(input, currentBrand.id);
      }

      if (result.success && result.imageUrl) {
        setCurrentImage(result.imageUrl);
        onImageGenerated?.(result.imageUrl);

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: currentImage 
            ? '画像を編集しました！他に修正したい点があれば教えてください。'
            : '画像を生成しました！編集したい場合は指示してください。',
          imageUrl: result.imageUrl,
          timestamp: new Date(),
        };

        setMessages(prev => [...prev, assistantMessage]);
      } else {
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `申し訳ありません。処理中にエラーが発生しました: ${result.error || '不明なエラー'}`,
          timestamp: new Date(),
        };

        setMessages(prev => [...prev, errorMessage]);
        toast.error('処理に失敗しました');
      }
    } catch (error: any) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `エラーが発生しました: ${error.message}`,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
      toast.error('処理に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const quickPrompts = [
    '背景を白に',
    'もっと明るく',
    'ズームイン',
    'シャドウを追加',
  ];

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-neutral-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-accent-500 rounded-lg flex items-center justify-center">
            <Wand2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-neutral-800">チャット編集</h3>
            <p className="text-xs text-neutral-500">対話形式で画像を編集</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                message.role === 'user'
                  ? 'bg-primary-600 text-white'
                  : 'bg-neutral-100 text-neutral-800'
              }`}
            >
              <p className="text-sm">{message.content}</p>
              {message.imageUrl && (
                <div className="mt-3 rounded-lg overflow-hidden">
                  <img
                    src={message.imageUrl}
                    alt=""
                    className="w-full max-w-xs rounded-lg"
                  />
                </div>
              )}
              <p className={`text-xs mt-1 ${
                message.role === 'user' ? 'text-primary-200' : 'text-neutral-400'
              }`}>
                {message.timestamp.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-neutral-100 rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 text-neutral-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">処理中...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts */}
      {currentImage && (
        <div className="px-4 py-2 border-t border-neutral-100">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => setInput(prompt)}
                className="flex-shrink-0 px-3 py-1.5 bg-neutral-50 text-neutral-600 text-xs rounded-full hover:bg-neutral-100 transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-neutral-100">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={currentImage ? "編集内容を入力..." : "生成したい画像を説明..."}
            className="flex-1 px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-4 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

