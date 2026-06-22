import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  Download,
  ImagePlus,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { generateModelMatrix } from '../lib/imageApi';
import { saveWorkspaceArtifact } from '../lib/localWorkspaceArtifacts';
import { useAuthStore } from '../stores/authStore';
import { useCanvasStore } from '../stores/canvasStore';

type Gender = 'female' | 'male';
type MatrixItem = {
  bodyType: string;
  bodyTypeName: string;
  ageGroup: string;
  ageGroupName: string;
  imageUrl: string;
  storagePath?: string;
  imageId?: string;
  persistenceStatus?: 'completed' | 'failed';
};
type LastRequest = {
  productDescription: string;
  imageUrl?: string;
  bodyTypes: string[];
  ageGroups: string[];
  gender: Gender;
};
type HistoryItem = {
  id: string;
  title: string;
  status: string;
  time: string;
  previewUrl?: string;
  imageUrls?: string[];
  count: number;
  artifactIds?: string[];
  remoteJobId?: string | null;
  remoteImageIds?: Array<string | null>;
  remoteStoragePaths?: Array<string | null>;
};

const bodyTypeOptions = [
  { id: 'slim', label: 'スリム' },
  { id: 'regular', label: '標準' },
  { id: 'plus', label: 'プラス' },
];

const ageGroupOptions = [
  { id: '20s', label: '20代' },
  { id: '30s', label: '30代' },
  { id: '40s', label: '40代' },
];

const genderOptions: Array<{ id: Gender; label: string }> = [
  { id: 'female', label: '女性' },
  { id: 'male', label: '男性' },
];

const seedHistory: HistoryItem[] = [
  { id: 'fit-1042', title: 'リネンシャツ / モデル着用', status: '完了', time: '12分前', count: 4 },
  { id: 'fit-1038', title: 'ワイドパンツ / EC白背景', status: '完了', time: '昨日', count: 3 },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('画像を読み込めませんでした。'));
    };
    reader.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
}

export function FittingPage() {
  const navigate = useNavigate();
  const { currentBrand } = useAuthStore();
  const { createProject, addObject, saveCurrentProject } = useCanvasStore();
  const [productDescription, setProductDescription] = useState(
    '春夏向けのリネン混シャツ。自然光、EC商品ページのメイン画像として使える落ち着いた構図。'
  );
  const [garmentImageUrl, setGarmentImageUrl] = useState<string | undefined>();
  const [garmentFileName, setGarmentFileName] = useState('');
  const [selectedBodyTypes, setSelectedBodyTypes] = useState<string[]>(['slim', 'regular']);
  const [selectedAgeGroups, setSelectedAgeGroups] = useState<string[]>(['20s', '30s']);
  const [gender, setGender] = useState<Gender>('female');
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultMatrix, setResultMatrix] = useState<MatrixItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>(seedHistory);
  const [errorMessage, setErrorMessage] = useState('');
  const [lastRequest, setLastRequest] = useState<LastRequest | null>(null);

  const canGenerate = useMemo(() => {
    return Boolean(currentBrand && !isGenerating && (productDescription.trim() || garmentImageUrl) && selectedBodyTypes.length && selectedAgeGroups.length);
  }, [currentBrand, garmentImageUrl, isGenerating, productDescription, selectedAgeGroups.length, selectedBodyTypes.length]);

  const toggleBodyType = (id: string) => {
    setSelectedBodyTypes((items) => (
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id]
    ));
  };

  const toggleAgeGroup = (id: string) => {
    setSelectedAgeGroups((items) => (
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id]
    ));
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setErrorMessage('');
    try {
      setGarmentImageUrl(await readFileAsDataUrl(file));
      setGarmentFileName(file.name);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '画像を読み込めませんでした。');
    }
  };

  const runGeneration = async (request: LastRequest) => {
    if (!currentBrand) {
      setErrorMessage('ブランドを読み込んでからもう一度試してください。');
      return;
    }

    setIsGenerating(true);
    setErrorMessage('');
    setResultMatrix([]);
    setLastRequest(request);

    const response = await generateModelMatrix(request.productDescription, currentBrand.id, {
      imageUrl: request.imageUrl,
      bodyTypes: request.bodyTypes,
      ageGroups: request.ageGroups,
      gender: request.gender,
    });

    setIsGenerating(false);

    const matrix = response.matrix ?? [];

    if (!response.success || matrix.length === 0) {
      setErrorMessage(response.error || 'モデルセット写真を生成できませんでした。');
      return;
    }

    const artifactIds = matrix.map((item, index) => {
      const title = `${item.bodyTypeName} ${item.ageGroupName} / モデル着用`;
      const artifactId = `local-fit-${Date.now()}-${index}`;
      return saveWorkspaceArtifact({
        id: artifactId,
        brandId: currentBrand.id,
        featureType: 'model-matrix',
        title,
        imageUrl: item.imageUrl,
        prompt: request.productDescription,
        metadata: {
          feature: 'model-matrix',
          bodyType: item.bodyType,
          bodyTypeName: item.bodyTypeName,
          ageGroup: item.ageGroup,
          ageGroupName: item.ageGroupName,
          gender: request.gender,
          remoteSaveStatus: 'succeeded',
          remoteJobId: response.jobId ?? null,
          remoteImageId: item.imageId ?? null,
          remoteStoragePath: item.storagePath ?? null,
          remotePersistenceStatus: item.persistenceStatus ?? response.persistenceStatus ?? null,
          sourceArtifactId: artifactId,
          sourceStoragePath: item.storagePath ?? null,
        },
        sourceJobId: response.jobId ?? undefined,
      }).id;
    });

    setResultMatrix(matrix);
    setHistory((items) => [
      {
        id: `fit-${Date.now()}`,
        title: `${request.productDescription.trim().slice(0, 24) || '衣服画像'} / ${matrix.length}枚`,
        status: '完了',
        time: 'たった今',
        previewUrl: matrix[0]?.imageUrl,
        imageUrls: matrix.map((item) => item.imageUrl),
        count: matrix.length,
        artifactIds,
        remoteJobId: response.jobId ?? null,
        remoteImageIds: matrix.map((item) => item.imageId ?? null),
        remoteStoragePaths: matrix.map((item) => item.storagePath ?? null),
      },
      ...items,
    ]);
  };

  const handleGenerate = () => {
    void runGeneration({
      productDescription: productDescription.trim(),
      imageUrl: garmentImageUrl,
      bodyTypes: selectedBodyTypes,
      ageGroups: selectedAgeGroups,
      gender,
    });
  };

  const handleRetry = () => {
    if (!lastRequest) return;
    void runGeneration(lastRequest);
  };

  const handleEditHistory = (item: HistoryItem) => {
    if (!currentBrand || !item.previewUrl) return;

    const projectId = createProject(`Fitting: ${item.title}`, currentBrand.id);
    const imageUrls = item.imageUrls?.length ? item.imageUrls : [item.previewUrl];
    imageUrls.forEach((imageUrl, index) => {
      addObject({
        type: 'image',
        x: 96 + (index % 2) * 390,
        y: 96 + Math.floor(index / 2) * 480,
        width: 360,
        height: 450,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        locked: false,
        visible: true,
        src: imageUrl,
        label: imageUrls.length > 1 ? `${item.title} ${index + 1}` : item.title,
        metadata: {
          feature: 'model-matrix',
          prompt: lastRequest?.productDescription,
          generation: 0,
          parameters: {
            source: 'fitting-history',
            sourceArtifactId: item.artifactIds?.[index],
            sourceArtifactIds: item.artifactIds ?? [],
            remoteJobId: item.remoteJobId ?? null,
            remoteImageId: item.remoteImageIds?.[index] ?? null,
            remoteStoragePath: item.remoteStoragePaths?.[index] ?? null,
          },
        },
      });
    });
    saveCurrentProject();
    navigate(`/canvas/${projectId}`);
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="glass-panel rounded-2xl p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
                AIフィッティング
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                衣服画像と商品説明から、体型・年齢別のモデルセット写真を生成します。
              </p>
            </div>
            <Link to="/generate" className="btn-secondary inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm">
              <Sparkles className="h-4 w-4" />
              既存生成へ
            </Link>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <label className="group flex min-h-[360px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary-300/70 bg-white/55 p-6 text-center transition hover:border-primary-500 hover:bg-white/80 dark:border-primary-700/50 dark:bg-surface-900/50 dark:hover:bg-surface-900/80">
              <input type="file" accept="image/*" className="sr-only" onChange={handleFileChange} />
              {garmentImageUrl ? (
                <img src={garmentImageUrl} alt="アップロードした衣服画像" className="h-44 w-full max-w-xs rounded-xl object-cover shadow-sm" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 shadow-inner dark:bg-primary-900/30 dark:text-primary-300">
                  <Upload className="h-7 w-7" />
                </div>
              )}
              <p className="mt-4 text-base font-semibold text-neutral-900 dark:text-white">
                衣服画像をアップロード
              </p>
              <p className="mt-2 max-w-xs text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                {garmentFileName || '平置き、トルソー、実物写真を data URL として生成リクエストに渡します。'}
              </p>
            </label>

            <div className="rounded-2xl border border-white/60 bg-white/50 p-4 dark:border-white/10 dark:bg-surface-900/40">
              <div className="rounded-2xl bg-gradient-to-br from-surface-50 to-white p-4 dark:from-surface-950 dark:to-surface-900">
                <label htmlFor="fitting-description" className="text-sm font-semibold text-neutral-900 dark:text-white">
                  商品説明
                </label>
                <textarea
                  id="fitting-description"
                  className="mt-3 min-h-32 w-full rounded-xl border border-neutral-200 bg-white/80 p-4 text-sm leading-6 text-neutral-800 outline-none transition focus:border-primary-400 dark:border-surface-700 dark:bg-surface-950/70 dark:text-neutral-100"
                  value={productDescription}
                  onChange={(event) => setProductDescription(event.target.value)}
                />
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Body types</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {bodyTypeOptions.map((option) => {
                      const selected = selectedBodyTypes.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => toggleBodyType(option.id)}
                          className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                            selected
                              ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                              : 'bg-surface-100 text-neutral-600 hover:bg-primary-50 hover:text-primary-700 dark:bg-surface-800 dark:text-neutral-300'
                          }`}
                          aria-pressed={selected}
                        >
                          {selected && <Check className="h-3.5 w-3.5" />}
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Age groups</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {ageGroupOptions.map((option) => {
                      const selected = selectedAgeGroups.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => toggleAgeGroup(option.id)}
                          className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                            selected
                              ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                              : 'bg-surface-100 text-neutral-600 hover:bg-primary-50 hover:text-primary-700 dark:bg-surface-800 dark:text-neutral-300'
                          }`}
                          aria-pressed={selected}
                        >
                          {selected && <Check className="h-3.5 w-3.5" />}
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex rounded-xl bg-surface-100 p-1 dark:bg-surface-950/70">
                    {genderOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setGender(option.id)}
                        className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                          gender === option.id
                            ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                            : 'text-neutral-500 dark:text-neutral-400'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    className="btn-primary inline-flex items-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {isGenerating ? '生成中' : 'AI生成'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {errorMessage && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 rounded-2xl border border-red-200 bg-red-50/80 p-4 dark:border-red-900/60 dark:bg-red-950/30">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                  <div>
                    <h2 className="text-sm font-semibold text-red-900 dark:text-red-100">生成に失敗しました</h2>
                    <p className="mt-1 text-sm text-red-700 dark:text-red-200">{errorMessage}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={!lastRequest || isGenerating}
                  className="btn-secondary inline-flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  再試行
                </button>
              </div>
            </motion.div>
          )}

          {isGenerating && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 rounded-2xl border border-primary-200 bg-primary-50/70 p-4 dark:border-primary-900/60 dark:bg-primary-950/30">
              <div className="flex items-center gap-3">
                <RefreshCw className="h-5 w-5 animate-spin text-primary-600" />
                <div>
                  <p className="text-sm font-semibold text-primary-900 dark:text-primary-100">モデルセット写真を生成中</p>
                  <p className="text-xs text-primary-700/80 dark:text-primary-200/80">選択した体型と年齢グループの組み合わせを処理しています。</p>
                </div>
              </div>
            </motion.div>
          )}

          {resultMatrix.length > 0 && (
            <section className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">生成結果プレビュー</h2>
                <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-950/40 dark:text-primary-200">
                  {resultMatrix.length}枚
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {resultMatrix.map((item, index) => (
                  <figure key={item.storagePath || item.imageUrl || `${item.bodyType}-${item.ageGroup}-${index}`} className="overflow-hidden rounded-2xl border border-white/60 bg-white/60 dark:border-white/10 dark:bg-surface-900/50">
                    <img src={item.imageUrl} alt={`${item.bodyTypeName} ${item.ageGroupName} のモデル写真`} className="aspect-[4/5] w-full object-cover" />
                    <figcaption className="p-3 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                      {item.bodyTypeName} × {item.ageGroupName}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="glass-panel rounded-2xl p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">ローカル生成履歴</h2>
          <div className="mt-4 space-y-3">
            {history.map((item) => (
              <div key={item.id} className="rounded-2xl border border-white/60 bg-white/55 p-4 dark:border-white/10 dark:bg-surface-900/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-100 text-primary-600 dark:bg-surface-800 dark:text-primary-300">
                      {item.previewUrl ? (
                        <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImagePlus className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{item.title}</p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">{item.status} / {item.time} / {item.count}枚</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2">
                  <button type="button" className="flex items-center justify-center gap-1 rounded-lg bg-surface-100 px-2 py-2 text-xs font-medium text-neutral-600 transition hover:bg-primary-50 hover:text-primary-700 dark:bg-surface-800 dark:text-neutral-300 dark:hover:bg-primary-900/30">
                    <Download className="h-3.5 w-3.5" />
                    DL
                  </button>
                  <button type="button" onClick={() => handleEditHistory(item)} disabled={!item.previewUrl} className="flex items-center justify-center gap-1 rounded-lg bg-surface-100 px-2 py-2 text-xs font-medium text-neutral-600 transition hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-surface-800 dark:text-neutral-300 dark:hover:bg-primary-900/30">
                    <Pencil className="h-3.5 w-3.5" />
                    編集
                  </button>
                  <button type="button" onClick={handleRetry} disabled={!lastRequest || isGenerating} className="flex items-center justify-center gap-1 rounded-lg bg-surface-100 px-2 py-2 text-xs font-medium text-neutral-600 transition hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-surface-800 dark:text-neutral-300 dark:hover:bg-primary-900/30">
                    <RefreshCw className="h-3.5 w-3.5" />
                    再生成
                  </button>
                  <button type="button" onClick={() => setHistory((items) => items.filter((historyItem) => historyItem.id !== item.id))} className="flex items-center justify-center gap-1 rounded-lg bg-surface-100 px-2 py-2 text-xs font-medium text-neutral-600 transition hover:bg-primary-50 hover:text-primary-700 dark:bg-surface-800 dark:text-neutral-300 dark:hover:bg-primary-900/30">
                    <Trash2 className="h-3.5 w-3.5" />
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
