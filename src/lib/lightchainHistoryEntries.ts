import type { GeneratedImageListRow } from './generatedImageQuery';
import { getLightchainUnifiedRouteAliases, lightchainUnifiedFeatureCatalog } from './lightchainUnifiedFeatureCatalog.ts';

/** Pure helpers for the 生成履歴 panel: titles, resume links and one entry per generation. */
const featureIdOf = (featureType: string | null) => featureType?.match(/^lightchain-(.+?)(?:-provider-result)?$/)?.[1] ?? null;

/** Japanese names for saved feature types that have no catalog entry; the raw ids (e.g. "model matrix") showed in the panel. */
const historyTitleOverrides: Record<string, string> = {
  'design-gacha': 'デザイン案',
  'model-matrix': 'モデル画像',
  'change-color': '色変更',
  'fashion-studio': 'ファッションスタジオ',
  'fashion-studio-detail-generated-result': 'ファッションスタジオ',
  'fashion-studio-detail-edit-result': 'ファッションスタジオ',
  'chat-edit': 'チャット編集',
  'edit-image': '画像編集',
  'canvas-inpaint': '部分修正',
  'canvas-partial-edit': '部分修正',
  'design-dialogue': 'デザイン相談',
  'design-dialogue-reference': 'デザイン相談',
  'marketing-dialogue': 'マーケティング',
  'lab-workflow': 'ラボ',
  'video-workstation': '動画',
  'fitting-background-draft': 'フィッティング背景',
  'library-upload': 'アップロード素材',
  'platform-asset': '素材',
};

const recordOf = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** Light names a print result by tool and mode, e.g. プリントイメージ‐ポイントプリントイメージ for a スポット print (the only mode its history showed). */
const historyModeTitle = (id: string | null, metadata: unknown): string | null => {
  if (id !== 'printing-image') return null;
  const data = recordOf(metadata);
  const coverage = data.coverageMode ?? recordOf(data.generationIntent).coverageMode ?? recordOf(data.compositionPreview).coverageMode;
  return coverage === 'spot' ? 'ポイントプリントイメージ' : null;
};

export const lightchainHistoryTitle = (featureType: string | null, metadata?: unknown): string => {
  const id = featureIdOf(featureType);
  const feature = id ? lightchainUnifiedFeatureCatalog.find((entry) => entry.id === id) : undefined;
  if (feature) {
    const mode = historyModeTitle(id, metadata);
    return mode ? `${feature.title}‐${mode}` : feature.title;
  }
  const key = (featureType ?? '').replace(/^lightchain-/, '').replace(/-provider-result$/, '');
  return historyTitleOverrides[key] ?? '生成画像';
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

/** Uploaded inputs are library material, not generations; Light keeps them out of 生成履歴. */
export const NON_GENERATION_TYPES: ReadonlySet<string> = new Set(['library-upload', 'platform-asset', 'local-upload', 'library-import', 'gallery-import']);

/**
 * Light's 生成履歴 lists only the open tool's results (/tools/printing shows プリントイメージ, /printing shows none of them).
 * With no tool ids every generation is listed; uploads never are.
 */
export const isHistoryRowFor = (featureType: string | null, toolIds?: readonly string[]): boolean => {
  const key = (featureType ?? '').replace(/^lightchain-/, '').replace(/-provider-result$/, '');
  if (NON_GENERATION_TYPES.has(key)) return false;
  return !toolIds || toolIds.includes(key);
};

export type HistoryEntry ={ key: string; title: string; createdAt: string; images: GeneratedImageListRow[] };

/** One entry per generation (job); results without a job stand alone. Keeps newest-first order. */
export const groupHistoryEntries = (rows: GeneratedImageListRow[]): HistoryEntry[] => {
  const entries: HistoryEntry[] = [];
  const byJob = new Map<string, HistoryEntry>();
  for (const row of rows) {
    const key = row.job_id ? `job:${row.job_id}` : `image:${row.id}`;
    const existing = byJob.get(key);
    if (existing) { existing.images.push(row); continue; }
    const entry = { key, title: lightchainHistoryTitle(row.feature_type, row.metadata), createdAt: row.created_at, images: [row] };
    byJob.set(key, entry);
    entries.push(entry);
  }
  return entries;
};

