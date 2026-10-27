import { saveWorkspaceArtifactBestEffort } from './localWorkspaceArtifacts';

const readFileAsDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('library_upload_read_failed')));
  reader.onerror = () => reject(reader.error ?? new Error('library_upload_read_failed'));
  reader.readAsDataURL(file);
});

/**
 * Light keeps every image uploaded inside a tool in the library's 履歴アップロード. Best effort: a failed copy never
 * blocks the tool, and it is only called for uploads the user made (never for draft restores, which would duplicate).
 */
export async function recordLibraryUpload({ brandId, userId, file }: { brandId: string; userId?: string | null; file: File }) {
  try {
    const imageUrl = await readFileAsDataUrl(file);
    await saveWorkspaceArtifactBestEffort({
      brandId,
      scopeId: userId ?? undefined,
      featureType: 'lightchain-library-upload',
      title: file.name.replace(/\.[^.]+$/u, '') || 'アップロード素材',
      imageUrl,
      prompt: null,
      metadata: { librarySource: 'upload', libraryGroup: '履歴アップロード', originalFileName: file.name, mimeType: file.type },
    });
  } catch {
    /* The tool keeps working with its local copy. */
  }
}
