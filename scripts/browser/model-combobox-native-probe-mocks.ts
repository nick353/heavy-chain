import React from 'react';

type InputState = Record<string, unknown>;
const counters = { inputWrites: 0, inputWritesByField: {} as Record<string, number>, forbiddenCalls: [] as { operation: string; at: string }[] };
let currentInputs: InputState = {};

export function forbidProbeOperation(operation: string): never {
  counters.forbiddenCalls.push({ operation, at: new Date().toISOString() });
  throw new Error(`model_native_probe_forbidden:${operation}`);
}

export function readProbeWorkspace() {
  return { inputState: structuredClone(currentInputs), inputWrites: counters.inputWrites, inputWritesByField: { ...counters.inputWritesByField }, forbiddenCalls: counters.forbiddenCalls.map(value => ({ ...value })) };
}

// Only service dependencies of the actual surface are replaced. These mocks
// never import authentication, persistence, provider or application stores.
export function useCanonicalImageWorkspace(toolId: string, options: { initialInputState: InputState }) {
  const [inputState, setInput] = React.useState(options.initialInputState);
  currentInputs = inputState;
  return {
    toolId, inputState,
    setInputState(next: InputState) {
      counters.inputWrites++;
      for (const key of new Set([...Object.keys(inputState), ...Object.keys(next)])) {
        if (JSON.stringify(inputState[key]) !== JSON.stringify(next[key])) counters.inputWritesByField[key] = (counters.inputWritesByField[key] ?? 0) + 1;
      }
      setInput(next);
    },
    status: 'ready', pendingId: null, brief: '', jobId: null, originalInputsAvailable: true,
    candidates: [], slots: {}, error: null, result: null,
    generate: () => forbidProbeOperation('generate'),
    save: () => forbidProbeOperation('save'),
    upload: () => forbidProbeOperation('upload'),
    selectCandidate: () => forbidProbeOperation('selectCandidate'),
  };
}

export function CanonicalImageWorkspaceControls() {
  return React.createElement('section', { 'data-testid': 'model-native-service-boundary' }, 'Local input fixture: generation and saving are forbidden.');
}

export const useNavigate = () => () => forbidProbeOperation('navigate');
export const useLocation = () => ({ pathname: '/model-library/model-custom-form', search: '' });
export function Link({ children, ...props }: { children?: React.ReactNode; to?: string; [key: string]: unknown }) {
  const { to: _to, ...attributes } = props;
  return React.createElement('a', { ...attributes, href: '#fixture-navigation-disabled', onClick: (event: React.MouseEvent) => { event.preventDefault(); forbidProbeOperation('navigate'); } }, children);
}
const fixtureAuth = { user: { id: 'fixture-user' }, currentBrand: { id: 'fixture-brand' }, brandState: { status: 'success_nonempty', requestGeneration: 1 } };
export const useAuthStore = Object.assign(() => fixtureAuth, { getState: () => fixtureAuth });
export const listWorkspaceArtifacts = () => [];
export const readLightchainResumeResult = () => null;
export const cloudflareDataPlane = null;
export const captureAuthBrandFence = () => null;
export const assertAuthBrandFence = () => forbidProbeOperation('remoteIdentity');
