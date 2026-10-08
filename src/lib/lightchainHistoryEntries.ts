import type { GeneratedImageListRow } from './generatedImageQuery';
import { getLightchainUnifiedRouteAliases, lightchainUnifiedFeatureCatalog } from './lightchainUnifiedFeatureCatalog.ts';

/** Pure helpers for the 生成履歴 panel: titles, resume links and one entry per generation. */
const featureIdOf = (featureType: string | null) => featureType?.match(/^lightchain-(.+?)(?:-provider-result)?$/)?.[1] ?? null;

export const lightchainHistoryTitle = (featureType: string | null): string => {
  const id = featureIdOf(featureType);
  const feature = id ? lightchainUnifiedFeatureCatalog.find((entry) => entry.id === id) : undefined;
  return feature?.title ?? (featureType ? featureType.replaceAll('-', ' ') : '生成画像');
};

/** The tool screen that reopens this result with its saved inputs, or null when the result has no tool to return to. */
export const lightchainHistoryResumeHref = (image: Pick<GeneratedImageListRow, 'feature_type' | 'job_id'>): string | null => {
  const id = featureIdOf(image.feature_type);
  if (!id || !image.job_id) return null;
  const route = getLightchainUnifiedRouteAliases(id)[0] ?? `/lightchain/${id}`;
  const [path, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  params.set('resumeJob', image.job_id);
  return `${path}?${params.toString()}`;
};

export type HistoryEntry = { key: string; title: string; createdAt: string; images: GeneratedImageListRow[] };

/** One entry per generation (job); results without a job stand alone. Keeps newest-first order. */
export const groupHistoryEntries = (rows: GeneratedImageListRow[]): HistoryEntry[] => {
  const entries: HistoryEntry[] = [];
  const byJob = new Map<string, HistoryEntry>();
  for (const row of rows) {
    const key = row.job_id ? `job:${row.job_id}` : `image:${row.id}`;
    const existing = byJob.get(key);
    if (existing) { existing.images.push(row); continue; }
    const entry = { key, title: lightchainHistoryTitle(row.feature_type), createdAt: row.created_at, images: [row] };
    byJob.set(key, entry);
    entries.push(entry);
  }
  return entries;
};

