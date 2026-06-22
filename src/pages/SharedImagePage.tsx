import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ExternalLink, Image as ImageIcon, Loader2 } from 'lucide-react';
import { getSharedImage, type SharedImagePayload } from '../lib/imageApi';
import { buildSourceContextSummaryRows } from '../lib/sourceContextSummary';

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

  const summaryRows = useMemo(
    () => buildSourceContextSummaryRows(payload?.image?.metadata),
    [payload?.image?.metadata],
  );

  const image = payload?.image;
  const hasError = !isLoading && (!payload?.success || !image);

  return (
    <main className="min-h-screen bg-[#111617] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500 text-neutral-950">
              <ImageIcon className="h-5 w-5" />
            </span>
            <span className="font-display text-lg font-semibold tracking-wide">HEAVY CHAIN</span>
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-white/85 transition hover:border-primary-400 hover:text-primary-300"
          >
            アプリを開く
            <ExternalLink className="h-4 w-4" />
          </Link>
        </header>

        <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.75fr)] lg:py-14">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30 shadow-2xl shadow-black/30">
            {isLoading ? (
              <div className="flex aspect-[4/5] min-h-[420px] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary-300" />
              </div>
            ) : hasError ? (
              <div className="flex aspect-[4/5] min-h-[420px] flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertCircle className="h-9 w-9 text-red-300" />
                <p className="text-lg font-semibold">共有画像を表示できません</p>
                <p className="max-w-sm text-sm leading-6 text-white/60">
                  {payload?.error ?? 'リンクが存在しないか、有効期限が切れています。'}
                </p>
              </div>
            ) : (
              <img
                src={image?.imageUrl ?? ''}
                alt={image?.prompt ?? 'Heavy Chain shared image'}
                className="h-full max-h-[78vh] w-full object-contain"
              />
            )}
          </div>

          <aside className="rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-xl shadow-black/20 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary-300">
              Shared output
            </p>
            <h1 className="mt-4 font-display text-2xl font-semibold leading-tight sm:text-3xl">
              {image?.prompt ?? 'Heavy Chain 共有画像'}
            </h1>
            <p className="mt-4 text-sm leading-7 text-white/65">
              生成画像、プロンプト、Lightchain互換タスクをまとめて確認できます。リンクは期限付きで公開されます。
            </p>

            <div className="mt-6 grid gap-3 text-sm">
              <div className="rounded-xl bg-black/20 p-4">
                <p className="text-xs text-white/45">生成タイプ</p>
                <p className="mt-1 font-medium text-white">{image?.featureType ?? '未設定'}</p>
              </div>
              <div className="rounded-xl bg-black/20 p-4">
                <p className="text-xs text-white/45">生成日時</p>
                <p className="mt-1 font-medium text-white">{formatDateTime(image?.createdAt)}</p>
              </div>
              <div className="rounded-xl bg-black/20 p-4">
                <p className="text-xs text-white/45">リンク有効期限</p>
                <p className="mt-1 font-medium text-white">{formatDateTime(payload?.share?.expiresAt)}</p>
              </div>
            </div>

            {summaryRows.length > 0 && (
              <div className="mt-6 border-t border-white/10 pt-5">
                <h2 className="text-sm font-semibold text-white">生成条件</h2>
                <dl className="mt-3 space-y-3">
                  {summaryRows.map((row) => (
                    <div key={`${row.label}-${row.value}`}>
                      <dt className="text-xs text-white/45">{row.label}</dt>
                      <dd className="mt-1 text-sm leading-6 text-white/85">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/generate"
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-primary-400 px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-primary-300"
              >
                Heavy Chainで生成する
              </Link>
              <Link
                to="/signup"
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-white/15 px-4 py-3 text-sm font-semibold text-white transition hover:border-primary-300 hover:text-primary-200"
              >
                アカウント作成
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
