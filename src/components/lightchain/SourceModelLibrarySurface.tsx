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
        className="flex h-8 w-[280px] shrink-0 items-center justify-between rounded-lg border border-white/10 bg-[#262a2b] px-3 py-2 text-left text-sm font-normal leading-[21px] text-neutral-200 outline-none transition hover:bg-[#303637]"
      >
        <span>{value}</span>
        <ChevronDown className="h-4 w-4 text-neutral-400" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={optionsId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 top-9 z-20 max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-[#262a2b] p-1 shadow-xl"
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
      style={{ fontFamily: '-apple-system, "system-ui", "Segoe UI", "PingFang SC", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif' }}
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
              className={`flex flex-col items-center justify-center gap-y-1 rounded-lg border px-1 py-2 text-center text-[12px] font-normal leading-[17.1429px] transition ${
                index === 0
                  ? 'border-[#65d3cf] bg-[#273233] text-[#65d3cf]'
                  : 'border-transparent text-neutral-300 hover:border-white/15 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              <Icon className="h-6 w-6" strokeWidth={1.7} aria-hidden="true" />
              <span className={index === 0 ? 'w-[61px]' : ''}>{label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <aside
        data-testid="lightchain-source-model-controls"
        className="relative flex w-[432px] shrink-0 flex-col border-r border-white/10 bg-[#171b1c]"
      >
        <div className="flex-1 overflow-y-auto px-4 pb-5 pt-4">
          <h1 className="text-base font-medium leading-6 text-white">モデルカスタマイズ</h1>

          <div className="mt-4 grid grid-cols-2 gap-1 overflow-hidden rounded-xl border border-white/10 bg-[#262a2b] p-1">
            {(['ラベル', 'カスタム'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-1 text-sm font-normal leading-[21px] transition ${
                  activeTab === tab ? 'border border-[#65d3cf] bg-white/[0.15] text-white' : 'border border-transparent text-neutral-300 hover:bg-white/[0.06]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-4">
            <label id="gender" className="flex items-center justify-between">
              <span className="text-sm font-medium leading-5 text-[#e3e8e8]">性別</span>
              <div className="relative flex w-[280px] shrink-0 gap-1 rounded-lg border border-white/10 p-1 leading-4" data-testid="lightchain-source-model-gender">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-1 top-1 rounded bg-[#0bc1b8]"
                  style={{ width: 133, left: 5 }}
                />
                {(['男性', '女性'] as const).map((option) => (
                  <div
                    key={option}
                    onClick={() => setGender(option)}
                    role="presentation"
                    className={`relative z-10 flex h-6 flex-1 items-center justify-center rounded px-2 py-1 text-[12px] leading-[17.1429px] transition ${gender === option ? 'bg-[#0bc1b8] text-[#102021]' : 'text-neutral-300 hover:bg-white/[0.06]'}`}
                  >
                    {option}
                  </div>
                ))}
              </div>
            </label>

            {(['age', 'nationality'] as SourceModelField[]).map((field) => (
              <label key={field} id={field} className="flex items-center justify-between">
                <span className="text-sm font-medium leading-5 text-[#e3e8e8]">{sourceModelFieldLabels[field]}</span>
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
              </label>
            ))}

            <label id="mixed" className="flex h-10 items-center justify-between">
              <span className="text-sm font-medium leading-5 text-[#e3e8e8]">ハーフ</span>
              <button
                type="button"
                role="switch"
                aria-checked={half}
                aria-label="ハーフ"
                onClick={() => setHalf((current) => !current)}
                className={`flex h-4 w-8 items-center rounded-full p-0.5 transition ${half ? 'bg-[#65d3cf]' : 'bg-[#434a4c]'}`}
              >
                <span className={`h-4 w-4 rounded-full bg-white transition ${half ? 'translate-x-3' : ''}`} />
              </button>
            </label>

            {(['skinColor', 'bodyType'] as SourceModelField[]).map((field) => (
              <label key={field} id={field === 'skinColor' ? 'skin-color' : 'body-type'} className="flex items-center justify-between">
                <span className="text-sm font-medium leading-5 text-[#e3e8e8]">{sourceModelFieldLabels[field]}</span>
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
              </label>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-t border-white/10 bg-[#171b1c] px-2 py-4">
          <SourcePermissionLockedButton
            testId="lightchain-model-permission"
            marginClass=""
            disabled={false}
            showSourceIcon
            className="!h-10 !rounded-lg !bg-[#65d3cf] !text-[12px] !leading-[17.1429px] !text-[#111817] !opacity-100"
          />
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 bg-[#171b1c]">
        <button
          type="button"
          data-testid="lightchain-source-model-history"
          onClick={() => navigate('/history')}
          className="absolute right-4 top-4 z-10 inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-[#171b1c] px-3 py-2 text-[12px] font-medium leading-[17.1429px] text-white transition hover:border-white/25 hover:bg-white/[0.04]"
        >
          <RefreshCw className="h-5 w-5" aria-hidden="true" />
          生成履歴
        </button>
        <div className="flex h-full flex-col items-center justify-center px-10 text-center">
          <h2 className="font-[AlimamaFangYuanTiVF] text-lg font-bold leading-[25.2px] text-white">モデルカスタマイズ</h2>
          <p className="mt-2 text-sm leading-[21px] text-[#aab8b6]">ワンクリックで専用のバーチャルモデルイメージを生成</p>
        </div>
      </main>
    </div>
  );
}
