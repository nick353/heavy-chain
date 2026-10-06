import { useCallback, useEffect, useRef, useState } from 'react';
import { cloudflareDataPlane } from '../../lib/cloudflareApi';
import {
  createDesignDialogueReferenceController,
  type DesignDialogueManifestReference,
  type DesignDialogueReferenceFile,
  type DesignDialogueReferenceView,
} from '../../lib/designDialogueReferences';
import { resolveGeneratedImageUrlWithStatus } from '../../lib/storage';

type Controller = ReturnType<typeof createDesignDialogueReferenceController>;

/**
 * Pending reference images for the next dialogue send. Each file is saved as a
 * private generated_images row before it can be sent, so the assistant and the
 * image request only ever see canonical IDs.
 */
export function useDialogueReferences(options: { userId: string; brandId: string; selectionId: string }) {
  const { userId, brandId, selectionId } = options;
  const [references, setReferences] = useState<DesignDialogueReferenceView[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<Controller | null>(null);
  const localUrls = useRef(new Map<string, string>());

  useEffect(() => {
    setReferences([]);
    setPreviews({});
    setError(null);
    if (!userId || !brandId || !cloudflareDataPlane) return undefined;
    const scope = { userId, brandId, selectionId, generation: 1 };
    let active = true;
    const controller = createDesignDialogueReferenceController({
      client: cloudflareDataPlane,
      storage: window.localStorage,
      getCurrentScope: () => (active ? scope : null),
      publish: (snapshot) => { if (active) setReferences(snapshot.references); },
    });
    controllerRef.current = controller;
    try {
      setReferences(controller.activate(scope).references);
      void controller.restore().then((snapshot) => { if (active) setReferences(snapshot.references); }).catch(() => undefined);
    } catch {
      setError('参考画像を読み込めませんでした');
    }
    const urls = localUrls.current;
    return () => {
      active = false;
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [brandId, selectionId, userId]);

  // Restored (reloaded) references have no local bytes; show their private copy instead.
  useEffect(() => {
    let cancelled = false;
    for (const reference of references) {
      const path = reference.receipt?.storagePath;
      if (!path || localUrls.current.has(reference.id) || previews[reference.id]) continue;
      void resolveGeneratedImageUrlWithStatus(path).then((resolved) => {
        if (!cancelled && resolved.ok && resolved.url) setPreviews((current) => ({ ...current, [reference.id]: resolved.url! }));
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [previews, references]);

  const addFiles = useCallback(async (files: readonly File[]) => {
    const controller = controllerRef.current;
    if (!controller) { setError('参考画像を保存できませんでした'); return; }
    setError(null);
    await Promise.all(files.map(async (file) => {
      try {
        const position = controller.snapshot().references.length;
        const operation = controller.addFile(file as DesignDialogueReferenceFile);
        const added = controller.snapshot().references[position];
        if (added) {
          const url = URL.createObjectURL(file);
          localUrls.current.set(added.id, url);
          setPreviews((current) => ({ ...current, [added.id]: url }));
        }
        setReferences(controller.snapshot().references);
        await operation;
      } catch (cause) {
        const code = cause instanceof Error && /^[a-z0-9_:-]{1,96}$/i.test(cause.message) ? cause.message : 'design_dialogue_reference_failed';
        setError(`参考画像を保存できませんでした（${code}）`);
      }
    }));
  }, []);

  const remove = useCallback((referenceId: string) => {
    const controller = controllerRef.current;
    if (!controller) return;
    try {
      setReferences(controller.remove(referenceId).references);
      const url = localUrls.current.get(referenceId);
      if (url) URL.revokeObjectURL(url);
      localUrls.current.delete(referenceId);
    } catch { /* stale scope: the next activation restores the durable list */ }
  }, []);

  /** Returns the canonical manifest for a send; throws while any upload is still saving. */
  const manifest = useCallback((): DesignDialogueManifestReference[] => {
    const controller = controllerRef.current;
    if (!controller) return [];
    return controller.prepareForSend();
  }, []);

  const clear = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    for (const reference of controller.snapshot().references) remove(reference.id);
  }, [remove]);

  const ready = references.every((reference) => reference.status === 'ready' && Boolean(reference.receipt));
  return { references, previews, error, ready, addFiles, remove, manifest, clear };
}
