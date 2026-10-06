import React from 'react';
import { createRoot } from 'react-dom/client';
import { SourceModelLibrarySurface } from '../../src/components/lightchain/SourceModelLibrarySurface';
import { forbidProbeOperation, readProbeWorkspace } from './model-combobox-native-probe-mocks';

// Installed before React mounts. No application request is accepted, including
// localhost API calls. Static ESM/CSS requests remain constrained by server/CSP.
window.fetch = async () => forbidProbeOperation('fetch');
window.XMLHttpRequest = class { constructor() { forbidProbeOperation('XMLHttpRequest'); } } as unknown as typeof XMLHttpRequest;
window.WebSocket = class { constructor() { forbidProbeOperation('WebSocket'); } } as unknown as typeof WebSocket;
window.EventSource = class { constructor() { forbidProbeOperation('EventSource'); } } as unknown as typeof EventSource;
Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => forbidProbeOperation('sendBeacon') });

const rootElement = document.getElementById('model-native-root');
const diagnostics = document.getElementById('model-native-diagnostics');
if (!rootElement || !diagnostics) throw new Error('model_native_probe_dom_missing');
const labels = { age: '年齢', nationality: '国籍', skinColor: '肌の色', bodyType: '体型' };
const keyboardEvents: Record<string, unknown>[] = [];
const errors: string[] = [];
const elementIdentity = (value: Element | null) => value ? {
  tagName: value.tagName.toLowerCase(), role: value.getAttribute('role'), label: value.getAttribute('aria-label'),
  id: value.id || null, text: value instanceof HTMLButtonElement ? value.textContent?.trim() ?? '' : null,
} : null;
function snapshot() {
  const workspace = readProbeWorkspace();
  const controls = Object.entries(labels).map(([field, label]) => {
    const trigger = rootElement!.querySelector<HTMLButtonElement>(`button[role="combobox"][aria-label="${label}"]`);
    return { field, label, value: trigger?.textContent?.trim() ?? null, expanded: trigger?.getAttribute('aria-expanded') === 'true', controls: trigger?.getAttribute('aria-controls') ?? null };
  });
  const tabs = [...rootElement!.querySelectorAll('button')].filter(button => ['ラベル', 'カスタム'].includes(button.textContent?.trim() ?? ''));
  return {
    contract: 'model-combobox-native-probe.v1', mounted: !!rootElement!.querySelector('[data-testid="lightchain-source-model-surface"]'),
    mode: tabs.find(button => button.classList.contains('border-[#65d3cf]'))?.textContent?.trim() ?? null,
    values: workspace.inputState, controls, openField: controls.find(control => control.expanded)?.field ?? null,
    listboxes: [...rootElement!.querySelectorAll('[role="listbox"]')].map(listbox => ({ id: listbox.id, label: listbox.getAttribute('aria-label'), options: [...listbox.querySelectorAll('[role="option"]')].map(option => option.textContent?.trim()) })),
    inputWrites: workspace.inputWrites, inputWritesByField: workspace.inputWritesByField, forbiddenCalls: workspace.forbiddenCalls,
    nativeDOMActiveElement: elementIdentity(document.activeElement), keyboardEvents: structuredClone(keyboardEvents),
    trustedInput: keyboardEvents.length ? keyboardEvents.every(event => event.isTrusted === true) : null,
    nativeDescendantKeyboard: 'unperformed: option divs are not focusable; no tabindex or DOM injection', errors: [...errors],
  };
}
function renderDiagnostics() { diagnostics!.textContent = JSON.stringify(snapshot(), null, 2); }
const refreshAfterReact = () => requestAnimationFrame(renderDiagnostics);
// Capture observes the native event without preventing/stopping/redispatching
// it. The deferred snapshot runs after the actual React handler and commit.
document.addEventListener('keydown', event => {
  const before = snapshot();
  const record: Record<string, unknown> = { key: event.key, isTrusted: event.isTrusted, target: elementIdentity(event.target instanceof Element ? event.target : null), before: { mode: before.mode, values: before.values, openField: before.openField, activeElement: before.nativeDOMActiveElement } };
  keyboardEvents.push(record);
  if (keyboardEvents.length > 64) keyboardEvents.shift();
  requestAnimationFrame(() => {
    const after = snapshot();
    record.defaultPreventedAfterReact = event.defaultPrevented;
    record.after = { mode: after.mode, values: after.values, openField: after.openField, activeElement: after.nativeDOMActiveElement, inputWrites: after.inputWrites };
    renderDiagnostics();
  });
}, { capture: true });
document.addEventListener('click', refreshAfterReact, { capture: true });
document.addEventListener('focusin', refreshAfterReact, { capture: true });
window.addEventListener('error', () => { errors.push('runtime_error'); refreshAfterReact(); });
window.addEventListener('unhandledrejection', () => { errors.push('unhandled_rejection'); refreshAfterReact(); });
new MutationObserver(refreshAfterReact).observe(rootElement, { subtree: true, childList: true, attributes: true });
Object.defineProperty(window, '__modelComboboxNativeProbe', { configurable: false, get: snapshot });
createRoot(rootElement).render(React.createElement(SourceModelLibrarySurface));
refreshAfterReact();
