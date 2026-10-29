import { useEffect, useState } from 'react';
import { Check, RefreshCw, Sparkles } from 'lucide-react';
import type { AssistantImageSearch } from './assistantQuestions';
import { searchReferenceImages, type FoundImage } from './referenceImageSearch';

/** Light's third step: 「デザインの質を高めるための参考画像を検索します」, four found images per topic, pick any or skip. */
export function AssistantImageSearchCard({ searches, disabled, onConfirm }: {
  searches: AssistantImageSearch[]; disabled: boolean; onConfirm: (chosen: FoundImage[]) => void;
}) {
  const [results, setResults] = useState<Array<FoundImage[] | 'loading' | 'failed'>>(() => searches.map(() => 'loading'));
  const [chosen, setChosen] = useState<FoundImage[]>([]);
  const key = searches.map((search) => search.query).join('|');
  useEffect(() => {
    const controller = new AbortController();
    searches.forEach((search, index) => {
      searchReferenceImages(search.query, { signal: controller.signal })
        .then((images) => setResults((current) => current.map((item, at) => at === index ? (images.length ? images : 'failed') : item)))
        .catch(() => { if (!controller.signal.aborted) setResults((current) => current.map((item, at) => at === index ? 'failed' : item)); });
    });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the searches are fixed for one saved reply
  }, [key]);
  const toggle = (image: FoundImage) => setChosen((current) => current.some((item) => item.id === image.id)
    ? current.filter((item) => item.id !== image.id) : current.length >= 4 ? current : [...current, image]);
  return <section data-testid="design-assistant-image-search" className="mt-3">
    <p className="flex items-start gap-2 text-sm leading-5 text-neutral-200"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5"><Sparkles className="h-4 w-4 text-[#0bcabc]" /></span>デザインの質を高めるための参考画像を検索します</p>
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      {searches.map((search, index) => {
        const found = results[index];
        return <div key={search.query} className={index ? 'mt-4' : ''}>
          <p className="text-sm text-neutral-100">{search.title}</p>
          {found === 'loading' ? <p className="mt-2 flex items-center gap-2 text-xs text-neutral-400"><RefreshCw className="h-3.5 w-3.5 animate-spin" />検索中...</p>
            : found === 'failed' ? <p className="mt-2 text-xs text-neutral-400">参考画像が見つかりませんでした</p>
            : <div className="mt-2 grid grid-cols-4 gap-2">{found.map((image) => {
              const checked = chosen.some((item) => item.id === image.id);
              return <button key={image.id} type="button" disabled={disabled} data-testid="design-search-image" aria-pressed={checked} title={`${image.title}${image.license ? `（${image.license}）` : ''}`}
                onClick={() => toggle(image)} className={`relative aspect-square overflow-hidden rounded-lg border-2 ${checked ? 'border-[#0bcabc]' : 'border-transparent'} bg-white/5`}>
                <img src={image.thumbUrl} alt={image.title} loading="lazy" className="h-full w-full object-cover" />
                {checked && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#0bcabc]"><Check className="h-3 w-3 text-neutral-950" /></span>}
              </button>;
            })}</div>}
        </div>;
      })}
      <p className="mt-3 text-[10px] text-neutral-500">画像: Wikimedia Commons（各画像のライセンスに従います）</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" data-testid="design-search-skip" disabled={disabled} onClick={() => onConfirm([])} className="h-8 w-20 rounded-lg border border-white/15 text-xs text-neutral-200">スキップ</button>
        <button type="button" data-testid="design-search-confirm" disabled={disabled || !chosen.length} onClick={() => onConfirm(chosen)}
          className="h-8 w-20 rounded-lg bg-[#0bcabc] text-xs text-neutral-950 disabled:bg-white/10 disabled:text-neutral-500">確認</button>
      </div>
    </div>
  </section>;
}
