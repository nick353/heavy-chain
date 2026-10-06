import { cloudflareDataPlane, type CloudflareCanvasDocument } from '../../lib/cloudflareApi';
import { designEntryDetailHref } from './designEntryCoordinator';
import type { EntryDraftStore } from './entryDraftStore';
import type { DesignScope } from './types';

export type DesignProjectListClient = {
  listCanvasDocumentsPage(brandId: string, limit: number, offset: number,
    context: { userId: string; assertContext: () => void }): Promise<CloudflareCanvasDocument[]>;
};
export type DesignConversationProject = Readonly<{
  projectId: string;
  conversationId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  href: string;
}>;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
  && !/^[a-z][a-z\d+.-]*:/i.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 64 && Number.isFinite(Date.parse(value));
const verified = (row: CloudflareCanvasDocument, scope: DesignScope) => {
  const snapshot = row?.snapshot;
  return row && identifier(row.id) && row.owner_id === scope.userId && row.brand_id === scope.brandId
    && row.snapshot_version === 1 && Number.isSafeInteger(row.revision) && row.revision >= 0
    && snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    && snapshot.version === 1 && Array.isArray(snapshot.objects)
    && (snapshot.projectId === undefined || snapshot.projectId === row.id)
    && typeof row.title === 'string' && row.title.trim().length > 0 && row.title.length <= 160
    && !/[\u0000-\u001f\u007f]/u.test(row.title) && timestamp(row.created_at) && timestamp(row.updated_at);
};

/** Association IDs come only from scoped drafts, never from image artifacts or URL inference. */
export async function listDesignConversationProjects(options: {
  scope: DesignScope;
  drafts: Pick<EntryDraftStore, 'list'>;
  client?: DesignProjectListClient | null;
  assertContext: () => void;
}): Promise<DesignConversationProject[]> {
  const { scope, drafts, assertContext } = options;
  assertContext();
  const local = await drafts.list(scope, assertContext); assertContext();
  const client = options.client === undefined ? cloudflareDataPlane : options.client;
  if (!client) throw new Error('design_project_remote_unavailable');
  const rows = await client.listCanvasDocumentsPage(scope.brandId, 100, 0, { userId: scope.userId, assertContext });
  assertContext();
  if (!Array.isArray(rows)) throw new Error('design_project_remote_invalid');
  const byId = new Map<string, CloudflareCanvasDocument>();
  for (const row of rows) {
    if (verified(row, scope)) {
      if (byId.has(row.id)) throw new Error('design_project_remote_duplicate');
      byId.set(row.id, row);
    }
  }
  return local.flatMap((draft) => {
    const document = byId.get(draft.projectId);
    if (!document || !draft.ready || draft.scope.userId !== scope.userId || draft.scope.brandId !== scope.brandId
      || !identifier(draft.projectId) || !identifier(draft.conversationId)) return [];
    return [{ projectId: document.id, conversationId: draft.conversationId, title: document.title,
      createdAt: document.created_at, updatedAt: document.updated_at, revision: document.revision,
      href: designEntryDetailHref(document.id, draft.conversationId) }];
  }).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || left.projectId.localeCompare(right.projectId) || left.conversationId.localeCompare(right.conversationId));
}
