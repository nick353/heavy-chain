import type { ReactNode } from 'react';
import { Loader2, RotateCcw, UserRound } from 'lucide-react';
import type { AgentStyleImage } from './agentFlow';

/** Small pieces of the planning agent's conversation, shared by its flows. */
export function StepSpinner({ label }: { label: string }) {
  return <p role="status" className="flex items-center gap-2 text-sm text-neutral-400"><Loader2 className="h-4 w-4 animate-spin" />{label}</p>;
}

/** Light posts the user's own words as a teal bubble on the right with the avatar beside it. */
export function UserBubble({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="flex items-start justify-end gap-3" data-testid={testId}>
      <div className="max-w-[78%] whitespace-pre-wrap rounded-2xl bg-[#0bcabc] px-4 py-3 text-sm leading-6 text-neutral-950">{children}</div>
      <span aria-hidden="true" className="flex size-8 flex-none items-center justify-center rounded-full bg-white/10 text-neutral-300"><UserRound className="h-4 w-4" /></span>
    </div>
  );
}

/** Light's step list: teal dots; the accessible name says 完了 / 進行中 like Light's. */
export function StepList({ items, testId }: { items: Array<{ label: string; status: '完了' | '進行中' | '待機中' }>; testId?: string }) {
  return (
    <ul className="space-y-2 text-sm text-neutral-200" data-testid={testId}>
      {items.map((item) => (
        <li key={item.label} aria-label={`${item.status} ${item.label}`} className="flex items-start gap-2">
          <span aria-hidden="true" className={`mt-2 size-1.5 flex-none rounded-full ${item.status === '待機中' ? 'bg-neutral-600' : 'bg-[#0bcabc]'}`} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function ErrorRow({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
      <span>{children}</span>
      {onRetry && <button type="button" onClick={onRetry} className="flex flex-none items-center gap-1 rounded-lg border border-white/20 px-3 py-1 text-white hover:bg-white/10"><RotateCcw className="h-3.5 w-3.5" />再試行</button>}
    </div>
  );
}

export function GeneratedTile({ image, url, label, onRetry, className = '' }: { image?: AgentStyleImage; url?: string; label?: string; onRetry?: () => void; className?: string }) {
  const failed = image?.state === 'failed' || image?.state === 'unknown';
  return (
    <span className={`relative block overflow-hidden rounded-lg bg-white/5 ${className}`}>
      {url ? <img src={url} alt={label ?? image?.name ?? ''} className="h-full w-full object-cover" />
        : failed ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center text-[11px] leading-4 text-amber-300">
            生成に失敗しました{onRetry && <button type="button" onClick={(event) => { event.stopPropagation(); onRetry(); }} className="mt-1 flex items-center gap-1 rounded-md border border-white/20 px-2 py-0.5 text-white hover:bg-white/10"><RotateCcw className="h-3 w-3" />再生成</button>}
          </span>
        ) : image ? <span aria-label="生成中" className="block h-full w-full animate-pulse bg-white/10" /> : null}
    </span>
  );
}
