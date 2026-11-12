import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { saveSvgFile, traceImageUrlToVector } from '../../lib/vectorTraceClient';

/**
 * Converts the saved raster result into an editable SVG in the browser and offers it as a download next to the
 * result. The outlines are traced with curves by VTracer (lib/vectorTrace; a 平絵 is split into ink and paper first).
 * Before 2026-11-12 this traced 640px pixel edges into straight polygons, so a print's stems came out as steps.
 * The SVG is derived from the saved image, so it is rebuilt the same way after a reload.
 */
export function SvgExportPanel({ imageUrl, fileName, colors = 8 }: { imageUrl: string; fileName: string; colors?: number }) {
  const [state, setState] = useState<{ status: 'tracing' } | { status: 'ready'; svg: string; pathCount: number; colorCount: number } | { status: 'error' }>({ status: 'tracing' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'tracing' });
    traceImageUrlToVector(imageUrl, { colors, detail: 'normal' })
      .then(({ svg, pathCount, colors: palette }) => { if (!cancelled) setState({ status: 'ready', svg, pathCount, colorCount: palette.length }); })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [imageUrl, colors]);

  const download = () => {
    if (state.status !== 'ready') return;
    saveSvgFile(state.svg, fileName);
  };

  return (
    <div className="flex items-center gap-3 text-xs text-neutral-300" data-testid="svg-export-panel" data-svg-status={state.status}>
      <button type="button" data-testid="svg-export-download" disabled={state.status !== 'ready'} onClick={download} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#5fd0c8] px-3 text-sm font-medium text-slate-950 disabled:opacity-50">
        <Download aria-hidden="true" className="h-4 w-4" />SVGをダウンロード
      </button>
      {state.status === 'tracing' && <span role="status">ベクターに変換中…</span>}
      {state.status === 'ready' && <span>{state.colorCount}色 / {state.pathCount}パス</span>}
      {state.status === 'error' && <span role="alert" className="text-rose-200">SVGに変換できませんでした</span>}
    </div>
  );
}
