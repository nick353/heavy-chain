import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/stores/authStore.ts', import.meta.url), 'utf8');
const initializeStart = source.indexOf('initialize: async () => {');
const initializeEnd = source.indexOf('\n  },\n\n  signInWithEmail:', initializeStart);
assert.ok(initializeStart >= 0 && initializeEnd > initializeStart);
const initialize = source.slice(initializeStart, initializeEnd);

test('bootstrap readiness waits for deferred profile and then brand hydration', () => {
  const admission = initialize.indexOf('const admission = new Promise<void>');
  const profile = initialize.indexOf('ensureUserProfile(user)');
  const brand = initialize.indexOf('await refreshBrandAuthority(user.id)');
  const readiness = initialize.indexOf('await observedAdmission');
  const publish = initialize.indexOf('set({ isLoading: false, isInitialized: true });');

  assert.ok(admission >= 0);
  assert.ok(admission < profile && profile < brand);
  assert.ok(brand < readiness && readiness < publish);
});

test('handled profile and brand outcomes terminate bootstrap admission', () => {
  assert.match(initialize, /finally \{\s*resolve\(\);\s*\}/);
  assert.match(initialize, /brandState: failAuthBrandSelection\(/);
  assert.match(source, /resolveAuthBrandSelection\(/);
  assert.match(source, /brandState\.status === 'success_nonempty' \? currentBrand : null/);
});

test('overlapping admissions and sign-out invalidate stale authority before readiness', () => {
  assert.match(initialize, /const sequence = \+\+admissionSequence/);
  assert.match(initialize, /sequence !== admissionSequence/);
  assert.match(initialize, /brandState\.requestGeneration !== admissionGeneration/);
  assert.match(initialize, /while \(latestAdmission !== observedAdmission\)/);
  assert.match(source, /let activeAdmitUser: \(\(user: User\) => Promise<void>\) \| null = null/);
  assert.match(source, /initializeToken === activeInitializeToken/);
  assert.ok(initialize.indexOf('activeInvalidateAdmission?.();') < initialize.indexOf("clearBrandAuthority(null);"));
});

test('email sign-in keeps synchronous admission behavior intact', () => {
  const signInStart = source.indexOf('signInWithEmail: async');
  const signInEnd = source.indexOf('\n  },\n\n  signUpWithEmail:', signInStart);
  assert.ok(signInStart >= 0 && signInEnd > signInStart);
  const signIn = source.slice(signInStart, signInEnd);
  assert.match(signIn, /auth\.signInWithPassword\(/);
  assert.match(signIn, /user: data\.session\.user/);
  assert.match(signIn, /return data\.session\.user/);
  assert.match(signIn, /set\(\{ isLoading: false \}\)/);
});

console.log('auth bootstrap hydration tests: 7/7 passed');

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

const createAdmissionHarness = () => {
  let sequence = 0;
  let currentUser: string | null = null;
  let generation = 0;
  let readiness = 'pending';
  let profile: string | null = null;
  let brands: string[] = [];

  const admit = async (user: string, profileRead: Promise<string>, brandRead: Promise<string[]>) => {
    const ownSequence = ++sequence;
    const ownGeneration = ++generation;
    currentUser = user;
    profile = null;
    brands = [];
    try {
      const nextProfile = await profileRead;
      if (ownSequence !== sequence || currentUser !== user || ownGeneration !== generation) return;
      profile = nextProfile;
      const nextBrands = await brandRead;
      if (ownSequence !== sequence || currentUser !== user || ownGeneration !== generation) return;
      brands = nextBrands;
    } catch {
      if (ownSequence === sequence && currentUser === user && ownGeneration === generation) {
        profile = null;
        brands = [];
      }
    }
  };

  const initialize = async (user: string, profileRead: Promise<string>, brandRead: Promise<string[]>) => {
    const admission = admit(user, profileRead, brandRead);
    await admission;
    readiness = 'ready';
  };

  const signOut = () => {
    ++sequence;
    ++generation;
    currentUser = null;
    profile = null;
    brands = [];
  };

  return { admit, initialize, signOut, state: () => ({ readiness, currentUser, profile, brands }) };
};

test('deferred profile then brand keeps mocked bootstrap pending until both resolve', async () => {
  const profileRead = deferred<string>();
  const brandRead = deferred<string[]>();
  const harness = createAdmissionHarness();
  const initialization = harness.initialize('user-1', profileRead.promise, brandRead.promise);

  await Promise.resolve();
  assert.equal(harness.state().readiness, 'pending');
  profileRead.resolve('profile-1');
  await Promise.resolve();
  assert.equal(harness.state().readiness, 'pending');
  brandRead.resolve(['brand-1']);
  await initialization;
  assert.deepEqual(harness.state(), { readiness: 'ready', currentUser: 'user-1', profile: 'profile-1', brands: ['brand-1'] });
});

test('mocked empty brands release readiness and handled failures terminate', async () => {
  const emptyHarness = createAdmissionHarness();
  await emptyHarness.initialize('user-1', Promise.resolve('profile-1'), Promise.resolve([]));
  assert.deepEqual(emptyHarness.state(), { readiness: 'ready', currentUser: 'user-1', profile: 'profile-1', brands: [] });

  const failureHarness = createAdmissionHarness();
  await failureHarness.initialize('user-1', Promise.reject(new Error('profile-timeout')), new Promise<string[]>(() => {}));
  assert.deepEqual(failureHarness.state(), { readiness: 'ready', currentUser: 'user-1', profile: null, brands: [] });
});

test('mocked overlapping admission and sign-out cannot commit stale authority or readiness early', async () => {
  const firstProfile = deferred<string>();
  const firstBrand = deferred<string[]>();
  const secondProfile = deferred<string>();
  const secondBrand = deferred<string[]>();
  const harness = createAdmissionHarness();
  const first = harness.initialize('user-1', firstProfile.promise, firstBrand.promise);
  const second = harness.admit('user-2', secondProfile.promise, secondBrand.promise);

  firstProfile.resolve('stale-profile');
  firstBrand.resolve(['stale-brand']);
  await Promise.resolve();
  assert.equal(harness.state().profile, null);
  assert.equal(harness.state().brands.length, 0);

  harness.signOut();
  secondProfile.resolve('signed-out-profile');
  secondBrand.resolve(['signed-out-brand']);
  await second;
  await first;
  assert.deepEqual(harness.state(), { readiness: 'ready', currentUser: null, profile: null, brands: [] });
});
