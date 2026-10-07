import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { createPrintDraftSafetyCopy, inspectPrintDraftSafetyCopy, restorePrintDraftSafetyCopy } from '../lib/printInputPersistence';

/** Explicit debug controls; no automatic save, restore, download or provider operation. */
export function PrintDraftSafetyControls({ brandId, userId, origin, disabled }: {
  brandId: string; userId: string; origin: string; disabled: boolean;
}) {
  const [busy, setBusy] = useState(false), [output, setOutput] = useState('');
  const mounted = useRef(true), inFlight = useRef(false);
  const context = JSON.stringify([brandId, userId, origin, disabled, window.location.pathname, window.location.search]);
  const current = useRef(context); current.current = context;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setOutput(''); }, [context]);
  const run = async (action: 'copy' | 'inspect' | 'restore') => {
    if (disabled || inFlight.current) return;
    const auth = useAuthStore.getState(), brandState = auth.brandState;
    const path = window.location.pathname, search = window.location.search;
    const assertContext = () => {
      const latest = useAuthStore.getState();
      if (!mounted.current || current.current !== context || window.location.pathname !== path || window.location.search !== search
        || latest.user?.id !== userId || latest.currentBrand?.id !== brandId || latest.brandState !== brandState) throw new Error('print_draft_context_changed');
    };
    const options = { scope: { origin, userId }, assertContext };
    inFlight.current = true; setBusy(true); setOutput('確認中…');
    try {
      assertContext();
      if (action === 'copy') await createPrintDraftSafetyCopy(brandId, options);
      if (action === 'restore') await restorePrintDraftSafetyCopy(brandId, options);
      const result = await inspectPrintDraftSafetyCopy(brandId, options); assertContext();
      setOutput(JSON.stringify({ action, ...result }));
    } catch (error) {
      if (mounted.current && current.current === context) setOutput(JSON.stringify({ action, error: error instanceof Error ? error.message : 'print_draft_safety_failed' }));
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="mt-4 rounded border border-neutral-200 bg-white p-3" aria-label="下書き保全確認">
    <p className="mb-2 text-sm">現在の下書きの画像・加工結果・配置を、このブラウザ内に保全します。復元後はページを再読み込みしてください。</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled || busy} onClick={() => void run('copy')}>現在の下書きを保全</button>
      <button type="button" disabled={disabled || busy} onClick={() => void run('inspect')}>下書き保全内容を確認</button>
      <button type="button" disabled={disabled || busy} onClick={() => void run('restore')}>保全した下書きに戻す</button>
    </div>
    <pre data-testid="print-draft-safety-readback" className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{output}</pre>
  </section>;
}
