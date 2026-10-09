import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, MoreVertical } from 'lucide-react';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import { thumbnailImageUrl } from '../lib/mediaThumbnail';
import { useBoardDraftCards } from '../features/boardDraftProjects';

export const formatProjectAge = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '今日';
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (days === 0) return `今日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (days < 30) return `${days}日前`;
  if (days < 365) return `${Math.floor(days / 30)}ヶ月前`;
  return `${Math.floor(days / 365)}年前`;
};

export type ProjectCard = { id: string; title: string; updatedAt: string; imageUrl: string; jobId: string };

/** Falls back to the PROJECT mark when a saved preview no longer resolves (expired or deleted object). */
export function ProjectThumbnail({ url, fallback }: { url: string; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const [fullSize, setFullSize] = useState(false);
  if (!url || failed) return <>{fallback ?? <span className="pattern-project-dashboard-empty-mark">PROJECT</span>}</>;
  const thumb = thumbnailImageUrl(url) ?? url;
  const src = fullSize ? url : thumb;
  return <img src={src} alt="" loading="lazy" decoding="async" onError={() => { if (src !== url) setFullSize(true); else setFailed(true); }} />;
}

/** The signed-in user's saved results for one canonical feature, one card per job (newest first). */
export function useFeatureProjects(featureId: string) {
  const { user, currentBrand } = useAuthStore();
  const brandId = currentBrand?.id;
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'failure'>('idle');

  useEffect(() => {
    const dataPlane = cloudflareDataPlane;
    if (!brandId || !dataPlane || !user?.id) { setProjects([]); setStatus('idle'); return; }
    let active = true;
    setStatus('loading');
    void dataPlane.listGeneratedImages(brandId, { featureType: `lightchain-${featureId}`, order: 'newest', limit: 100 })
      .then(async (images) => {
        const own = images.filter((image) => image.user_id === user.id && image.job_id && image.storage_path);
        const byJob = new Map<string, typeof own[number]>();
        for (const image of own) if (!byJob.has(image.job_id!)) byJob.set(image.job_id!, image);
        const unique = [...byJob.values()];
        // One signing round-trip for the whole board instead of one request per card.
        const signed = await withSignedImageUrls(unique.map((image) => ({ storage_path: image.storage_path, image_url: '' })));
        if (!active || useAuthStore.getState().currentBrand?.id !== brandId) return;
        setProjects(unique.map((image, index) => {
          const metadata = image.metadata && typeof image.metadata === 'object' && !Array.isArray(image.metadata) ? image.metadata as Record<string, unknown> : {};
          const title = typeof metadata.projectTitle === 'string' && metadata.projectTitle.trim() ? metadata.projectTitle : 'Untitled';
          return { id: image.id, jobId: image.job_id!, title, updatedAt: image.created_at, imageUrl: signed[index]?.image_url ?? '' };
        }));
        setStatus('success');
      })
      .catch(() => { if (active) { setProjects([]); setStatus('failure'); } });
    return () => { active = false; };
  }, [brandId, user?.id, featureId]);

  return { projects, status };
}

export type ProjectBoardConfig = {
  /** Board heading, e.g. デザインアレンジ / プリントデザイン. */
  title: string;
  /** Detail editor route; new projects open it with empty board params. */
  detailPath: string;
  /** Canonical workspace feature whose saved provider results are this board's projects. */
  featureId: string;
  testId: string;
};

const PAGE_SIZE = 30;

/**
 * Light project board (/editor/pattern, /editor/patternDesign), measured at 1440×900: 220×240 cards on a 236px
 * pitch, new-file card first, 32px hover menu, right-aligned `< 1 2 … >` pager, 参考事例 row. Projects are the
 * signed-in brand's saved results for the board's feature, so every card reopens its exact saved job.
 */
export function LightchainProjectBoard({ config }: { config: ProjectBoardConfig }) {
  const navigate = useNavigate();
  const { projects, status } = useFeatureProjects(config.featureId);
  // Uploaded-but-not-generated projects (saved on first upload, like the source board).
  const drafts = useBoardDraftCards(config.featureId, config.detailPath);
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(projects.length / PAGE_SIZE));
  const visibleProjects = useMemo(() => projects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [projects, page]);
  const openProject = (project: ProjectCard) => navigate(`${config.detailPath}?boardProjectCode=${encodeURIComponent(project.id)}&boardProjectType=custom&resumeJob=${encodeURIComponent(project.jobId)}`);

  return (
    <main className="dark pattern-project-dashboard-parity min-h-screen bg-[#171b1c] text-white" data-testid={config.testId}>
      <section className="pattern-project-dashboard-content">
        <h1 className="pattern-project-dashboard-title">{config.title}</h1>
        <div className="pattern-project-dashboard-grid">
          <div onClick={() => navigate(`${config.detailPath}?boardProjectCode=&boardProjectType=`)} className="pattern-project-dashboard-card pattern-project-dashboard-new-card" data-testid="lightchain-pattern-new-file">
            <img className="pattern-project-dashboard-project-mark-image" src="/lightchain-oriented-design-icon.svg" alt="" aria-hidden="true" />
            <p className="pattern-project-dashboard-new-label">新規ファイル</p>
          </div>
          {page === 1 && drafts.map((draft) => (
            <div key={draft.id} data-testid={`lightchain-pattern-draft-${draft.id}`} onClick={() => navigate(draft.href)} className="pattern-project-dashboard-card pattern-project-dashboard-project-card">
              <div className="pattern-project-dashboard-media"><ProjectThumbnail url={draft.imageUrl} /></div>
              <div className="pattern-project-dashboard-meta"><p className="pattern-project-dashboard-name">{draft.title}</p><p className="pattern-project-dashboard-date">{formatProjectAge(draft.updatedAt)} 修正</p></div>
              <button type="button" aria-label="プロジェクトメニュー" className="pattern-project-dashboard-menu" onClick={(event) => event.stopPropagation()}><MoreVertical className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          ))}
          {visibleProjects.map((project) => (
            <div key={project.id} data-testid={`lightchain-pattern-project-${project.id}`} onClick={() => openProject(project)} className="pattern-project-dashboard-card pattern-project-dashboard-project-card">
              <div className="pattern-project-dashboard-media"><ProjectThumbnail url={project.imageUrl} /></div>
              <div className="pattern-project-dashboard-meta"><p className="pattern-project-dashboard-name">{project.title}</p><p className="pattern-project-dashboard-date">{formatProjectAge(project.updatedAt)} 修正</p></div>
              <button type="button" aria-label="プロジェクトメニュー" className="pattern-project-dashboard-menu" onClick={(event) => event.stopPropagation()}><MoreVertical className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          ))}
        </div>
        {status === 'failure' && <p className="mt-3 text-xs text-neutral-500">既存プロジェクトを読み込めませんでした。</p>}
        {pageCount > 1 && (
          <nav className="pattern-project-dashboard-pagination" aria-label="プロジェクトページ">
            <button type="button" aria-label="前のページ" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-3 w-3" aria-hidden="true" /></button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((value) => (
              <button key={value} type="button" aria-current={value === page ? 'page' : undefined} className={value === page ? 'is-active' : ''} onClick={() => setPage(value)}>{value}</button>
            ))}
            <button type="button" aria-label="次のページ" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight className="h-3 w-3" aria-hidden="true" /></button>
          </nav>
        )}
      </section>
    </main>
  );
}

const PATTERN_ARRANGE_BOARD: ProjectBoardConfig = {
  title: 'デザインアレンジ',
  detailPath: '/editor/pattern/detail',
  featureId: 'pattern-arrange',
  testId: 'lightchain-pattern-overview',
};

const PRINT_DESIGN_BOARD: ProjectBoardConfig = {
  title: 'プリントデザイン',
  detailPath: '/editor/patternDesign/detail',
  featureId: 'pattern-print-design',
  testId: 'lightchain-print-design-overview',
};

const CHANGE_COLOR_BOARD: ProjectBoardConfig = {
  title: '色変更',
  detailPath: '/editor/changeColor/detail',
  featureId: 'change-color',
  testId: 'lightchain-change-color-overview',
};

export function ChangeColorProjectDashboardPage() {
  return <LightchainProjectBoard config={CHANGE_COLOR_BOARD} />;
}

export function PatternProjectDashboardPage() {
  return <LightchainProjectBoard config={PATTERN_ARRANGE_BOARD} />;
}

export function PrintDesignProjectDashboardPage() {
  return <LightchainProjectBoard config={PRINT_DESIGN_BOARD} />;
}
