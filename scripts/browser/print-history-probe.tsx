import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import '../../src/index.css';
import { LightchainMaterialWorkbenchPage } from '../../src/pages/LightchainMaterialWorkbenchPage';
import { LightchainUnifiedWorkspaceShell } from '../../src/components/workspace/LightchainUnifiedWorkspaceShell';
import { useAuthStore } from '../../src/stores/authStore';
import { auth } from '../../src/lib/auth';
import { cloudflareDataPlane } from '../../src/lib/cloudflareApi';
import { persistPrintResultHistory, restorePrintResultHistory, releaseRestoredPrintResult } from '../../src/lib/printResultHistoryPersistence';

const runId = sessionStorage.getItem('history-scope-probe-v2-run') || crypto.randomUUID();
sessionStorage.setItem('history-scope-probe-v2-run', runId);
const brandId = 'history-probe-' + runId, origin = 'https://history-probe.invalid';
const scope = (userId: string) => ({ origin, userId });
const checks: Record<string, boolean> = {};
const check = (value: unknown, label: string) => { checks[label] = Boolean(value); if (!value) throw new Error(label); };
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
const wait = async (fn: () => boolean) => { for (let i = 0; i < 200; i++) { if (fn()) return; await pause(); } throw new Error('UI wait timeout'); };
const region = () => document.querySelector('[data-testid="print-result-run-history"]');
const has = (name: string) => Boolean(region()?.textContent?.includes(name));
let generation = 0;
const select = (userId: string | null) => {
  const now = new Date().toISOString();
  const brand = { id: brandId, owner_id: userId, name: 'Synthetic history', brand_colors: [], logo_url: null, tone_description: null, target_audience: null, created_at: now, updated_at: now };
  flushSync(() => useAuthStore.setState({ user: userId ? { id: userId, email: 'local@example.test' } : null, currentBrand: userId ? brand : null, brands: userId ? [brand] : [], isInitialized: true, isLoading: false,
    brandState: { status: userId ? 'success_nonempty' : 'success_empty', userId, requestGeneration: ++generation, confirmedBrandIds: userId ? [brandId] : [], error: null }, refreshCurrentBrand: async () => {} } as any));
};
auth.getSession = async () => ({ data: { session: useAuthStore.getState().user ? { user: useAuthStore.getState().user, access_token: 'synthetic-not-a-credential' } : null }, error: null }) as any;
Object.assign(cloudflareDataPlane!, { request: async () => { throw new Error('probe_remote_request_forbidden'); } });
const result = (userId: string, imageUrl: string) => ({ id: 'print-' + userId, brandId, title: userId + ' synthetic result', note: 'Local synthetic PNG, not AI', imageUrl, runId: userId, resultKind: 'exact' as const, generationMode: 'preview' as const });
let phase = 'initial';
try {
  phase = sessionStorage.getItem('history-scope-probe-v2-seeded') ? 'reload' : 'initial';
  if (phase === 'initial') {
    for (const [userId, color] of [['alice', '#ef4444'], ['bob', '#3b82f6']]) {
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 80;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 64, 80);
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
      const url = URL.createObjectURL(blob);
      const exact = result(userId, url);
      await persistPrintResultHistory(brandId, [exact, { ...exact, id: exact.id + '-fabric', resultKind: 'fabric' }], scope(userId)); URL.revokeObjectURL(url);
    }
    sessionStorage.setItem('history-scope-probe-v2-seeded', 'true');
  }
  for (const userId of ['alice', 'bob']) {
    const rows = await restorePrintResultHistory(brandId, scope(userId));
    check(rows.length === 2 && rows[0].id === 'print-' + userId, userId + ' isolated IDB roundtrip');
    const img = new Image(); img.src = rows[0].imageUrl; await img.decode();
    check(img.naturalWidth === 64 && img.naturalHeight === 80, userId + ' PNG decoded'); rows.forEach(releaseRestoredPrintResult);
  }
  check((await restorePrintResultHistory(brandId, { origin: 'https://other-probe.invalid', userId: 'alice' })).length === 0, 'origin isolation');
  history.replaceState(null, '', '/lightchain/printing-image');
  select('alice');
  createRoot(document.querySelector('#root')!).render(<BrowserRouter><LightchainUnifiedWorkspaceShell><LightchainMaterialWorkbenchPage /></LightchainUnifiedWorkspaceShell></BrowserRouter>);
  await wait(() => has('alice synthetic result'));
  check(!has('bob synthetic result'), 'Alice UI excludes Bob');
  select('bob');
  check(!has('alice synthetic result'), 'switch hides Alice synchronously');
  await wait(() => has('bob synthetic result'));
  check(!has('alice synthetic result'), 'Bob UI excludes Alice');
  select(null); check(!has('bob synthetic result'), 'logout hides Bob synchronously');
  select('alice'); await wait(() => has('alice synthetic result'));
  check(!has('bob synthetic result'), 'login restores only Alice');
  const report = { runId, phase, status: 'passed', checks, synthetic: true, productionVerified: false };
  document.querySelector('#report')!.textContent = JSON.stringify(report, null, 2);
  await fetch('/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) });
} catch (error) {
  const state = useAuthStore.getState();
  const report = { runId, phase, status: 'failed', checks, error: String(error), apiOrigin: cloudflareDataPlane?.origin,
    auth: { userId: state.user?.id, brandId: state.currentBrand?.id, brandState: state.brandState },
    historyText: region()?.textContent,
    metadata: Object.keys(localStorage).filter(key => key.includes(brandId)).map(key => [key, localStorage.getItem(key)]) };
  document.querySelector('#report')!.textContent = JSON.stringify(report, null, 2);
  await fetch('/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) });
}
