import type { Json } from '../../../types/database';
import {
  findWorkspaceArtifact,
  findWorkspaceArtifactPersisted,
  listWorkspaceArtifacts,
  saveWorkspaceArtifactPersisted,
  type WorkspaceArtifact,
} from '../../../lib/localWorkspaceArtifacts';

export type PrintResultKind = 'exact' | 'fabric' | 'surface';

export interface PrintResultFavoriteValue {
  id: string;
  title: string;
  note: string;
  imageUrl: string;
  outputSize?: { width: number; height: number };
  generatedAt?: number;
  resultKind?: PrintResultKind;
}

export interface SavePrintResultFavoriteInput {
  brandId: string;
  result: PrintResultFavoriteValue;
  destinationLabel?: string;
}

export type SavePrintResultFavoriteResult =
  | { ok: true; artifact: WorkspaceArtifact }
  | { ok: false; error: Error };

export interface PrintResultFavoriteMetadata {
  printResultFavorite: boolean;
  printResultId: string;
  printResultKind?: PrintResultKind;
  printResultNote: string;
  printResultOutputSize?: { width: number; height: number };
  printResultGeneratedAt?: number;
  printResultDestinationLabel?: string;
  printResultFavoriteUpdatedAt: string;
}

const metadataValue = (
  metadata: Record<string, Json | undefined>,
  key: keyof PrintResultFavoriteMetadata,
) => metadata[key];

const buildFavoriteMetadata = (
  result: PrintResultFavoriteValue,
  isFavorite: boolean,
  destinationLabel?: string,
  existingArtifact?: WorkspaceArtifact | null,
): PrintResultFavoriteMetadata => ({
  printResultFavorite: isFavorite,
  printResultId: result.id,
  printResultKind: result.resultKind
    ?? (metadataValue(existingArtifact?.metadata ?? {}, 'printResultKind') as PrintResultKind | undefined),
  printResultNote: result.note,
  printResultOutputSize: result.outputSize
    ?? (metadataValue(existingArtifact?.metadata ?? {}, 'printResultOutputSize') as { width: number; height: number } | undefined),
  printResultGeneratedAt: result.generatedAt
    ?? (metadataValue(existingArtifact?.metadata ?? {}, 'printResultGeneratedAt') as number | undefined),
  printResultDestinationLabel: destinationLabel
    ?? (metadataValue(existingArtifact?.metadata ?? {}, 'printResultDestinationLabel') as string | undefined),
  printResultFavoriteUpdatedAt: new Date().toISOString(),
});

export const setPrintResultFavorite = ({
  brandId,
  result,
  destinationLabel,
}: SavePrintResultFavoriteInput, isFavorite: boolean): SavePrintResultFavoriteResult => {
  if (!brandId || !result.id || !result.imageUrl) {
    return { ok: false, error: new Error('Favorite requires a brand, result id, and image URL.') };
  }

  try {
    const existing = findWorkspaceArtifactPersisted(brandId, result.id);
    if (!existing.ok) return existing;
    const existingArtifact = existing.artifact;
    if (!isFavorite && !existingArtifact) {
      return { ok: false, error: new Error('Local print result was not found.') };
    }

    const favoriteMetadata = buildFavoriteMetadata(result, isFavorite, destinationLabel, existingArtifact);
    return saveWorkspaceArtifactPersisted({
      id: result.id,
      brandId,
      featureType: existingArtifact?.featureType ?? 'printing-result',
      title: result.title || existingArtifact?.title || '印刷結果',
      imageUrl: result.imageUrl,
      prompt: existingArtifact?.prompt ?? result.note ?? null,
      createdAt: existingArtifact?.createdAt
        ?? (result.generatedAt ? new Date(result.generatedAt).toISOString() : undefined),
      metadata: {
        ...existingArtifact?.metadata,
        ...favoriteMetadata,
      },
      canvasProjectId: existingArtifact?.canvasProjectId,
      sourceJobId: existingArtifact?.sourceJobId,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error('Local favorite persistence failed.'),
    };
  }
};

export const savePrintResultFavorite = (
  input: SavePrintResultFavoriteInput,
): SavePrintResultFavoriteResult => setPrintResultFavorite(input, true);

export const isPrintResultFavorite = (brandId: string, resultId: string): boolean => {
  const artifact = findWorkspaceArtifact(brandId, resultId);
  return artifact ? metadataValue(artifact.metadata, 'printResultFavorite') === true : false;
};

export const listPrintResultFavoriteIds = (brandId: string): string[] => (
  listWorkspaceArtifacts(brandId)
    .filter((artifact) => metadataValue(artifact.metadata, 'printResultFavorite') === true)
    .map((artifact) => artifact.id)
);
