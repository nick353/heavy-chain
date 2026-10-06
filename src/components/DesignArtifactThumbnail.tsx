import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, RotateCw } from 'lucide-react';
import {
  createDesignPreviewController,
  designPreviewScopeKey,
  type DesignPreviewState,
} from '../lib/designPreviewResolver';
import { getWorkspaceArtifactCanonicalStoragePath, type WorkspaceArtifact } from '../lib/localWorkspaceArtifacts';
import { resolveGeneratedImageUrlWithStatus } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';

type DesignArtifactThumbnailProps = {
  artifact: WorkspaceArtifact;
  userId?: string;
  brandId?: string;
  href: string | null;
  onOpen: () => void;
};

export const DESIGN_PROJECT_DEFAULT_COVER = 'https://jp.linkaigc.com/static/project_default_cover.png';
const placeholderImage = DESIGN_PROJECT_DEFAULT_COVER;

export function DesignArtifactThumbnail({ artifact, userId, brandId, href, onOpen }: DesignArtifactThumbnailProps) {
  const canonicalStoragePath = getWorkspaceArtifactCanonicalStoragePath(artifact.metadata);
  const currentUserId = userId ?? null;
  const currentBrandId = brandId ?? null;
  const scopeKey = designPreviewScopeKey({
    artifactId: artifact.id,
    userId: currentUserId,
    brandId: currentBrandId,
    imageUrl: artifact.imageUrl,
    canonicalStoragePath,
  });
  const [preview, setPreview] = useState<DesignPreviewState>({
    scopeKey: '', requestToken: 0, status: 'idle', url: null,
  });
  const controllerRef = useRef<ReturnType<typeof createDesignPreviewController> | null>(null);
  const visiblePreview = preview.scopeKey === scopeKey ? preview : null;

  useEffect(() => {
    const controller = createDesignPreviewController(
      resolveGeneratedImageUrlWithStatus,
      () => {
        const liveAuth = useAuthStore.getState();
        return { userId: liveAuth.user?.id ?? null, brandId: liveAuth.currentBrand?.id ?? null };
      },
      setPreview,
    );
    controllerRef.current = controller;
    void controller.reset({
      artifactId: artifact.id,
      userId: currentUserId,
      brandId: currentBrandId,
      imageUrl: artifact.imageUrl,
      canonicalStoragePath,
    });
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [artifact.id, artifact.imageUrl, brandId, canonicalStoragePath, currentBrandId, currentUserId]);

  const imageUrl = visiblePreview?.status === 'ready' ? visiblePreview.url : null;
  const canRetry = visiblePreview?.status === 'failed';

  return (
    <div className="relative h-36 bg-white/10" data-testid={`design-artifact-thumbnail-${artifact.id}`}>
      <button
        type="button"
        disabled={!href}
        title={!href ? 'Canvasで開くためのリモート画像IDがありません' : undefined}
        aria-label={`${artifact.title}をCanvasで開く`}
        data-design-card-open=""
        className="flex h-full w-full items-center justify-center overflow-hidden disabled:cursor-not-allowed"
        onClick={() => { if (href) onOpen(); }}
      >
        {imageUrl ? (
          <img
            key={`${scopeKey}:${visiblePreview?.requestToken ?? 0}`}
            src={imageUrl}
            alt=""
            data-design-card-cover=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => controllerRef.current?.onImageError(visiblePreview?.requestToken ?? -1)}
          />
        ) : visiblePreview?.status === 'loading' ? (
          <span className="sr-only">プレビューを読み込み中</span>
        ) : visiblePreview?.status === 'none' ? (
          <ImageIcon aria-hidden="true" className="h-8 w-8 text-neutral-500" />
        ) : (
          <img src={placeholderImage} alt="" className="h-12 w-12 object-contain" loading="lazy" />
        )}
      </button>
      {canRetry && (
        <button
          type="button"
          className="absolute bottom-2 right-2 z-10 inline-flex items-center gap-1 rounded-lg border border-white/20 bg-black/75 px-2 py-1 text-[11px] text-white hover:bg-black"
          aria-label={`${artifact.title}のプレビューを再試行`}
          onClick={(event) => {
            event.stopPropagation();
            void controllerRef.current?.retry();
          }}
        >
          <RotateCw aria-hidden="true" className="h-3 w-3" />再試行
        </button>
      )}
    </div>
  );
}
