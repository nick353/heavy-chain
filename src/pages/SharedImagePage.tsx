import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowUpRight, ImageOff, Loader2 } from 'lucide-react';
import { HeavyChainLogo } from '../components/icons';
import { getSharedImage, type SharedImagePayload } from '../lib/imageApi';

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '未設定';
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
};

export function SharedImagePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [payload, setPayload] = useState<SharedImagePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadSharedImage = async () => {
      setIsLoading(true);
      const result = await getSharedImage(token);
      if (!mounted) return;
      setPayload(result);
      setIsLoading(false);
    };

    loadSharedImage();

    return () => {
      mounted = false;
    };
  }, [token]);

  const image = payload?.image;
  const hasError = !isLoading && (!payload?.success || !image);
  const errorMessage = payload?.error && !/^[\w.:-]+$/.test(payload.error) ? payload.error : 'リンクが存在しないか、有効期限が切れています。';
  const details = [
    { label: '生成日時', value: image?.createdAt ? formatDateTime(image.createdAt) : null },
    { label: 'リンクの有効期限', value: payload?.share?.expiresAt ? formatDateTime(payload.share.expiresAt) : null },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));

  return (
    <div className="flex min-h-screen flex-col bg-[#181a1d] text-white" data-testid="shared-image-page">
      <header className="flex h-[50px] w-full shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-[#05090b]/90 px-4 backdrop-blur-xl sm:px-6">
        <Link to="/" aria-label="Heavy Chain" className="flex items-center text-white">
          <HeavyChainLogo height={24} showText className="shrink-0" />
        </Link>
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-white/10 hover:text-white">
          Heavy Chainを開く
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(#464b50 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
        {isLoading ? (
          <div className="relative flex flex-col items-center gap-3 text-sm text-neutral-400" role="status">
            <Loader2 className="h-7 w-7 animate-spin text-[#20d0c4]" />
            共有画像を読み込んでいます
          </div>
        ) : hasError ? (
          <section className="relative flex w-full max-w-[420px] flex-col items-center rounded-xl border border-white/10 bg-[#202426] px-6 py-10 text-center shadow-xl">
            <ImageOff className="h-9 w-9 text-neutral-500" />
            <h1 className="mt-4 text-base font-medium">共有画像を表示できません</h1>
            <p className="mt-2 text-sm leading-6 text-neutral-400">{errorMessage}</p>
            <Link to="/" className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-[#20d0c4] px-5 text-sm font-medium text-neutral-950 transition hover:brightness-110">
              Heavy Chainのトップへ
            </Link>
          </section>
        ) : (
          <div className="relative grid w-full max-w-[1120px] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#25292b] p-3">
              <img src={image?.imageUrl ?? ''} alt={image?.title || '共有された画像'} className="max-h-[calc(100vh-150px)] w-full rounded-lg object-contain" />
            </section>

            <aside className="flex flex-col rounded-xl border border-white/10 bg-[#202426] p-4 text-sm">
              <p className="text-xs text-neutral-400">共有された画像</p>
              <h1 className="mt-2 text-base font-medium leading-6 text-white">{image?.title || 'Heavy Chainで作成した画像'}</h1>

              {details.length > 0 && (
                <dl className="mt-4 divide-y divide-white/10 rounded-lg bg-black/20">
                  {details.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <dt className="text-xs text-neutral-400">{row.label}</dt>
                      <dd className="text-xs text-neutral-200">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}


              <div className="mt-auto flex flex-col gap-2 pt-6">
                <Link to="/designProduction" className="inline-flex h-10 items-center justify-center rounded-lg bg-[#20d0c4] text-sm font-medium text-neutral-950 transition hover:brightness-110">
                  Heavy Chainで作る
                </Link>
                <Link to="/signup" className="inline-flex h-10 items-center justify-center rounded-lg border border-white/10 text-sm text-neutral-200 transition hover:bg-white/5">
                  アカウントを作成
                </Link>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
