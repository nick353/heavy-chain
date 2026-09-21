import {
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  Hand,
  ImageIcon,
  ImagePlus,
  Layers,
  MousePointer2,
  Redo2,
  Search,
  Sparkles,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { listWorkspaceArtifacts } from '../lib/localWorkspaceArtifacts';
import { resolveGeneratedImageUrlWithStatus } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';

type DetailAsset = { url: string; label: string };

const LIGHTCHAIN_FASHION_REFERENCE_ASSETS = {
  main: 'https://static-jp.linkaigc.com/saas/2026-09/83d167ee1d010835bb7e999124b6549b.webp',
  reference: 'https://static-jp.linkaigc.com/saas/2026-09/e89aa47fb8ca7afdcfde6f0bc848ec9c.webp',
  result: 'https://static-jp.linkaigc.com/saas/2026-09/a07017977ab692da3bb02259525e3d21.webp',
  projectIcon: 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/%E4%B8%87%E8%83%BD%E7%A9%BF%E6%90%AD%E8%9E%8D%E5%90%88icon.png?x-oss-process=image/resize,m_lfit,w_48,limit_1/format,webp',
} as const;

function FashionStudioImageNode({
  src,
  alt,
  className,
  testId,
}: {
  src: string;
  alt: string;
  className: string;
  testId: string;
}) {
  return (
    <figure className={`fashion-studio-source-image-node ${className}`} data-testid={testId}>
      <img src={src} alt={alt} loading="eager" className="h-full w-full object-cover" />
      <button type="button" className="fashion-studio-source-expand" aria-label={`${alt}を拡大`}>
        <ArrowUpRight className="h-5 w-5" />
      </button>
    </figure>
  );
}

const extractSavedProjectDetail = (snapshot: unknown) => {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray((snapshot as { objects?: unknown }).objects)) {
    return { images: [] as Array<{ source: string; label: string }>, prompt: '' };
  }
  const images = (snapshot as { objects: unknown[] }).objects.flatMap((item) => {
    if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'image') return [];
    const value = item as { src?: unknown; label?: unknown; metadata?: Record<string, unknown> };
    const metadata = value.metadata ?? {};
    const parameters = metadata.parameters && typeof metadata.parameters === 'object'
      ? metadata.parameters as Record<string, unknown>
      : {};
    const source = [
      value.src,
      metadata.galleryImageUrl,
      metadata.galleryStoragePath,
      metadata.storagePath,
      metadata.galleryImageId && `generated-images/${String(metadata.galleryImageId)}`,
      metadata.imageId && `generated-images/${String(metadata.imageId)}`,
      parameters.galleryStoragePath,
      parameters.storagePath,
      parameters.imageId && `generated-images/${String(parameters.imageId)}`,
    ].find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim()))?.trim() ?? '';
    return source ? [{ source, label: typeof value.label === 'string' && value.label.trim() ? value.label : '画像' }] : [];
  });
  const prompt = (snapshot as { objects: unknown[] }).objects.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as { metadata?: Record<string, unknown> };
    const parameters = value.metadata?.parameters && typeof value.metadata.parameters === 'object'
      ? value.metadata.parameters as Record<string, unknown>
      : {};
    return [value.metadata?.prompt, parameters.prompt].find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim())) ?? [];
  })[0] ?? '';
  return { images, prompt };
};

/**
 * Light Chain uses the same deep-link for a new file and an existing project,
 * but the existing-project state exposes the image-search workbench. Keep the
 * empty upload canvas for the new-file URL and render the observed project
 * shell when a board project code is present.
 */
export function FashionStudioDetailPage() {
  const [searchParams] = useSearchParams();
  const [prompt, setPrompt] = useState('メイン画像のブルーの壁紙を参考画像の平面で見せて');
  const [notice, setNotice] = useState('');
  const [projectAssets, setProjectAssets] = useState<DetailAsset[]>([]);
  const hasProject = Boolean(searchParams.get('boardProjectCode'));
  const projectCode = searchParams.get('boardProjectCode') ?? '';

  useEffect(() => {
    if (!hasProject || !projectCode || !cloudflareDataPlane) {
      setProjectAssets([]);
      return undefined;
    }
    let active = true;
    const { currentBrand, user } = useAuthStore.getState();
    const localArtifact = currentBrand?.id
      ? listWorkspaceArtifacts(currentBrand.id, user?.id).find((artifact) => (
        artifact.id === projectCode || artifact.canvasProjectId === projectCode
      ))
      : null;
    const localPreview = localArtifact?.metadata.preview && typeof localArtifact.metadata.preview === 'object'
      ? localArtifact.metadata.preview as Record<string, unknown>
      : {};
    const localSource = [localArtifact?.imageUrl, localPreview.imageUrl]
      .find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim())) ?? '';
    const localLabel = localArtifact?.title?.trim() || '保存済み素材';
    const resolveSource = async (source: string): Promise<DetailAsset | null> => {
      if (/^data:image\//i.test(source)) return { url: source, label: localLabel };
      const resolved = await resolveGeneratedImageUrlWithStatus(source);
      return resolved?.ok ? { url: resolved.url, label: localLabel } : null;
    };
    if (localSource) {
      void resolveSource(localSource).then((asset) => {
        if (!active || !asset) return;
        setProjectAssets([asset]);
        if (localArtifact?.prompt) setPrompt(localArtifact.prompt);
      });
    }
    void cloudflareDataPlane.getCanvasDocument(projectCode).then(async (document) => {
      const detail = extractSavedProjectDetail(document.snapshot);
      const assets = await Promise.all(detail.images.slice(0, 3).map(async (image) => {
        const resolved = /^data:image\//i.test(image.source)
          ? { ok: true as const, url: image.source }
          : await resolveGeneratedImageUrlWithStatus(image.source);
        return resolved?.ok ? { url: resolved.url, label: image.label } : null;
      }));
      if (!active) return;
      const remoteAssets = assets.filter((asset): asset is DetailAsset => Boolean(asset));
      if (remoteAssets.length) setProjectAssets(remoteAssets);
      if (detail.prompt) setPrompt(detail.prompt);
    }).catch(() => {
      if (active && !localSource) setProjectAssets([]);
    });
    return () => { active = false; };
  }, [hasProject, projectCode]);

  if (hasProject) {
    const mainImage = projectAssets[0]?.url ?? LIGHTCHAIN_FASHION_REFERENCE_ASSETS.main;
    const referenceImage = projectAssets[1]?.url ?? LIGHTCHAIN_FASHION_REFERENCE_ASSETS.reference;
    const resultImage = projectAssets[2]?.url ?? LIGHTCHAIN_FASHION_REFERENCE_ASSETS.result;

    return (
      <main className="fashion-studio-project-detail-parity dark relative min-h-[calc(100vh-50px)] overflow-hidden bg-[#171b1c] text-white" data-testid="lightchain-fashion-studio-project-detail" data-lightchain-parity-shell="fashion-studio-project-detail">
        <div className="fashion-studio-source-dots pointer-events-none absolute inset-0" />
        <aside className="fashion-studio-source-project-rail absolute left-4 top-6 z-30 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#262a2b] shadow-xl">
          <div className="flex h-10 items-center gap-1.5 border-b border-white/10 px-2 text-sm text-neutral-400"><img src={LIGHTCHAIN_FASHION_REFERENCE_ASSETS.projectIcon} alt="" className="size-5 object-contain" /><span>ファッションスタジオ</span></div>
          <div className="flex h-11 items-center gap-3 px-3 text-sm text-neutral-300"><Link to="/flow/integration" aria-label="ファッションスタジオへ戻る" className="text-neutral-400 hover:text-white"><ChevronLeft className="h-5 w-5" /></Link><span>Untitled</span></div>
        </aside>

        <aside className="fashion-studio-source-asset-trigger absolute left-4 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2 overflow-hidden rounded-xl border border-white/10 bg-[#262a2b] p-1 shadow-xl" aria-label="アセット">
          <button type="button" aria-label="アセット" className="flex size-12 cursor-pointer items-center justify-center rounded-lg bg-[#353a3b] text-neutral-200 hover:bg-white/10"><Layers className="h-5 w-5" /></button>
        </aside>

        <section className="absolute inset-0 z-10" data-testid="lightchain-fashion-studio-canvas" aria-label="Fashion Studio Canvas">
          <svg className="fashion-studio-source-edges pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1904 771" preserveAspectRatio="none" aria-hidden="true">
            <defs><marker id="fashion-studio-arrow" markerWidth="12" markerHeight="12" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="#5e6263" strokeWidth="1.5" /></marker></defs>
            <path d="M430 515 C520 500 545 390 577 340" fill="none" stroke="#5e6263" strokeWidth="1.75" markerEnd="url(#fashion-studio-arrow)" />
            <path d="M930 340 C1000 320 1050 280 1122 285" fill="none" stroke="#5e6263" strokeWidth="1.75" markerEnd="url(#fashion-studio-arrow)" />
            <path d="M430 520 C690 520 850 560 1072 635" fill="none" stroke="#5e6263" strokeWidth="1.75" markerEnd="url(#fashion-studio-arrow)" />
          </svg>
          <FashionStudioImageNode src={mainImage} alt="メイン画像" testId="fashion-studio-saved-main-image" className="fashion-studio-source-main-node" />
          <FashionStudioImageNode src={referenceImage} alt="参考画像" testId="fashion-studio-saved-reference-image" className="fashion-studio-source-reference-node" />
          <FashionStudioImageNode src={resultImage} alt="生成結果" testId="fashion-studio-saved-result-image" className="fashion-studio-source-result-node" />

          <div className="fashion-studio-source-task" aria-label="タスク"><span><span className="mr-2">▣</span>タスク</span><span>0 <span className="mx-1">進行中</span>⌃</span></div>
          <div className="fashion-studio-source-canvas-toolbar" data-testid="lightchain-fashion-studio-canvas-toolbar">
            <button type="button" aria-label="選択" className="is-active"><MousePointer2 className="h-4 w-4" /></button><button type="button" aria-label="移動"><Hand className="h-4 w-4" /></button><button type="button" aria-label="画像を追加"><ImagePlus className="h-4 w-4" /></button><button type="button" aria-label="元に戻す"><Undo2 className="h-4 w-4" /></button><button type="button" aria-label="やり直す"><Redo2 className="h-4 w-4" /></button>
          </div>
          <div className="fashion-studio-source-zoom-controls" data-testid="lightchain-fashion-studio-zoom-controls"><button type="button" aria-label="ズームアウト"><ZoomOut className="h-4 w-4" /></button><span>30%</span><button type="button" aria-label="ズームイン"><ZoomIn className="h-4 w-4" /></button></div>
          <button type="button" className="fashion-studio-source-handbook" aria-label="操作ガイド"><BookOpen className="h-5 w-5" /></button>
          <button type="button" className="fashion-studio-source-panel-toggle" aria-label="パネルを開く"><Layers className="h-5 w-5" /></button>
        </section>

        <section className="fashion-studio-source-generation-panel" data-testid="lightchain-fashion-studio-generation-panel">
          <div className="fashion-studio-source-generation-inner">
            <div className="flex items-center justify-between"><div className="text-[30px] text-neutral-400">テキストで生成</div><div className="flex items-center gap-3 text-[30px] text-neutral-300"><ImageIcon className="h-8 w-8" />画像検索</div></div>
            <div className="flex items-center rounded-[32px] bg-gradient-to-r from-[#00a1ff66] to-[#c861ff66] px-5 py-2.5 text-[30px] text-white"><Sparkles className="mr-2.5 h-[30px] w-[30px]" />指令と参考画像を使ってワンクリック生成</div>
            <div className="flex items-center justify-between rounded-[32px] border border-white/10 bg-[#353a3b] p-5 text-[30px]"><div className="flex items-center gap-5"><img src={mainImage} alt="メイン画像" className="size-[100px] rounded-[20px] object-contain" /><span>メイン画像</span></div><button type="button" aria-label="メイン画像を差し替え"><ImagePlus className="h-8 w-8" /></button></div>
            <div className="text-[30px] text-neutral-400">参考画像</div>
            <div className="flex items-center gap-5"><img src={referenceImage} alt="参考画像" className="size-[140px] rounded-[20px] object-contain" /><button type="button" aria-label="参考画像を追加" className="flex size-[100px] items-center justify-center rounded-[20px] border border-white/10 bg-[#353a3b]"><ImagePlus className="h-8 w-8" /></button></div>
            <div className="flex flex-col gap-5">
              <label className="flex items-center text-[30px] text-neutral-400" htmlFor="fashion-studio-detail-prompt">指示テキスト *</label>
              <div className="flex h-[420px] flex-col justify-between gap-5 rounded-[32px] border border-white/15 bg-[#353a3b] p-5"><textarea id="fashion-studio-detail-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} className="h-full resize-none border-none bg-transparent p-0 text-[30px] leading-6 text-white outline-none" aria-label="指令を入力してください。" /><div className="flex items-center justify-between"><div className="flex gap-2 text-[30px] text-neutral-300"><button type="button" aria-label="プロンプト補助"><Sparkles className="h-5 w-5" /></button><button type="button" aria-label="入力画像"><ImageIcon className="h-5 w-5" /></button></div><span className="text-[30px] text-neutral-400">文字数：{prompt.length}/2000</span><button type="button" onClick={() => setPrompt('')} className="rounded-xl bg-[#505c5e] px-5 py-2 text-[30px] text-white">全削除</button></div></div>
            </div>
            <div className="flex gap-2"><select id="fashion-studio-generation-mode" aria-label="生成設定" className="h-20 flex-1 rounded-2xl border border-white/10 bg-[#353a3b] px-10 py-5 text-[30px] text-neutral-300"><option>自動</option></select><select id="fashion-studio-generation-quality" aria-label="画像品質" className="h-20 flex-1 rounded-2xl border border-white/10 bg-[#353a3b] px-10 py-5 text-[30px] text-neutral-300"><option>1K</option></select></div>
            <button type="button" onClick={() => setNotice('入力内容を保持しました。次の生成条件を確認できます。')} className="h-20 w-full rounded-3xl bg-[#0bc1b8] text-[30px] font-medium text-[#111817]">AI生成 <span className="ml-1 text-[22px]">80</span></button>
            {notice && <p className="text-[24px] text-cyan-200" role="status">{notice}</p>}
          </div>
        </section>

        <div className="fashion-studio-source-points" aria-label="ポイント"><Sparkles className="h-4 w-4" />375731</div>
        <div className="fashion-studio-source-image-search" aria-label="画像検索"><Search className="h-4 w-4" />画像検索<span className="ml-auto">☷<span className="inline-block w-4" aria-hidden="true" />⇧⌄</span></div>
      </main>
    );
  }

  return (
    <main className="dark min-h-[calc(100vh-50px)] bg-[#101010] text-white" data-testid="lightchain-fashion-studio-detail" data-lightchain-parity-shell="fashion-studio-detail">
      <aside className="absolute left-4 top-[74px] z-10 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#202426]"><div className="flex h-10 items-center gap-2 border-b border-white/10 px-2 text-sm text-neutral-400"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#52c9c3] text-[11px] font-bold text-neutral-950">✦</span><span>ファッションスタジオ</span></div><Link to="/flow/integration" aria-label="ファッションスタジオへ戻る" className="flex h-11 items-center gap-3 px-3 text-sm text-neutral-400 transition hover:bg-white/5 hover:text-white"><ChevronLeft className="h-5 w-5" /><span>Untitled</span></Link></aside>
      <label className="absolute left-1/2 top-[190.93px] flex h-[496.14px] w-[781.59px] -translate-x-1/2 cursor-pointer flex-col items-center justify-center rounded-xl bg-[#25292b] text-center transition hover:bg-[#2a2e30]" data-testid="fashion-studio-detail-upload"><Upload className="h-8 w-8 text-white" /><p className="relative top-[8px] mt-5 text-sm leading-[21px] text-neutral-300">ここをクリックまたはドラッグして画像を追加</p><p className="relative top-[8px] mt-1 text-xs leading-[17.14px] text-neutral-500">jpg、jpeg、png、webp形式の画像（最大20M）に対応</p><input className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" /></label>
    </main>
  );
}
