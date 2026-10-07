import { getWorkspaceArtifactCanonicalStoragePath, type WorkspaceArtifact } from './localWorkspaceArtifacts';
import { getLocalCanvasAsset, isLocalCanvasAssetReference } from './canvasLocalAssets';
import { withSignedImageUrls } from './storage';

/** Read an owned original source without saving, inference, or substituting another asset. */
export async function readWorkspaceArtifactImage(artifact: WorkspaceArtifact, scope: {brandId:string;userId:string}) {
  if (!scope.brandId || !scope.userId || artifact.brandId !== scope.brandId || artifact.scopeId !== scope.userId) throw new Error('library_source_scope_mismatch');
  const storagePath = getWorkspaceArtifactCanonicalStoragePath(artifact.metadata);
  if (storagePath) {
    const [signed] = await withSignedImageUrls([{storage_path:storagePath,image_url:''}]);
    if (!signed?.image_url) throw new Error('library_source_signing_failed');
    return {imageUrl:signed.image_url,storagePath,localAssetRef:undefined};
  }
  const localAssetRef = isLocalCanvasAssetReference(artifact.imageUrl) ? artifact.imageUrl
    : isLocalCanvasAssetReference(artifact.metadata.localAssetRef) ? artifact.metadata.localAssetRef : undefined;
  if (localAssetRef) {
    const blob = await getLocalCanvasAsset(localAssetRef);
    if (!blob || blob.size === 0 || !blob.type.startsWith('image/')) throw new Error('library_source_bytes_unavailable');
    const imageUrl = await new Promise<string>((resolve,reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('library_source_read_failed'));
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('library_source_read_failed'));
      reader.readAsDataURL(blob);
    });
    return {imageUrl,storagePath:null,localAssetRef};
  }
  // Existing inline uploads remain compatible; unknown or expired network URLs do not.
  if (!/^(?:data:image\/|blob:|\/assets\/)/i.test(artifact.imageUrl)) throw new Error('library_source_unavailable');
  return {imageUrl:artifact.imageUrl,storagePath:null,localAssetRef:undefined};
}
