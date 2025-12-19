import { useState } from 'react';
import { Textarea, Input } from '../ui';

interface CampaignImageFormProps {
  prompt: string;
  setPrompt: (value: string) => void;
}

export function CampaignImageForm({ prompt, setPrompt }: CampaignImageFormProps) {
  const [campaignTitle, setCampaignTitle] = useState('');
  const [campaignSubheadline, setCampaignSubheadline] = useState('');
  const [campaignDiscount, setCampaignDiscount] = useState('');
  const [campaignPeriod, setCampaignPeriod] = useState('');
  const [campaignCTA, setCampaignCTA] = useState('');
  const [campaignBrandColor, setCampaignBrandColor] = useState('#ff6b6b');
  const [campaignTextPosition, setCampaignTextPosition] = useState<'top' | 'center' | 'bottom'>('center');

  return (
    <div className="space-y-4">
      <Textarea
        label="ベースコンセプト"
        placeholder="例: 夏のサマーセール告知、爽やかな海辺の雰囲気"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="タイトル"
          placeholder="例: SUMMER SALE"
          value={campaignTitle}
          onChange={(e) => setCampaignTitle(e.target.value)}
        />
        <Input
          label="サブコピー"
          placeholder="例: 最大50% OFF / 8.1-8.10"
          value={campaignSubheadline}
          onChange={(e) => setCampaignSubheadline(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input
          label="割引率"
          placeholder="例: 50% OFF"
          value={campaignDiscount}
          onChange={(e) => setCampaignDiscount(e.target.value)}
        />
        <Input
          label="期間"
          placeholder="例: 8/1 - 8/10"
          value={campaignPeriod}
          onChange={(e) => setCampaignPeriod(e.target.value)}
        />
        <Input
          label="CTA"
          placeholder="例: 今すぐ見る"
          value={campaignCTA}
          onChange={(e) => setCampaignCTA(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="grid grid-cols-[auto,1fr] items-center gap-2">
          <label className="text-sm text-neutral-600 dark:text-neutral-400">ブランドカラー</label>
          <input
            type="color"
            className="h-10 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent"
            value={campaignBrandColor}
            onChange={(e) => setCampaignBrandColor(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm text-neutral-700 dark:text-neutral-300 mb-2">テキスト位置</label>
          <div className="flex gap-2">
            {(['top', 'center', 'bottom'] as const).map(pos => (
              <button
                key={pos}
                type="button"
                onClick={() => setCampaignTextPosition(pos)}
                className={`flex-1 py-2 rounded-lg border text-sm ${
                  campaignTextPosition === pos
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                    : 'border-neutral-200 dark:border-neutral-700'
                }`}
              >
                {pos === 'top' ? '上' : pos === 'center' ? '中央' : '下'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
