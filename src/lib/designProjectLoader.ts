export type DesignProjectArtifactLoadState<Entry> =
  | { status: 'loading' }
  | { status: 'ready'; entries: Entry[] }
  | { status: 'empty' }
  | { status: 'error'; remoteError: string; localEntries: Entry[] };

export type DesignProjectArtifactLoadRequest<Local, Remote, Entry> = {
  readLocalArtifacts: () => readonly Local[];
  readRemoteArtifacts: () => Promise<readonly Remote[]>;
  signRemoteArtifacts?: (rows: readonly Remote[]) => Promise<readonly Remote[]>;
  toEntries: (local: readonly Local[], remote: readonly Remote[]) => readonly Entry[];
  isCurrent: () => boolean;
  setState: (state: DesignProjectArtifactLoadState<Entry>) => void;
  describeRemoteError?: (error: unknown) => string;
};

const describeError = (error: unknown): string => (
  error instanceof Error && error.message.trim() ? error.message : 'remote_read_failed'
);

/**
 * Read Design's persisted artifacts without turning a failed remote read into
 * a genuine empty state. Image signing is best-effort; remote list failures are
 * surfaced while retaining any local artifacts.
 */
export const runDesignProjectArtifactLoad = async <Local, Remote, Entry>(
  request: DesignProjectArtifactLoadRequest<Local, Remote, Entry>,
): Promise<DesignProjectArtifactLoadState<Entry> | null> => {
  if (!request.isCurrent()) return null;
  request.setState({ status: 'loading' });

  const localArtifacts = request.readLocalArtifacts();
  if (!request.isCurrent()) return null;

  let remoteRows: readonly Remote[];
  try {
    remoteRows = await request.readRemoteArtifacts();
  } catch (error) {
    if (!request.isCurrent()) return null;
    const localEntries = [...request.toEntries(localArtifacts, [])];
    const state: DesignProjectArtifactLoadState<Entry> = {
      status: 'error',
      remoteError: request.describeRemoteError?.(error) ?? describeError(error),
      localEntries,
    };
    request.setState(state);
    return state;
  }
  if (!request.isCurrent()) return null;

  let resolvedRows = remoteRows;
  if (request.signRemoteArtifacts) {
    try {
      resolvedRows = await request.signRemoteArtifacts(remoteRows);
    } catch {
      // Signing is an enhancement to successfully read list rows, not an error
      // that should hide otherwise real, openable remote project metadata.
      resolvedRows = remoteRows;
    }
    if (!request.isCurrent()) return null;
  }

  const entries = [...request.toEntries(localArtifacts, resolvedRows)];
  if (!request.isCurrent()) return null;
  const state: DesignProjectArtifactLoadState<Entry> = entries.length > 0
    ? { status: 'ready', entries }
    : { status: 'empty' };
  request.setState(state);
  return state;
};

export const entriesForDesignProjectLoad = <Entry>(
  state: DesignProjectArtifactLoadState<Entry>,
): Entry[] => {
  if (state.status === 'ready') return state.entries;
  if (state.status === 'error') return state.localEntries;
  return [];
};
