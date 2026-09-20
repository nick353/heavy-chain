import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Boxes,
  ChevronDown,
  Image as ImageIcon,
  RefreshCw,
  Shirt,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { PermissionLockedButton as SourcePermissionLockedButton } from './PermissionLockedButton';

type SourceModelField = 'age' | 'nationality' | 'skinColor' | 'bodyType';

const sourceModelTools = [
  { label: 'モデルカスタマイズ', href: '/model-library/model-custom-form', icon: UserRound },
  { label: '顔変更', href: '/model-library/head-form', icon: Sparkles },
  { label: 'モデル変更', href: '/model-library/model-change-form', icon: UserRound },
  { label: '体型', href: '/model-library/body-form', icon: Shirt },
  { label: '服のサイズ', href: '/model-library/size-form', icon: Shirt },
  { label: 'ポーズ', href: '/model-library/pose-form', icon: Sparkles },
  { label: '背景', href: '/model-library/background-form', icon: ImageIcon },
  { label: 'アングル', href: '/model-library/perspective-form', icon: Boxes },
] as const;

const sourceModelFieldLabels: Record<SourceModelField, string> = {
  age: '年齢',
  nationality: '国籍',
  skinColor: '肌の色',
  bodyType: '体型',
};

const sourceModelFieldOptions: Record<SourceModelField, string[]> = {
  age: ['スマート', '赤ちゃん', '子供', 'ティーン', '青年', '中年', '老年'],
  nationality: ['スマート', '中国', 'アメリカ', '日本', '韓国', 'ラテンアメリカ', 'アフリカ', 'ヨーロッパ'],
  skinColor: ['スマート', '黄色い肌', '白い肌', '茶色の肌', '黒い肌'],
  bodyType: ['スマート', '痩せ型', '正常', '筋肉質', '肥満'],
};

type SourceModelComboboxProps = {
  field: SourceModelField;
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
};

function SourceModelCombobox({ field, label, value, open, onToggle, onChange }: SourceModelComboboxProps) {
  const optionsId = `lightchain-source-model-${field}-options`;
  return (
    <div className="relative">
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={optionsId}
        onClick={onToggle}
        className="flex h-[34px] w-full items-center justify-between rounded-lg border border-white/10 bg-[#282c2d] px-3 text-left text-sm font-semibold text-neutral-200 outline-none transition hover:bg-[#303637]"
      >
        <span>{value}</span>
        <ChevronDown className="h-4 w-4 text-neutral-400" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={optionsId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 top-[38px] z-20 max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-[#282c2d] p-1 shadow-xl"
        >
          {sourceModelFieldOptions[field].map((option) => (
            <div
              key={option}
              role="option"
              aria-selected={value === option}
              onClick={() => onChange(option)}
              className="cursor-pointer rounded-md px-3 py-1.5 text-sm text-neutral-200 hover:bg-white/[0.08]"
            >
              {option}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Lightchain model-customization surface is intentionally kept small:
 * the source shows the model rail, condition controls, and a locked action.
 * Heavy-only workflow cards belong to the later handoff surfaces, not here.
 */
export function SourceModelLibrarySurface() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'ラベル' | 'カスタム'>('ラベル');
  const [gender, setGender] = useState<'男性' | '女性'>('男性');
  const [half, setHalf] = useState(false);
  const [openField, setOpenField] = useState<SourceModelField | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<SourceModelField, string>>({
    age: 'スマート',
    nationality: 'スマート',
    skinColor: 'スマート',
    bodyType: 'スマート',
  });

  return (
    <div
      className="flex h-[calc(100vh-50px)] min-h-[640px] w-full overflow-hidden bg-[#171b1c] text-white"
      data-testid="lightchain-source-model-surface"
      data-lightchain-source-surface="model-customization"
    >
      <nav
        aria-label="モデルツール"
        data-testid="lightchain-source-model-rail"
        className="w-20 shrink-0 border-r border-white/10 bg-[#171b1c] px-2 py-2"
      >
        <div className="flex flex-col gap-2">
          {sourceModelTools.map(({ label, href, icon: Icon }, index) => (
            <Link
              key={label}
              to={href}
              aria-current={index === 0 ? 'page' : undefined}
              className={`flex h-[76px] flex-col items-center justify-center gap-1 rounded-lg border px-1 text-center text-[11px] leading-4 transition ${
                index === 0
                  ? 'border-[#65d3cf] bg-[#273233] text-[#65d3cf]'
                  : 'border-transparent text-neutral-300 hover:border-white/15 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              <Icon className="h-6 w-6" strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <aside
        data-testid="lightchain-source-model-controls"
        className="relative flex w-[432px] shrink-0 flex-col border-r border-white/10 bg-[#171b1c]"
      >
        <div className="flex-1 overflow-y-auto px-4 pb-5 pt-4">
          <h1 className="text-base font-semibold text-white">モデルカスタマイズ</h1>

          <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl border border-white/10 bg-[#282c2d] p-1">
            {(['ラベル', 'カスタム'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  activeTab === tab ? 'border border-[#65d3cf] bg-[#282c2d] text-white' : 'border border-transparent text-neutral-300 hover:bg-white/[0.06]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-4">
            <div id="gender" className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-4">
              <span className="text-sm font-semibold text-neutral-200">性別</span>
              <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-white/10 bg-[#202526] p-1" data-testid="lightchain-source-model-gender">
                {(['男性', '女性'] as const).map((option) => (
                  <span
                    key={option}
                    onClick={() => setGender(option)}
                    role="presentation"
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${gender === option ? 'bg-[#65d3cf] text-[#102021]' : 'text-neutral-300 hover:bg-white/[0.06]'}`}
                  >
                    {option}
                  </span>
                ))}
              </div>
            </div>

            {(['age', 'nationality'] as SourceModelField[]).map((field) => (
              <div key={field} id={field} className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-4">
                <span className="text-sm font-semibold text-neutral-200">{sourceModelFieldLabels[field]}</span>
                <SourceModelCombobox
                  field={field}
                  label={sourceModelFieldLabels[field]}
                  value={fieldValues[field]}
                  open={openField === field}
                  onToggle={() => setOpenField((current) => current === field ? null : field)}
                  onChange={(value) => {
                    setFieldValues((current) => ({ ...current, [field]: value }));
                    setOpenField(null);
                  }}
                />
              </div>
            ))}

            <div id="mixed" className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-4">
              <span className="text-sm font-semibold text-neutral-200">ハーフ</span>
              <button
                type="button"
                role="switch"
                aria-checked={half}
                aria-label="ハーフ"
                onClick={() => setHalf((current) => !current)}
                className={`flex h-5 w-8 items-center rounded-full p-0.5 transition ${half ? 'bg-[#65d3cf]' : 'bg-[#3b4245]'}`}
              >
                <span className={`h-4 w-4 rounded-full bg-white transition ${half ? 'translate-x-3' : ''}`} />
              </button>
            </div>

            {(['skinColor', 'bodyType'] as SourceModelField[]).map((field) => (
              <div key={field} id={field === 'skinColor' ? 'skin-color' : 'body-type'} className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-4">
                <span className="text-sm font-semibold text-neutral-200">{sourceModelFieldLabels[field]}</span>
                <SourceModelCombobox
                  field={field}
                  label={sourceModelFieldLabels[field]}
                  value={fieldValues[field]}
                  open={openField === field}
                  onToggle={() => setOpenField((current) => current === field ? null : field)}
                  onChange={(value) => {
                    setFieldValues((current) => ({ ...current, [field]: value }));
                    setOpenField(null);
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-t border-white/10 bg-[#171b1c] p-4">
          <SourcePermissionLockedButton
            testId="lightchain-model-permission"
            marginClass=""
            disabled={false}
            showSourceIcon
            className="!h-10 !rounded-lg !bg-[#65d3cf] !text-[#102021] !opacity-100"
          />
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 bg-[#171b1c]">
        <button
          type="button"
          data-testid="lightchain-source-model-history"
          onClick={() => navigate('/history')}
          className="absolute right-8 top-4 inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-white/25 hover:bg-white/[0.04]"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          生成履歴
        </button>
        <div className="flex h-full items-center justify-center px-8 text-center">
          <div>
            <h2 className="text-xl font-semibold text-white">モデルカスタマイズ</h2>
            <p className="mt-2 text-sm text-neutral-400">ワンクリックで専用のバーチャルモデルイメージを生成</p>
          </div>
        </div>
      </main>
    </div>
  );
}
