import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act } from 'react';
import Reconciler from 'react-reconciler';
import * as existingHostConfig from 'react-konva/lib/ReactKonvaHostConfig.js';
import { ConcurrentRoot } from 'react-reconciler/constants.js';
import { createServer } from 'vite';

// Existing UI suites launch Chromium. This accepted package forbids browser
// operations/installations, so use the already installed React renderer stack
// with a local host adapter. React hooks, commits, callbacks and refs are real;
// host keyboard bubbling/focus is the isolated boundary, not native-browser proof.
type Host = { type: string; props: Record<string, any>; children: Host[]; parent: Host | null; text?: string; focus(): void };
let activeElement: Host | null = null;
let focusCalls = 0;
const link = (parent: Host, child: Host, before?: Host) => {
  if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
  child.parent = parent;
  const at = before ? parent.children.indexOf(before) : -1;
  if (at < 0) parent.children.push(child); else parent.children.splice(at, 0, child);
};
const remove = (parent: Host, child: Host) => { parent.children.splice(parent.children.indexOf(child), 1); child.parent = null; };
const host = (type: string, props: Record<string, any> = {}): Host => ({ type, props, children: [], parent: null, focus() { activeElement = this; focusCalls++; } });
const renderer = Reconciler({
  ...existingHostConfig,
  createInstance: (type: string, props: Record<string, any>) => host(type, props),
  createTextInstance: (text: string) => ({ ...host('#text'), text }),
  appendInitialChild: link, appendChild: link, appendChildToContainer: link,
  insertBefore: link, insertInContainerBefore: link, removeChild: remove, removeChildFromContainer: remove,
  commitUpdate: (instance: Host, _type: string, _oldProps: unknown, newProps: Record<string, any>) => { instance.props = newProps; },
  commitTextUpdate: (instance: Host, _old: string, text: string) => { instance.text = text; },
  getPublicInstance: (instance: Host) => instance,
  prepareForCommit: () => null, resetAfterCommit() {}, finalizeInitialChildren: () => false,
  clearContainer: (container: Host) => { container.children.length = 0; }, resetTextContent: (instance: Host) => { instance.children.length = 0; },
  hideInstance() {}, hideTextInstance() {}, unhideInstance() {}, unhideTextInstance() {},
});
const originalAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mocks: Record<string, string> = {
  'react-router-dom': `import React from 'react'; export const useNavigate=()=>()=>{globalThis.__modelEscapeFixture.navigation++;}; export const useLocation=()=>({pathname:'/model-library/model-custom-form',search:''}); export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);`,
  '../../hooks/useCanonicalImageWorkspace': `import React from 'react'; export function useCanonicalImageWorkspace(toolId,options){const f=globalThis.__modelEscapeFixture;const [inputState,setInput]=React.useState(options.initialInputState);f.inputState=inputState;return{toolId,inputState,setInputState:next=>{f.inputWrites++;setInput(next);},status:f.status,pendingId:null,brief:'',jobId:null,originalInputsAvailable:true,candidates:[],slots:{},error:null,result:null,generate:()=>{f.submitCalls++;},upload:()=>{throw new Error('fixture_upload_forbidden');}};}`,
  '../CanonicalImageWorkspaceControls': `import React from 'react'; export const CanonicalImageWorkspaceControls=()=>React.createElement('section',{'data-testid':'workspace-boundary'});`,
  '../../stores/authStore': `const state={user:{id:'fixture-user'},currentBrand:{id:'fixture-brand'},brandState:{status:'success_nonempty',requestGeneration:1}};export const useAuthStore=Object.assign(()=>state,{getState:()=>state});`,
  '../../lib/localWorkspaceArtifacts': `export const listWorkspaceArtifacts=()=>[];`,
  '../../lib/lightchainResume': `export const readLightchainResumeResult=()=>null;`,
  '../../lib/cloudflareApi': `export const cloudflareDataPlane=null;`,
  '../../lib/authBrandSelection': `export const captureAuthBrandFence=()=>null;export const assertAuthBrandFence=()=>{throw new Error('fixture_remote_identity_forbidden');};`,
};
const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, ssr: { noExternal: ['react-router-dom'] }, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{
  name: 'model-escape-service-boundaries', enforce: 'pre',
  resolveId(source, importer) { if (importer?.endsWith('/SourceModelLibrarySurface.tsx') && mocks[source]) return '\0model-escape:' + source; },
  load(id) { if (id.startsWith('\0model-escape:')) return mocks[id.slice('\0model-escape:'.length)]; },
}] });
const { SourceModelLibrarySurface } = await vite.ssrLoadModule('/src/components/lightchain/SourceModelLibrarySurface.tsx');
after(async () => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalAct; delete (globalThis as any).__modelEscapeFixture; await vite.close(); });

const all = (root: Host): Host[] => [root, ...root.children.flatMap(all)];
const text = (node: Host): string => node.text ?? node.children.map(text).join('');
const fields = { age: '年齢', nationality: '国籍', skinColor: '肌の色', bodyType: '体型' };
async function fixture(mode: 'ラベル' | 'カスタム' = 'ラベル') {
  const service = { inputWrites: 0, submitCalls: 0, navigation: 0, status: 'ready', inputState: {} as Record<string, unknown> };
  (globalThis as any).__modelEscapeFixture = service;
  activeElement = null; focusCalls = 0;
  const container = host('root'); let escapedToParent = 0;
  const root = renderer.createContainer(container, ConcurrentRoot, null, false, null, '', (error: Error) => { throw error; }, (error: Error) => { throw error; }, (error: Error) => { throw error; }, null);
  const render = async () => { await act(async () => { renderer.updateContainer(React.createElement('div', { onKeyDown: () => { escapedToParent++; } }, React.createElement(SourceModelLibrarySurface)), root, null, null); }); };
  await render();
  const trigger = (field: keyof typeof fields) => { const node = all(container).find(n => n.props.role === 'combobox' && n.props['aria-label'] === fields[field]); assert(node); return node; };
  const listboxes = () => all(container).filter(n => n.props.role === 'listbox');
  const click = async (node: Host) => { if (node.type === 'button') node.focus(); await act(async () => { node.props.onClick?.({ target: node, currentTarget: node }); }); };
  const key = async (node: Host, value: string) => {
    const event = { key: value, target: node, currentTarget: node, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    await act(async () => { for (let target: Host | null = node; target && !event.stopped; target = target.parent) { event.currentTarget = target; target.props.onKeyDown?.(event); } });
    return event;
  };
  const tab = (name: string) => { const node = all(container).find(n => n.type === 'button' && text(n) === name); assert(node); return node; };
  if (mode === 'カスタム') await click(tab(mode));
  const snapshot = () => ({ inputs: structuredClone(service.inputState), modes: ['ラベル', 'カスタム'].map(name => ({ name, className: tab(name).props.className })), submitCalls: service.submitCalls, inputWrites: service.inputWrites, navigation: service.navigation });
  return { container, root, service, trigger, listboxes, click, key, tab, snapshot, parentKeys: () => escapedToParent, unmount: async () => { await act(async () => { renderer.updateContainer(null, root, null, null); }); } };
}

for (const mode of ['ラベル', 'カスタム'] as const) for (const field of Object.keys(fields) as (keyof typeof fields)[]) test(`${mode}/${field}: mounted actual component open Escape closes only that field, preserves all inputs/mode/submit and trigger focus`, async () => {
  const f = await fixture(mode);
  try {
    const before = f.snapshot(), trigger = f.trigger(field); await f.click(trigger);
    assert.equal(trigger.props['aria-expanded'], true); assert.equal(f.listboxes().length, 1);
    assert.equal(f.listboxes()[0].props.id, trigger.props['aria-controls']);
    const event = await f.key(trigger, 'Escape');
    assert.equal(event.prevented, true); assert.equal(event.stopped, true); assert.equal(f.parentKeys(), 0);
    assert.equal(f.listboxes().length, 0); assert.equal(trigger.props['aria-expanded'], false); assert.equal(activeElement, trigger); assert.deepEqual(f.snapshot(), before);
    for (const other of Object.keys(fields) as (keyof typeof fields)[]) assert.equal(f.trigger(other).props['aria-expanded'], false);
  } finally { await f.unmount(); }
});

test('mounted actual component closed Escape and non-Escape keys remain unhandled; closed Escape never reopens', async () => {
  const f = await fixture();
  try {
    const before = f.snapshot(), trigger = f.trigger('age'), focusBefore = focusCalls;
    const closed = await f.key(trigger, 'Escape'); assert.equal(closed.prevented, false); assert.equal(closed.stopped, false); assert.equal(f.listboxes().length, 0); assert.equal(focusCalls, focusBefore); assert.deepEqual(f.snapshot(), before);
    await f.click(trigger); const other = await f.key(trigger, 'ArrowDown'); assert.equal(other.prevented, false); assert.equal(other.stopped, false); assert.equal(trigger.props['aria-expanded'], true); assert.equal(f.listboxes().length, 1); assert.equal(f.parentKeys(), 2); assert.deepEqual(f.snapshot(), before);
  } finally { await f.unmount(); }
});

test('listbox descendant Escape bubbles to actual wrapper, closes and restores trigger ref focus without option selection', async () => {
  const f = await fixture('カスタム');
  try {
    const before = f.snapshot(), trigger = f.trigger('nationality'); await f.click(trigger);
    const option = all(f.listboxes()[0]).find(n => n.props.role === 'option' && text(n) === '日本'); assert(option); option.focus(); assert.equal(activeElement, option);
    const event = await f.key(option, 'Escape'); assert.equal(event.prevented, true); assert.equal(event.stopped, true); assert.equal(f.parentKeys(), 0); assert.equal(f.listboxes().length, 0); assert.equal(activeElement, trigger); assert.deepEqual(f.snapshot(), before);
  } finally { await f.unmount(); }
});

test('actual parent onClose binding cannot toggle or close a different field; opening another field and mode switch preserve workspace/submit', async () => {
  const f = await fixture();
  try {
    await f.click(f.trigger('age'));
    const findFiber = (fiber: any): any => { if (!fiber) return null; if (fiber.type?.name === 'SourceModelCombobox' && fiber.memoizedProps.field === 'age') return fiber; return findFiber(fiber.child) ?? findFiber(fiber.sibling); };
    const age = findFiber(f.root.current); assert(age); const closeAge = age.memoizedProps.onClose; assert.equal(typeof closeAge, 'function');
    await f.click(f.trigger('bodyType')); const before = f.snapshot();
    await act(async () => { closeAge(); }); assert.equal(f.trigger('bodyType').props['aria-expanded'], true); assert.equal(f.trigger('age').props['aria-expanded'], false); assert.equal(f.listboxes().length, 1); assert.deepEqual(f.snapshot(), before);
    await f.click(f.tab('カスタム')); assert.equal(f.trigger('bodyType').props['aria-expanded'], true); assert.deepEqual(f.service.inputState, before.inputs); assert.equal(f.service.submitCalls, 0); assert.equal(f.service.inputWrites, 0);
  } finally { await f.unmount(); }
});

for (const mode of ['ラベル', 'カスタム'] as const) test(`${mode}: existing option selection still commits exactly selected field, closes and retains age's seven options`, async () => {
  const f = await fixture(mode);
  try {
    const before = f.snapshot(); await f.click(f.trigger('age'));
    const options = all(f.listboxes()[0]).filter(n => n.props.role === 'option'); assert.deepEqual(options.map(text), ['スマート', '赤ちゃん', '子供', 'ティーン', '青年', '中年', '老年']);
    await f.click(options.find(n => text(n) === '青年')!); assert.equal(f.listboxes().length, 0); assert.equal(f.trigger('age').props['aria-expanded'], false); assert.equal(text(f.trigger('age')), '青年');
    assert.deepEqual(f.service.inputState, { ...before.inputs, age: '青年' }); assert.equal(f.service.inputWrites, 1); assert.equal(f.service.submitCalls, 0); assert.deepEqual(f.snapshot().modes, before.modes);
  } finally { await f.unmount(); }
});
