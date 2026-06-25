import type { ChangeEvent } from 'react';
import { ImagePlus, Layers3, SlidersHorizontal, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  type MaterialReferenceState,
  readWorkspaceImageAsDataUrl,
} from '../../lib/workspaceMaterialReferences';

type MaterialWorkbenchProps = {
  title: string;
  description: string;
  uploadLabel: string;
  emptyLabel: string;
  state: MaterialReferenceState;
  onChange: (nextState: MaterialReferenceState) => void;
  materialKinds: string[];
  layerOptions: string[];
  placementOptions: string[];
  maxFileSizeMb?: number;
};

const maskModes: Array<{ id: MaterialReferenceState['maskMode']; label: string }> = [
  { id: 'auto', label: '自動カット' },
  { id: 'manual', label: '手動マスク' },
  { id: 'keep', label: '背景維持' },
];

export function MaterialWorkbench({
  title,
  description,
  uploadLabel,
  emptyLabel,
  state,
  onChange,
  materialKinds,
  layerOptions,
  placementOptions,
  maxFileSizeMb = 5,
}: MaterialWorkbenchProps) {
  const updateState = (patch: Partial<MaterialReferenceState>) => {
    onChange({ ...state, ...patch });
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > maxFileSizeMb * 1024 * 1024) {
      toast.error(`画像は${maxFileSizeMb}MB以下にしてください`);
      event.target.value = '';
      return;
    }

    try {
      updateState({
        imageUrl: await readWorkspaceImageAsDataUrl(file),
        fileName: file.name,
      });
      toast.success('素材画像を読み込み、レイヤー編集を準備しました');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '画像を読み込めませんでした');
    }
  };

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white/75 p-4 dark:border-white/10 dark:bg-surface-900/55">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-950 dark:text-white">
            <ImagePlus className="h-4 w-4 text-primary-600" />
            {title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{description}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${state.imageUrl ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200' : 'bg-neutral-100 text-neutral-500 dark:bg-surface-800 dark:text-neutral-300'}`}>
          {state.imageUrl ? '読込済み' : '未読込'}
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.1fr)]">
        <label className="flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white p-4 text-center transition hover:border-primary-300 dark:border-white/10 dark:bg-surface-950/50">
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          {state.imageUrl ? (
            <img src={state.imageUrl} alt={uploadLabel} className="max-h-44 rounded-lg object-contain" />
          ) : (
            <>
              <Upload className="h-7 w-7 text-primary-500" />
              <span className="mt-2 text-sm font-semibold text-neutral-900 dark:text-white">{uploadLabel}</span>
              <span className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{emptyLabel}</span>
            </>
          )}
        </label>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              素材タイプ
              <select
                value={state.materialKind}
                onChange={(event) => updateState({ materialKind: event.target.value })}
                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-white/10 dark:bg-surface-950/50 dark:text-white"
              >
                {materialKinds.map((kind) => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              配置
              <select
                value={state.placement}
                onChange={(event) => updateState({ placement: event.target.value })}
                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-white/10 dark:bg-surface-950/50 dark:text-white"
              >
                {placementOptions.map((placement) => (
                  <option key={placement} value={placement}>{placement}</option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              <Layers3 className="h-3.5 w-3.5" />
              レイヤー
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {layerOptions.map((layer) => (
                <button
                  key={layer}
                  type="button"
                  onClick={() => updateState({ activeLayer: layer })}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    state.activeLayer === layer
                      ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-surface-800 dark:text-neutral-300'
                  }`}
                >
                  {layer}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">カット/マスク</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {maskModes.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => updateState({ maskMode: mode.id })}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    state.maskMode === mode.id
                      ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100'
                      : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-200 dark:border-white/10 dark:bg-surface-950/40 dark:text-neutral-300'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-xs font-semibold text-neutral-500 dark:text-neutral-400">
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              レイヤーサイズ {state.scale}%
            </span>
            <input
              type="range"
              min={20}
              max={120}
              value={state.scale}
              onChange={(event) => updateState({ scale: Number(event.target.value) })}
              className="mt-2 w-full accent-primary-500"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <label className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
          素材メモ
          <textarea
            value={state.note}
            onChange={(event) => updateState({ note: event.target.value })}
            rows={2}
            className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-white/10 dark:bg-surface-950/50 dark:text-white"
          />
        </label>
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-white/10 dark:bg-surface-950/50">
          <p className="text-xs font-semibold text-neutral-400">プレビュー状態</p>
          <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-white">
            {state.imageUrl ? `${state.materialKind} / ${state.activeLayer}` : '画像待ち'}
          </p>
          <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            {state.placement} / {state.maskMode} / {state.scale}%
          </p>
        </div>
      </div>
    </section>
  );
}
