import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

type ProjectCard = { id: string; title: string; updatedAt: string; imageUrl: string };

export function PatternProjectDashboardPage() {
  const navigate = useNavigate();
  const { user, currentBrand } = useAuthStore();
  const currentBrandId = currentBrand?.id;
  const [remoteProjects, setRemoteProjects] = useState<ProjectCard[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'failure'>('idle');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const brandId = currentBrand?.id;
    if (!brandId || !cloudflareDataPlane) {
      setRemoteProjects([]);
      setStatus('idle');
      return;
    }
    let active = true;
    setStatus('loading');
    void cloudflareDataPlane.listCanvasDocuments(brandId)
      .then(async (documents) => {
        const projects = await Promise.all(documents.slice(0, 60).map(async (document) => {
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

  const projects = useMemo(() => {
    const local = currentBrandId
      ? listWorkspaceArtifacts(currentBrandId, user?.id)
        .filter((artifact) => artifact.featureType.includes('pattern') || artifact.featureType.includes('printing'))
        .map((artifact) => ({ id: artifact.id, title: artifact.title || 'Untitled', updatedAt: artifact.createdAt, imageUrl: artifact.imageUrl }))
      : [];
    const seen = new Set<string>();
    return [...remoteProjects, ...local].filter((project) => {
      if (seen.has(project.id)) return false;
      seen.add(project.id);
      return true;
    });
  }, [currentBrandId, remoteProjects, user?.id]);

  const perPage = 30;
  const pageCount = Math.max(1, Math.ceil(projects.length / perPage));
  const visibleProjects = projects.slice((page - 1) * perPage, page * perPage);
  const references = ['花型工艺呈现', 'レトロなイラスト', 'プランナーコミック', '夏のフルーツポスター'];

  return (
    <main className="dark min-h-screen bg-[#101010] px-4 py-5 text-white sm:px-6" data-testid="lightchain-pattern-overview">
      <section className="w-full">
        <h1 className="text-base font-semibold">デザインアレンジ</h1>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-7">
          <button type="button" onClick={() => navigate('/editor/pattern/detail?boardProjectCode=&boardProjectType=')} className="overflow-hidden rounded-xl bg-[#171c1f] text-left transition hover:ring-1 hover:ring-cyan-300/60" data-testid="lightchain-pattern-new-file">
            <div className="flex h-40 items-center justify-center bg-[radial-gradient(circle_at_28%_24%,#e7ffe8,#5d646b_52%,#181f22)]"><span className="relative text-xs font-bold">PROJECT<span className="absolute -bottom-2 -right-8 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 text-xl text-neutral-700">+</span></span></div>
            <div className="px-4 py-4"><p className="text-sm font-semibold text-neutral-200">新規ファイル</p></div>
          </button>
          {visibleProjects.map((project) => (
            <button key={project.id} type="button" data-testid={`lightchain-pattern-project-${project.id}`} onClick={() => navigate(`/editor/pattern/detail?boardProjectCode=${encodeURIComponent(project.id)}&boardProjectType=custom`)} className="overflow-hidden rounded-xl bg-[#171c1f] text-left transition hover:ring-1 hover:ring-cyan-300/60">
              <div className="flex h-40 items-center justify-center bg-[#171c1f]">{project.imageUrl ? <img src={project.imageUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-neutral-500">PROJECT</span>}</div>
              <div className="px-4 py-4"><p className="truncate text-sm font-semibold text-neutral-200">{project.title}</p><p className="mt-2 text-xs text-neutral-500">{formatProjectAge(project.updatedAt)} 修正</p></div>
            </button>
          ))}
        </div>
        {status === 'loading' && <p className="mt-3 text-xs text-neutral-500">プロジェクトを読み込んでいます…</p>}
        {status === 'failure' && <p className="mt-3 text-xs text-neutral-500">既存プロジェクトを読み込めませんでした。</p>}
        {pageCount > 1 && <nav className="mt-4 flex items-center justify-center gap-2 text-xs text-neutral-400" aria-label="プロジェクトページ"><button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded border border-white/10 px-3 py-1.5 disabled:opacity-40">前のページ</button><span>{page}</span><button type="button" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="rounded border border-white/10 px-3 py-1.5 disabled:opacity-40">次のページ</button></nav>}
        <h2 className="mt-7 text-base font-semibold">参考事例</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{references.map((title) => <button key={title} type="button" onClick={() => navigate('/patterns/workbench')} className="overflow-hidden rounded-xl bg-[#171c1f] text-left transition hover:ring-1 hover:ring-cyan-300/60"><div className="h-40 bg-[linear-gradient(135deg,#dbeafe,#f8fafc_52%,#65d3cf_53%)]" /><div className="px-4 py-4"><p className="line-clamp-2 text-sm font-semibold text-neutral-200">{title}</p><p className="mt-2 text-xs text-neutral-500">参考事例</p></div></button>)}</div>
      </section>
    </main>
  );
}
