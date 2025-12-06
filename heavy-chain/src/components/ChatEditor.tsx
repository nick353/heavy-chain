import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Plus } from 'lucide-react';
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
  selectedImageUrl?: string;
  onImageGenerated?: (imageUrl: string) => void;
  onEditResult?: (imageUrl: string) => void;
}

export function ChatEditor({ 
  initialImage, 
  selectedImageUrl,
  onImageGenerated, 
  onEditResult 
}: ChatEditorProps) {
  const { currentBrand } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentImage, setCurrentImage] = useState(initialImage || selectedImageUrl);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Update current image when selectedImageUrl changes
  useEffect(() => {
    if (selectedImageUrl && selectedImageUrl !== currentImage) {
      setCurrentImage(selectedImageUrl);
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: '選択した画像を読み込みました。編集したい内容を教えてください。',
          imageUrl: selectedImageUrl,
          timestamp: new Date(),
        }
      ]);
    }
  }, [selectedImageUrl]);

  useEffect(() => {
    if (messages.length === 0) {
      if (currentImage) {
        setMessages([{
          id: '1',
          role: 'assistant',
          content: '画像を読み込みました。編集したい内容を教えてください。\n\n例:\n• 「背景を青空に変えて」\n• 「もっと明るくして」\n• 「ズームアウトして」\n• 「色を赤に変えて」',
          imageUrl: currentImage,
          timestamp: new Date(),
        }]);
      } else {
        setMessages([{
          id: '1',
          role: 'assistant',
          content: 'こんにちは！画像生成・編集アシスタントです。\n\n📷 生成: 生成したい画像を説明してください\n✏️ 編集: キャンバスで画像を選択するか、画像URLを送信してください\n\n例: 「白いTシャツの商品写真、シンプルな白背景」',
          timestamp: new Date(),
        }]);
      }
    }
  }, []);

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
    const userInput = input;
    setInput('');
    setIsLoading(true);

    try {
      let result;

      if (currentImage) {
        // Edit existing image
        result = await editImageWithPrompt(currentImage, userInput, currentBrand.id);
      } else {
        // Generate new image
        result = await generateImage(userInput, currentBrand.id);
      }

      if (result.success && result.imageUrl) {
        setCurrentImage(result.imageUrl);
        onImageGenerated?.(result.imageUrl);
        onEditResult?.(result.imageUrl);

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: currentImage 
            ? '✨ 画像を編集しました！\n\n続けて編集する場合は指示してください。「キャンバスに追加」ボタンで追加できます。'
            : '✨ 画像を生成しました！\n\n編集したい場合は指示してください。',
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

  const handleAddToCanvas = (imageUrl: string) => {
    onEditResult?.(imageUrl);
    toast.success('キャンバスに追加しました');
  };

  const quickPrompts = currentImage ? [
    '背景を白に変更',
    'もっと明るくして',
    'コントラストを上げて',
    '色を鮮やかに',
    '少しズームイン',
    'シャドウを追加',
  ] : [
    '白いTシャツ、スタジオ撮影',
    'モデル着用イメージ',
    'シンプルな商品写真',
    'ストリートスタイル',
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Current image indicator */}
      {currentImage && (
        <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg overflow-hidden bg-neutral-200 flex-shrink-0">
              <img 
                src={currentImage} 
                alt="" 
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-700">編集中の画像</p>
              <p className="text-xs text-neutral-500 truncate">チャットで指示して編集できます</p>
            </div>
            <button
              onClick={() => {
                setCurrentImage(undefined);
                setMessages([{
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: '画像の選択を解除しました。新しい画像を生成する場合は、説明を入力してください。',
                  timestamp: new Date(),
                }]);
              }}
              className="text-xs text-neutral-500 hover:text-neutral-700"
            >
              解除
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                message.role === 'user'
                  ? 'bg-primary-600 text-white'
                  : 'bg-neutral-100 text-neutral-800'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              {message.imageUrl && (
                <div className="mt-3">
                  <div className="rounded-lg overflow-hidden">
                    <img
                      src={message.imageUrl}
                      alt=""
                      className="w-full max-w-[200px] rounded-lg"
                    />
                  </div>
                  {message.role === 'assistant' && onEditResult && (
                    <button
                      onClick={() => handleAddToCanvas(message.imageUrl!)}
                      className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-white text-neutral-700 text-xs rounded-lg hover:bg-neutral-50 transition-colors border border-neutral-200"
                    >
                      <Plus className="w-3 h-3" />
                      キャンバスに追加
                    </button>
                  )}
                </div>
              )}
              <p className={`text-xs mt-2 ${
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
                <span className="text-sm">
                  {currentImage ? '画像を編集中...' : '画像を生成中...'}
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts */}
      <div className="px-4 py-2 border-t border-neutral-100">
        <p className="text-xs text-neutral-500 mb-2">クイック入力:</p>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => setInput(prompt)}
              disabled={isLoading}
              className="flex-shrink-0 px-3 py-1.5 bg-neutral-50 text-neutral-600 text-xs rounded-full hover:bg-neutral-100 transition-colors disabled:opacity-50 border border-neutral-200"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

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
            disabled={!input.trim() || isLoading || !currentBrand}
            className="px-4 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
        {!currentBrand && (
          <p className="text-xs text-red-500 mt-2">ブランドを選択してください</p>
        )}
      </form>
    </div>
  );
}
