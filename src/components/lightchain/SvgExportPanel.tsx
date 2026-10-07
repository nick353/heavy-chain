import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { traceImageUrlToSvg } from '../../lib/rasterToSvg';

/**
 * Converts the saved raster result into an editable SVG in the browser (colour regions → filled paths) and
 * offers it as a download next to the result. The SVG is derived from the saved image, so it is rebuilt the
 * same way after a reload.
 */
export function SvgExportPanel({ imageUrl, fileName, colors = 8 }: { imageUrl: string; fileName: string; colors?: number }) {
  const [state, setState] = useState<{ status: 'tracing' } | { status: 'ready'; svg: string; pathCount: number; colorCount: number } | { status: 'error' }>({ status: 'tracing' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'tracing' });
    traceImageUrlToSvg(imageUrl, { colors })
      .then(({ svg, pathCount, colors: palette }) => { if (!cancelled) setState({ status: 'ready', svg, pathCount, colorCount: palette.length }); })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [imageUrl, colors]);

  const download = () => {
    if (state.status !== 'ready') return;
    const url = URL.createObjectURL(new Blob([state.svg], { type: 'image/svg+xml' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName.endsWith('.svg') ? fileName : `${fileName}.svg`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
