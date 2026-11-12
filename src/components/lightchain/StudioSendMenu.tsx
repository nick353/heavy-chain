import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Send } from 'lucide-react';
import { STUDIO_SEND_GROUPS, studioSendHref } from '../../lib/studioSendMenu';

/**
 * スタジオの帯の「送る」。本家と同じく印のボタン（説明「送る」）を押すと右にメニューが開き
 * （modal なし）、3つの束の小メニューから行き先を選ぶと、新しいタブで `<行き先>?imgUrl=<画像の住所>` を開く。
 * 受け取り側は各画面の useIncomingImageFile（src/lib/incomingImage.ts）。
 */
export function StudioSendMenu({ imageUrl, disabled = false, className }: { imageUrl: string; disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => { setOpen(false); setGroup(null); }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, close]);
  useEffect(() => { if (disabled) close(); }, [disabled, close]);

  const send = (path: string) => {
    close();
    window.open(studioSendHref(path, imageUrl), '_blank');
  };

  const itemClass = 'flex w-full items-center gap-2 rounded-lg px-2 py-3 text-left text-sm text-white/90 hover:bg-white/[0.08]';
  return (
    <div ref={rootRef} className="relative inline-flex" data-testid="studio-send-menu">
      <button
        type="button"
        aria-label="送る"
        title="送る"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || !imageUrl}
        data-track-id="send-menu"
        onClick={() => (open ? close() : setOpen(true))}
        className={className}
      >
        <Send aria-hidden="true" className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" aria-label="送る" className="absolute left-full top-0 z-40 ml-2 w-max min-w-[180px] rounded-xl border border-white/10 bg-[#1d2224] p-1.5 shadow-2xl">
          {STUDIO_SEND_GROUPS.map((entry, index) => (
            <div key={entry.label} className="relative" onPointerEnter={() => setGroup(index)}>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={group === index}
                onClick={() => setGroup(current => (current === index ? null : index))}
                onKeyDown={(event) => { if (event.key === 'ArrowRight') setGroup(index); if (event.key === 'ArrowLeft') setGroup(null); }}
                className={`${itemClass} justify-between ${group === index ? 'bg-white/[0.08]' : ''}`}
              >
                <span className="whitespace-nowrap">{entry.label}</span>
                <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-white/60" />
              </button>
              {group === index && (
                <div role="menu" aria-label={entry.label} className="absolute left-full top-0 z-50 ml-1 w-max rounded-xl border border-white/10 bg-[#1d2224] p-1.5 shadow-2xl">
                  {entry.items.map(item => (
                    <button key={`${entry.label}-${item.path}`} type="button" role="menuitem" onClick={() => send(item.path)} className={`${itemClass} whitespace-nowrap`}>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
