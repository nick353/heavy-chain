import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesignDialogueReferenceController } from '../src/lib/designDialogueReferences.ts';

const scope = { userId: 'restore-user', brandId: 'restore-brand', selectionId: 'design-production-dialogue', generation: 1 };
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};
const png = (name) => Object.assign(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])], { type: 'image/png' }), { name });
const context = { assertCurrent: async () => {} };
const never = () => new Promise(() => {});

// Leaves two unsent uploads in storage, as when the tab closed mid-upload.
const seedPendingUploads = async (storage) => {
  const seeding = createDesignDialogueReferenceController({
    storage,
    getCurrentScope: () => scope,
    encodeImage: async () => 'data:image/png;base64,AAAA',
    client: { captureArtifactPersistenceContext: async () => context, saveWorkspaceArtifact: never, readWorkspaceArtifact: never },
  });
  seeding.activate(scope);
  void seeding.addFile(png('multi1.png')).catch(() => {});
  void seeding.addFile(png('multi2.png')).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  seeding.dispose();
};

test('a stalled recovery read turns leftover references into failures instead of staying pending', async () => {
  const storage = memoryStorage();
  await seedPendingUploads(storage);
  const controller = createDesignDialogueReferenceController({
    storage,
    getCurrentScope: () => scope,
    restoreTimeoutMs: 20,
    client: { captureArtifactPersistenceContext: async () => context, saveWorkspaceArtifact: never, readWorkspaceArtifact: never },
  });
  const activated = controller.activate(scope);
  assert.deepEqual(activated.references.map((r) => r.status), ['pending', 'pending']);
  const restored = await controller.restore();
  assert.deepEqual(restored.references.map((r) => [r.name, r.status]), [['multi1.png', 'failure'], ['multi2.png', 'failure']]);
  assert.match(restored.references[0].error ?? '', /restore_timeout/);
});

test('removing a reference during recovery does not leave the next one pending', async () => {
  const storage = memoryStorage();
  await seedPendingUploads(storage);
  let controller;
  let firstRead = true;
  controller = createDesignDialogueReferenceController({
    storage,
    getCurrentScope: () => scope,
    restoreTimeoutMs: 1000,
    client: {
      captureArtifactPersistenceContext: async () => context,
      saveWorkspaceArtifact: never,
      readWorkspaceArtifact: async () => {
        if (firstRead) {
          firstRead = false;
          controller.remove(controller.snapshot().references[0].id);
        }
        throw new Error('cloudflare_api_404_workspace_artifact_not_found');
      },
    },
  });
  controller.activate(scope);
  const restored = await controller.restore();
  assert.deepEqual(restored.references.map((r) => [r.name, r.status]), [['multi2.png', 'failure']]);
});
