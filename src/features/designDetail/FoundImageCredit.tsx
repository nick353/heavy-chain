import { foundImageCredit, type FoundImage } from './referenceImageSearch';

/** The small "作者 / CC BY 4.0" line under a found image, linking to the image's own page (the licences require it). */
export function FoundImageCredit({ image }: { image: FoundImage }) {
  const credit = foundImageCredit(image);
  if (!credit) return null;
  const className = 'mt-0.5 block truncate text-[10px] leading-4 text-neutral-500';
  return image.pageUrl
    ? <a href={image.pageUrl} target="_blank" rel="noopener noreferrer" title={`${image.title}（${credit}）`} data-testid="found-image-credit" className={`${className} hover:text-neutral-300 hover:underline`}>{credit}</a>
    : <span title={`${image.title}（${credit}）`} data-testid="found-image-credit" className={className}>{credit}</span>;
}

/** The note under a set of found images. */
export const FOUND_IMAGE_SOURCES_NOTE = '画像: Openverse・Wikimedia Commons（各画像の作者とライセンスに従います）';
