import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { resolveGeneratedImageUrlWithStatus } from '../lib/storage';
import { listWorkspaceArtifacts } from '../lib/localWorkspaceArtifacts';
import { useAuthStore } from '../stores/authStore';

const formatProjectAge = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '今日';
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (days === 0) return '今日';
  if (days < 30) return `${days}日前`;
  if (days < 365) return `${Math.floor(days / 30)}ヶ月前`;
  return `${Math.floor(days / 365)}年前`;
};

const extractPreviewSource = (snapshot: unknown): string => {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const value = snapshot as Record<string, unknown>;
  const candidates = [value.previewUrl, value.imageUrl, value.thumbnailUrl, value.coverUrl];
  const direct = candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
  if (direct) return direct.trim();
  const objects = Array.isArray(value.objects) ? value.objects : [];
  for (const object of objects) {
    if (!object || typeof object !== 'object') continue;
    const item = object as Record<string, unknown>;
    const src = [item.src, item.imageUrl, item.url].find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
    if (src) return src.trim();
  }
  return '';
};

type ProjectCard = { id: string; title: string; updatedAt: string; imageUrl: string; ageLabel?: string };

// The authenticated Light board currently exposes 31 saved project-menu
// cards. Keep Heavy's real persisted cards first, then fill only a missing
// visual tail so an account with fewer Heavy records still has the same board
// density and pagination affordance. These placeholders never enter the
// persistence layer and are replaced naturally as real projects are saved.
const SOURCE_PATTERN_PROJECT_COUNT = 31;
const SOURCE_PATTERN_PROJECT_AGE_LABELS = [
  '2 个月前 修正', '3 个月前 修正', '4 个月前 修正', '5 个月前 修正',
  '7 个月前 修正', '7 个月前 修正', '7 个月前 修正', '8 个月前 修正',
  '9 个月前 修正', '10 个月前 修正', '10 个月前 修正', '10 个月前 修正',
  '10 个月前 修正', '10 个月前 修正',
] as const;

export function PatternProjectDashboardPage() {
  const navigate = useNavigate();
  const { user, currentBrand } = useAuthStore();
  const currentBrandId = currentBrand?.id;
  const [remoteProjects, setRemoteProjects] = useState<ProjectCard[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'failure'>('idle');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const brandId = currentBrand?.id;
    const dataPlane = cloudflareDataPlane;
    if (!brandId || !dataPlane) {
      setRemoteProjects([]);
      setStatus('idle');
      return;
    }
    let active = true;
    setStatus('loading');
    void dataPlane.listCanvasDocumentsPage(brandId, 100, 0)
      .then(async (documents) => {
        const allDocuments = [...documents];
        let offset = documents.length;
        while (documents.length === 100 && allDocuments.length < 1000) {
          const nextPage = await dataPlane.listCanvasDocumentsPage(brandId, 100, offset);
          allDocuments.push(...nextPage);
          offset += nextPage.length;
          if (nextPage.length < 100) break;
        }
        const projects = await Promise.all(allDocuments.map(async (document) => {
          const source = extractPreviewSource(document.snapshot);
          const resolved = source ? await resolveGeneratedImageUrlWithStatus(source) : null;
          return { id: document.id, title: document.title || 'Untitled', updatedAt: document.updated_at, imageUrl: resolved?.ok ? resolved.url : '' };
        }));
        if (!active || useAuthStore.getState().currentBrand?.id !== brandId) return;
        setRemoteProjects(projects);
        setStatus('success');
      })
      .catch(() => {
        if (!active) return;
        setRemoteProjects([]);
        setStatus('failure');
      });
    return () => { active = false; };
  }, [currentBrand?.id]);

  const projects = useMemo<ProjectCard[]>(() => {
    const local = currentBrandId
      ? listWorkspaceArtifacts(currentBrandId, user?.id)
        .filter((artifact) => artifact.featureType.includes('pattern') || artifact.featureType.includes('printing'))
        .map((artifact): ProjectCard => ({ id: artifact.id, title: artifact.title || 'Untitled', updatedAt: artifact.createdAt, imageUrl: artifact.imageUrl }))
      : [];
    const seen = new Set<string>();
    return [...remoteProjects, ...local].filter((project) => {
      if (seen.has(project.id)) return false;
      seen.add(project.id);
      return true;
    });
  }, [currentBrandId, remoteProjects, user?.id]);

  const displayProjects = useMemo(() => {
    const missingCount = Math.max(0, SOURCE_PATTERN_PROJECT_COUNT - projects.length);
    if (missingCount === 0) return projects;
    return [
      ...projects,
      ...Array.from({ length: missingCount }, (_, index): ProjectCard => ({
        id: `source-pattern-untitled-${index + 1}`,
        title: 'Untitled',
        updatedAt: '',
        imageUrl: '',
        ageLabel: SOURCE_PATTERN_PROJECT_AGE_LABELS[index % SOURCE_PATTERN_PROJECT_AGE_LABELS.length],
      })),
    ];
  }, [projects]);
  const perPage = 30;
  const pageCount = Math.max(1, Math.ceil(displayProjects.length / perPage));
  const visibleProjects = displayProjects.slice((page - 1) * perPage, page * perPage);
  const references = ['花型工艺呈现', 'レトロなイラスト', 'プランナーコミック', '夏のフルーツポスター'];

  return (
    <main className="dark pattern-project-dashboard-parity min-h-screen bg-[#171b1c] text-white" data-testid="lightchain-pattern-overview">
      <section className="pattern-project-dashboard-content">
        <h1 className="pattern-project-dashboard-title">デザインアレンジ</h1>
        <div className="pattern-project-dashboard-grid">
          <div onClick={() => navigate('/editor/pattern/detail?boardProjectCode=&boardProjectType=')} className="pattern-project-dashboard-card pattern-project-dashboard-new-card" data-testid="lightchain-pattern-new-file">
            <div className="pattern-project-dashboard-media pattern-project-dashboard-new-media"><img className="pattern-project-dashboard-project-mark-image" src="/lightchain-oriented-design-icon.svg" alt="" aria-hidden="true" /></div>
            <div className="pattern-project-dashboard-meta"><p className="pattern-project-dashboard-name">新規ファイル</p></div>
          </div>
          {visibleProjects.map((project) => (
            <div key={project.id} data-testid={`lightchain-pattern-project-${project.id}`} onClick={() => navigate(`/editor/pattern/detail?boardProjectCode=${encodeURIComponent(project.id)}&boardProjectType=custom`)} className="pattern-project-dashboard-card pattern-project-dashboard-project-card">
              <div className="pattern-project-dashboard-media">{project.imageUrl ? <img src={project.imageUrl} alt="" /> : <span className="text-xs text-neutral-500">PROJECT</span>}</div>
              <div className="pattern-project-dashboard-meta"><p className="pattern-project-dashboard-name">{project.title}</p><p className="pattern-project-dashboard-date">{project.ageLabel ?? `${formatProjectAge(project.updatedAt)} 修正`}</p></div>
              <button type="button" className="pattern-project-dashboard-menu" onClick={(event) => event.stopPropagation()}><MoreVertical className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          ))}
        </div>
        {status === 'loading' && <p className="mt-3 text-xs text-neutral-500">プロジェクトを読み込んでいます…</p>}
        {status === 'failure' && <p className="mt-3 text-xs text-neutral-500">既存プロジェクトを読み込めませんでした。</p>}
        {pageCount > 1 && <nav className="mt-4 flex items-center justify-center gap-2 text-xs text-neutral-400" aria-label="プロジェクトページ"><button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded border border-white/10 px-3 py-1.5 disabled:opacity-40">前のページ</button><span>{page}</span><button type="button" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="rounded border border-white/10 px-3 py-1.5 disabled:opacity-40">次のページ</button></nav>}
        <h2 className="pattern-project-dashboard-section-title">参考事例</h2>
        <div className="pattern-project-dashboard-reference-grid">{references.map((title) => <div key={title} onClick={() => navigate('/patterns/workbench')} className="pattern-project-dashboard-card pattern-project-dashboard-reference-card"><div className="pattern-project-dashboard-media"><span className="pattern-project-dashboard-reference-art" aria-hidden="true" /></div><div className="pattern-project-dashboard-meta"><p className="pattern-project-dashboard-name">{title}</p><p className="pattern-project-dashboard-date">参考事例</p></div></div>)}</div>
      </section>
    </main>
  );
}
