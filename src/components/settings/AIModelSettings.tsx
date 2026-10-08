import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { cloudflareDataPlane, type CloudflareAIModels } from '../../lib/cloudflareApi';
import { readAIModelPreference, writeAIModelPreference } from '../../lib/aiModelPreference';

const selectClass = 'mt-2 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-white focus:border-[#5fcfc4] focus:outline-none';

/** Settings-screen choice of the image model (OpenAI) and the text model (Claude). Only registered models are listed. */
export function AIModelSettings() {
  const userId = useAuthStore((state) => state.user?.id);
  const [models, setModels] = useState<CloudflareAIModels | null>(null);
  const [failed, setFailed] = useState(false);
  const [imageModel, setImageModel] = useState('');
  const [textModel, setTextModel] = useState('');

  useEffect(() => {
    const saved = readAIModelPreference(userId);
    setImageModel(saved.imageModel ?? '');
    setTextModel(saved.textModel ?? '');
    if (!cloudflareDataPlane || !userId) return;
    let cancelled = false;
    cloudflareDataPlane.getAIModels()
      .then((value) => { if (!cancelled) setModels(value); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [userId]);

  // A saved model that is no longer registered is shown as the default.
  const imageIds = new Set(models?.image.models.map((model) => model.id));
  const textIds = new Set(models?.text.models.map((model) => model.id));
  const effectiveImage = imageIds.has(imageModel) ? imageModel : '';
  const effectiveText = textIds.has(textModel) ? textModel : '';
  const labelOf = (list: Array<{ id: string; label: string }> | undefined, id: string | null | undefined) => list?.find((model) => model.id === id)?.label ?? id ?? '';

  const save = (next: { imageModel: string; textModel: string }) => {
    setImageModel(next.imageModel);
    setTextModel(next.textModel);
    writeAIModelPreference(userId, {
      ...(next.imageModel ? { imageModel: next.imageModel } : {}),
      ...(next.textModel ? { textModel: next.textModel } : {}),
    });
    toast.success('AIモデルの設定を保存しました');
  };

  const chosenImage = models?.image.models.find((model) => model.id === effectiveImage);

  return (
    <section id="ai-models" data-testid="ai-model-settings" className="glass-panel rounded-2xl p-8">
      <h2 className="mb-2 text-lg font-semibold text-white"><Cpu className="mr-2 inline-block h-5 w-5" />AIモデル</h2>
      <p className="mb-6 text-sm text-neutral-400">生成に使うモデルを選べます。表示されるのは、APIキーが登録されているモデルだけです。この設定は、このブラウザでのあなたの生成に使われます。</p>
      {failed ? (
        <p className="text-sm text-neutral-400">モデルの一覧を読み込めませんでした。時間をおいて開き直してください。</p>
      ) : !models ? (
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <label className="block text-sm text-neutral-200">
            画像生成のモデル
            {models.image.models.length ? (
              <select data-testid="ai-image-model-select" className={selectClass} value={effectiveImage}
                onChange={(event) => save({ imageModel: event.target.value, textModel: effectiveText })}>
                <option value="">標準（新規生成: {labelOf(models.image.models, models.image.defaults.generate)}／編集: {labelOf(models.image.models, models.image.defaults.edit)}）</option>
                {models.image.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            ) : <p className="mt-2 text-neutral-500">登録されている画像生成モデルがありません。</p>}
            {chosenImage && !chosenImage.edit && (
              <span className="mt-2 block text-xs text-neutral-500">参考画像を使う編集では、このモデルが使えないため標準の編集モデル（{labelOf(models.image.models, models.image.defaults.edit)}）を使います。</span>
            )}
          </label>
          <label className="block text-sm text-neutral-200">
            文章・計画のモデル（Claude）
            {models.text.models.length ? (
              <select data-testid="ai-text-model-select" className={selectClass} value={effectiveText}
                onChange={(event) => save({ imageModel: effectiveImage, textModel: event.target.value })}>
                <option value="">標準（{labelOf(models.text.models, models.text.default)}）</option>
                {models.text.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            ) : <p className="mt-2 text-neutral-500">登録されている文章モデルがありません。</p>}
            <span className="mt-2 block text-xs text-neutral-500">プロンプト最適化、チャット編集の判断、まとめ生成の計画、デザイン相談に使います。</span>
          </label>
        </div>
      )}
    </section>
  );
}
