import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDesignArtifactScopeKey,
  isCurrentDesignArtifactLoad,
} from '../src/lib/designProjectArtifacts.ts';
import {
  entriesForDesignProjectLoad,
  runDesignProjectArtifactLoad,
  type DesignProjectArtifactLoadState,
} from '../src/lib/designProjectLoader.ts';

type Entry = { id: string };

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const runLoad = (options: {
  local?: readonly string[];
  readRemote: () => Promise<readonly string[]>;
  signRemote?: (rows: readonly string[]) => Promise<readonly string[]>;
  isCurrent?: () => boolean;
  onState: (state: DesignProjectArtifactLoadState<Entry>) => void;
}) => runDesignProjectArtifactLoad({
  readLocalArtifacts: () => (options.local ?? []).map((id) => ({ id })),
  readRemoteArtifacts: options.readRemote,
  signRemoteArtifacts: options.signRemote,
  toEntries: (local, remote) => [...local, ...remote.map((id) => ({ id }))],
  isCurrent: options.isCurrent ?? (() => true),
  setState: options.onState,
});

test('remote errors remain an error with or without usable local entries', async () => {
  for (const local of [[], ['local-project']]) {
    const seen: DesignProjectArtifactLoadState<Entry>[] = [];
    const result = await runLoad({
      local,
      readRemote: async () => { throw new Error('remote_unavailable'); },
      onState: (state) => seen.push(state),
    });

    assert.equal(result?.status, 'error');
    assert.equal(seen.at(-1)?.status, 'error');
    assert.equal(seen.some((state) => state.status === 'empty'), false);
    assert.deepEqual(entriesForDesignProjectLoad(result!), local.map((id) => ({ id })));
    if (result?.status === 'error') assert.equal(result.remoteError, 'remote_unavailable');
  }
});

test('successful remote read with no supported local or remote results is genuinely empty', async () => {
  const seen: DesignProjectArtifactLoadState<Entry>[] = [];
  const result = await runLoad({
    readRemote: async () => [],
    onState: (state) => seen.push(state),
  });

  assert.deepEqual(seen.map((state) => state.status), ['loading', 'empty']);
  assert.deepEqual(result, { status: 'empty' });
  assert.deepEqual(entriesForDesignProjectLoad(result!), []);
});

test('signing failure keeps successful remote list rows usable', async () => {
  const seen: DesignProjectArtifactLoadState<Entry>[] = [];
  const result = await runLoad({
    readRemote: async () => ['remote-project'],
    signRemote: async () => { throw new Error('signing_unavailable'); },
    onState: (state) => seen.push(state),
  });

  assert.equal(result?.status, 'ready');
  assert.deepEqual(entriesForDesignProjectLoad(result!), [{ id: 'remote-project' }]);
  assert.deepEqual(seen.map((state) => state.status), ['loading', 'ready']);
});

test('read-only retry reruns only the list and signing read pipeline after remote error', async () => {
  const seen: DesignProjectArtifactLoadState<Entry>[] = [];
  let remoteReadCount = 0;
  let signingCount = 0;
  const request = {
    readLocalArtifacts: () => [] as readonly Entry[],
    readRemoteArtifacts: async () => {
      remoteReadCount += 1;
      if (remoteReadCount === 1) throw new Error('temporary_remote_failure');
      return ['remote-project'];
    },
    signRemoteArtifacts: async (rows: readonly string[]) => {
      signingCount += 1;
      return rows;
    },
    toEntries: (local: readonly Entry[], remote: readonly string[]) => [
      ...local,
      ...remote.map((id) => ({ id })),
    ],
    isCurrent: () => true,
    setState: (state: DesignProjectArtifactLoadState<Entry>) => seen.push(state),
  };

  const failed = await runDesignProjectArtifactLoad(request);
  assert.equal(failed?.status, 'error');
  const retried = await runDesignProjectArtifactLoad(request);

  assert.equal(retried?.status, 'ready');
  assert.deepEqual(entriesForDesignProjectLoad(retried!), [{ id: 'remote-project' }]);
  assert.deepEqual(seen.map((state) => state.status), ['loading', 'error', 'loading', 'ready']);
  assert.equal(remoteReadCount, 2);
  assert.equal(signingCount, 1);
});

test('an awaited remote response cannot commit after logout or a brand switch', async () => {
  const capturedScope = createDesignArtifactScopeKey('user-a', 'brand-a');
  const invalidatedScopes = [
    createDesignArtifactScopeKey(null, 'brand-a'),
    createDesignArtifactScopeKey('user-a', 'brand-b'),
  ];

  for (const liveScope of invalidatedScopes) {
    const pending = deferred<readonly string[]>();
    let currentLiveScope = capturedScope;
    let latestToken = 1;
    const seen: DesignProjectArtifactLoadState<Entry>[] = [];
    const load = runLoad({
      readRemote: () => pending.promise,
      isCurrent: () => isCurrentDesignArtifactLoad(capturedScope, currentLiveScope, 1, latestToken),
      onState: (state) => seen.push(state),
    });

    currentLiveScope = liveScope;
    pending.resolve(['old-scope-project']);
    await load;

    assert.deepEqual(seen.map((state) => state.status), ['loading']);
  }
});

test('late signing and an older retry cannot overwrite the current scoped request', async () => {
  const scopeA = createDesignArtifactScopeKey('user-a', 'brand-a');
  const scopeB = createDesignArtifactScopeKey('user-a', 'brand-b');
  const signingEntered = deferred<void>();
  const pendingSign = deferred<readonly string[]>();
  let liveScope = scopeA;
  let liveToken = 1;
  const signingStates: DesignProjectArtifactLoadState<Entry>[] = [];
  const signingLoad = runLoad({
    readRemote: async () => ['remote-row'],
    signRemote: () => {
      signingEntered.resolve(undefined);
      return pendingSign.promise;
    },
    isCurrent: () => isCurrentDesignArtifactLoad(scopeA, liveScope, 1, liveToken),
    onState: (state) => signingStates.push(state),
  });

  await signingEntered.promise;
  liveScope = scopeB;
  pendingSign.resolve(['signed-old-brand-row']);
  await signingLoad;
  assert.deepEqual(signingStates.map((state) => state.status), ['loading']);

  const olderRequest = deferred<readonly string[]>();
  const newerRequest = deferred<readonly string[]>();
  liveScope = scopeA;
  liveToken = 1;
  const retryStates: DesignProjectArtifactLoadState<Entry>[] = [];
  const olderLoad = runLoad({
    readRemote: () => olderRequest.promise,
    isCurrent: () => isCurrentDesignArtifactLoad(scopeA, liveScope, 1, liveToken),
    onState: (state) => retryStates.push(state),
  });
  liveToken = 2;
  const newerLoad = runLoad({
    readRemote: () => newerRequest.promise,
    isCurrent: () => isCurrentDesignArtifactLoad(scopeA, liveScope, 2, liveToken),
    onState: (state) => retryStates.push(state),
  });

  newerRequest.resolve(['newer-retry']);
  await newerLoad;
  olderRequest.resolve(['older-retry']);
  await olderLoad;

  assert.deepEqual(retryStates.map((state) => state.status), ['loading', 'loading', 'ready']);
  assert.deepEqual(entriesForDesignProjectLoad(retryStates.at(-1)!), [{ id: 'newer-retry' }]);
});
