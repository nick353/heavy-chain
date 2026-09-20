export type FashionStudioRemoteProject = {
  id: string;
  title: string;
  updatedAt: string;
  imageUrl: string;
};

export type FashionStudioLocalProject = FashionStudioRemoteProject & {
  canvasProjectId?: string;
};

export type FashionStudioProjectCard = FashionStudioRemoteProject & {
  source: 'remote' | 'local';
  canvasProjectId?: string;
};

/**
 * Light's saved Fashion Studio cards reopen in the feature detail route.
 * Keep this route contract independent from the Heavy Canvas handoff used by
 * a newly generated workspace.
 */
export const buildFashionStudioProjectHref = (project: Pick<FashionStudioProjectCard, 'id' | 'canvasProjectId'>): string =>
  `/flow/integration/detail?boardProjectCode=${encodeURIComponent(project.canvasProjectId ?? project.id)}&boardProjectType=integrationCustom`;

/**
 * Merge the authenticated Canvas index with the browser-local handoff index.
 * A local handoff whose canvasProjectId is already present remotely is the
 * same persisted project and must not be rendered as a second card.
 */
export const mergeFashionStudioProjectCards = (
  remoteProjects: readonly FashionStudioRemoteProject[],
  localProjects: readonly FashionStudioLocalProject[],
): FashionStudioProjectCard[] => {
  const remoteIds = new Set(remoteProjects.map((project) => project.id));
  const remoteTitles = new Set(remoteProjects.map((project) => project.title.trim()).filter(Boolean));
  const seenIds = new Set<string>();
  const cards: FashionStudioProjectCard[] = [];

  for (const project of remoteProjects) {
    if (seenIds.has(project.id)) continue;
    seenIds.add(project.id);
    cards.push({ ...project, source: 'remote' });
  }

  for (const project of localProjects) {
    if (project.canvasProjectId && remoteIds.has(project.canvasProjectId)) continue;
    // Older browser-local handoffs may not retain the remote Canvas ID. When
    // the authenticated Canvas index already owns the same title, it is the
    // canonical card and the local fallback must not render a duplicate.
    if (remoteTitles.has(project.title.trim())) continue;
    if (seenIds.has(project.id)) continue;
    seenIds.add(project.id);
    cards.push({ ...project, source: 'local' });
  }

  return cards;
};
