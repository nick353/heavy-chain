import type { ChangeEvent } from 'react';
import { CheckCircle2, ImagePlus, Layers3, ScanLine, Scissors, SlidersHorizontal, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  buildMaterialCutoutDataUrl,
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

const maskModeLabel: Record<MaterialReferenceState['maskMode'], string> = {
  auto: '自動カット',
  manual: '手動マスク',
  keep: '背景維持',
};

const defaultMaskCandidates = ['トップス', '無地部分', '柄'];
const manualMaskCandidates = ['手動範囲'];

const getOverlayPositionClass = (placement: string) => {
  const y = placement.includes('袖') || placement.includes('上') || placement.includes('顔')
    ? 'top-[28%]'
    : placement.includes('背面') || placement.includes('足元') || placement.includes('下')
      ? 'top-[64%]'
      : 'top-1/2';
  const x = placement.includes('左')
    ? 'left-[34%]'
    : placement.includes('右')
      ? 'left-[66%]'
      : 'left-1/2';
  return `${x} ${y}`;
};

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
  const hasImage = Boolean(state.imageUrl);
  const updateState = (patch: Partial<MaterialReferenceState>) => {
    onChange({ ...state, ...patch });
  };

  const resetExtraction = (patch: Partial<MaterialReferenceState> = {}) => {
    updateState({
      ...patch,
      extractedLayerReady: false,
      extractedImageUrl: null,
      cutoutBounds: null,
      cutoutOutputSize: null,
      cutoutDataUrlBytes: null,
      cutoutMaxDataUrlBytes: null,
      cutoutStoragePolicy: null,
      maskEngine: null,
      nextStepReady: false,
    });
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
        maskCandidates: [],
        selectedMaskCandidate: null,
        extractedLayerReady: false,
        extractedImageUrl: null,
        cutoutBounds: null,
        cutoutOutputSize: null,
        cutoutDataUrlBytes: null,
        cutoutMaxDataUrlBytes: null,
        cutoutStoragePolicy: null,
        maskEngine: null,
        nextStepReady: false,
      });
      toast.success('素材画像を読み込み、レイヤー編集を準備しました');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '画像を読み込めませんでした');
    }
  };

  const recognizeMask = () => {
    if (!state.imageUrl) {
      toast.error('先に素材画像を選択してください');
      return;
    }
    resetExtraction({
      maskMode: 'auto',
      maskCandidates: defaultMaskCandidates,
      selectedMaskCandidate: 'トップス',
      activeLayer: 'トップス',
    });
    toast.success('AIマスク認識で候補を検出しました');
  };

  const selectMaskCandidate = (candidate: string) => {
    resetExtraction({
      selectedMaskCandidate: candidate,
      activeLayer: candidate,
    });
  };

  const extractMask = async () => {
    if (!state.selectedMaskCandidate || state.maskMode === 'keep') {
      toast.error('保存したい範囲を選択してください');
      return;
    }
    try {
      const cutout = await buildMaterialCutoutDataUrl({
        imageUrl: state.imageUrl,
        mode: state.maskMode,
        candidate: state.selectedMaskCandidate,
      });
      updateState({
        extractedLayerReady: true,
        extractedImageUrl: cutout.dataUrl,
        cutoutBounds: cutout.bounds,
        cutoutOutputSize: cutout.outputSize,
        cutoutDataUrlBytes: cutout.dataUrlBytes,
        cutoutMaxDataUrlBytes: 750_000,
        cutoutStoragePolicy: cutout.storagePolicy,
        maskEngine: cutout.engine,
        nextStepReady: false,
      });
      toast.success(`${state.selectedMaskCandidate}を透明PNGで抽出しました`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '抽出に失敗しました');
    }
  };

  const confirmNextStep = () => {
    if (!state.extractedLayerReady) {
      toast.error('先に抽出を完了してください');
      return;
    }
    updateState({ nextStepReady: true });
    toast.success('次のステップへ進める状態です');
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-surface-900/60">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-950 dark:text-white">
            <ImagePlus className="h-4 w-4 text-primary-600" />
            {title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{description}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${hasImage ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200' : 'bg-neutral-100 text-neutral-500 dark:bg-surface-800 dark:text-neutral-300'}`}>
          {hasImage ? '読込済み' : '未読込'}
        </span>
      </div>

      <div className="mt-4 grid min-w-0 gap-4 2xl:grid-cols-[minmax(280px,1fr)_minmax(300px,0.86fr)]">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-white/10 dark:bg-surface-950/50">
          <label
            className={`relative flex min-h-[300px] cursor-pointer flex-col items-center justify-center overflow-hidden p-4 text-center transition hover:ring-2 hover:ring-primary-200 ${
              hasImage
                ? 'bg-[linear-gradient(45deg,#f4f4f5_25%,transparent_25%),linear-gradient(-45deg,#f4f4f5_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f4f4f5_75%),linear-gradient(-45deg,transparent_75%,#f4f4f5_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0] dark:bg-neutral-950'
                : 'bg-neutral-50 dark:bg-surface-950/60'
            }`}
          >
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            {hasImage ? (
              <>
                <img
                  src={state.imageUrl}
                  alt={uploadLabel}
                  className={`max-h-64 max-w-[82%] rounded-xl object-contain transition ${state.extractedLayerReady ? 'opacity-40' : state.maskMode === 'auto' ? 'drop-shadow-[0_18px_28px_rgba(15,23,42,0.28)]' : ''}`}
                />
                {state.extractedLayerReady ? (
                  <img
                    src={state.extractedImageUrl || state.imageUrl}
                    alt="抽出済みレイヤー"
                    className="absolute max-h-60 max-w-[78%] rounded-xl object-contain drop-shadow-[0_18px_28px_rgba(15,23,42,0.34)]"
                  />
                ) : (
                  <div
                    className={`absolute ${getOverlayPositionClass(state.placement)} flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-cyan-200 bg-neutral-950/90 px-4 py-2 text-[11px] font-black tracking-[0.18em] text-cyan-100 shadow-xl`}
                    style={{ minWidth: `${Math.max(56, state.scale * 1.6)}px` }}
                  >
                    {state.activeLayer.slice(0, 4)}
                  </div>
                )}
                <div className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-neutral-700 shadow-sm dark:bg-neutral-900/90 dark:text-neutral-100">
                  {state.fileName || 'uploaded material'}
                </div>
                {state.nextStepReady && (
                  <div className="absolute bottom-3 right-3 rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-white shadow-lg">
                    OK
                  </div>
                )}
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-primary-500" />
                <span className="mt-2 text-sm font-semibold text-neutral-900 dark:text-white">{uploadLabel}</span>
                <span className="mt-1 max-w-xs text-xs leading-5 text-neutral-500 dark:text-neutral-400">{emptyLabel}</span>
              </>
            )}
          </label>
          <div className="grid grid-cols-3 border-t border-neutral-200 text-xs dark:border-white/10">
            <div className="p-3">
              <p className="font-semibold text-neutral-400">認識</p>
              <p className="mt-1 truncate font-semibold text-neutral-900 dark:text-white">{state.imageUrl ? state.materialKind : '画像待ち'}</p>
            </div>
            <div className="border-x border-neutral-200 p-3 dark:border-white/10">
              <p className="font-semibold text-neutral-400">処理</p>
              <p className="mt-1 font-semibold text-neutral-900 dark:text-white">{hasImage ? maskModeLabel[state.maskMode] : '未設定'}</p>
            </div>
            <div className="p-3">
              <p className="font-semibold text-neutral-400">レイヤー</p>
              <p className="mt-1 truncate font-semibold text-neutral-900 dark:text-white">{hasImage ? state.activeLayer : '未設定'}</p>
            </div>
          </div>
        </div>

        {hasImage ? (
        <div className="min-w-0 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { icon: ScanLine, label: '素材認識済み' },
              { icon: Scissors, label: maskModeLabel[state.maskMode] },
              { icon: CheckCircle2, label: `${state.scale}%で配置` },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-white/10 dark:bg-surface-950/50">
                  <Icon className="h-4 w-4 text-primary-500" />
                  <p className="mt-1 text-xs font-semibold text-neutral-700 dark:text-neutral-200">{item.label}</p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              素材タイプ
              <select
                value={state.materialKind}
                onChange={(event) => updateState({ materialKind: event.target.value })}
                className="mt-1 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-white/10 dark:bg-surface-950/50 dark:text-white"
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
                className="mt-1 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-white/10 dark:bg-surface-950/50 dark:text-white"
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
                  onClick={() => updateState({
                    activeLayer: layer,
                    extractedLayerReady: false,
                    extractedImageUrl: null,
                    cutoutBounds: null,
                    cutoutOutputSize: null,
                    cutoutDataUrlBytes: null,
                    cutoutMaxDataUrlBytes: null,
                    cutoutStoragePolicy: null,
                    maskEngine: null,
                    nextStepReady: false,
                    selectedMaskCandidate: state.maskCandidates?.includes(layer) ? layer : null,
                  })}
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
                  onClick={() => updateState({
                    maskMode: mode.id,
                    maskCandidates: mode.id === 'manual' ? manualMaskCandidates : mode.id === 'keep' ? [] : defaultMaskCandidates,
                    selectedMaskCandidate: mode.id === 'manual' ? '手動範囲' : null,
                    activeLayer: mode.id === 'manual' ? '手動範囲' : state.activeLayer,
                    extractedLayerReady: false,
                    extractedImageUrl: null,
                    cutoutBounds: null,
                    cutoutOutputSize: null,
                    cutoutDataUrlBytes: null,
                    cutoutMaxDataUrlBytes: null,
                    cutoutStoragePolicy: null,
                    maskEngine: null,
                    nextStepReady: false,
                  })}
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
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={recognizeMask}
                disabled={!state.imageUrl}
                className="rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
              >
                AIマスク認識
              </button>
              <button
                type="button"
                onClick={extractMask}
                disabled={!state.selectedMaskCandidate || state.maskMode === 'keep'}
                className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                抽出
              </button>
            </div>
            {(state.maskCandidates?.length ?? 0) > 0 && (
              <div className="mt-2 rounded-xl border border-cyan-100 bg-cyan-50 p-2 dark:border-cyan-400/20 dark:bg-cyan-400/10">
                <p className="text-[11px] font-semibold text-cyan-800 dark:text-cyan-100">保存したい範囲を選択してください</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(state.maskCandidates ?? []).map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      onClick={() => selectMaskCandidate(candidate)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        state.selectedMaskCandidate === candidate
                          ? 'border-cyan-500 bg-cyan-600 text-white'
                          : 'border-cyan-200 bg-white text-cyan-700 hover:border-cyan-400 dark:bg-neutral-950 dark:text-cyan-200'
                      }`}
                    >
                      {candidate}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={confirmNextStep}
                  disabled={!state.extractedLayerReady}
                  className="mt-2 w-full rounded-xl bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-950"
                >
                  次のステップ
                </button>
              </div>
            )}
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
        ) : (
          <div className="min-w-0 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 dark:border-white/10 dark:bg-surface-950/40">
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">素材を置くと編集を始められます</p>
            <div className="mt-3 grid gap-2 text-xs text-neutral-600 dark:text-neutral-300">
              <div className="rounded-xl bg-white px-3 py-2 dark:bg-surface-900">1. 画像をアップロード</div>
              <div className="rounded-xl bg-white px-3 py-2 dark:bg-surface-900">2. AIマスク認識で範囲を選択</div>
              <div className="rounded-xl bg-white px-3 py-2 dark:bg-surface-900">3. 抽出してCanvasへ保存</div>
            </div>
          </div>
        )}
      </div>

      {hasImage && (
      <div className="mt-4 grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_260px]">
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
          <p className="text-xs font-semibold text-neutral-400">Canvas保存時の構造</p>
          <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-white">
            {state.imageUrl ? `${state.materialKind} / ${state.activeLayer}` : '画像待ち'}
          </p>
          <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            {state.placement} / {maskModeLabel[state.maskMode]} / {state.scale}%
          </p>
          {state.extractedLayerReady && (
            <p className="mt-2 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
              {state.selectedMaskCandidate ?? '選択範囲'}を透明PNGで抽出済み
            </p>
          )}
        </div>
      </div>
      )}
    </section>
  );
}
