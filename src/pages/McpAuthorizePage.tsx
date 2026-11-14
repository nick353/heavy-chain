import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cloudflareDataPlane, type CloudflareMcpAuthorizationRequest } from '../lib/cloudflareApi';
import { useAuthStore } from '../stores/authStore';

/**
 * MCP（ChatGPT・Claude・Cursor など）から「Heavy Chain でサインイン」したときの承認ページ。
 *
 * ここに来るのは、heavy-api の /mcp-oauth/authorize が受けたあと。ページが受け取るのは request_id だけで、
 * 戻り先も PKCE の値もサーバーの台帳にある。だからこのページからは、何も書き換えられない。
 */

/** 今つながるのは読み取りのツールだけ。書き込みを足したら、ここも足す。 */
const PERMISSIONS = [
  'ブランドとプロジェクトの一覧を見る',
  '作ったデザインの一覧を見る（画像は1時間だけ有効なリンク）',
  '生成の使用量と残りを見る',
  '参考画像（Openverse）と実在の商品（Yahoo!ショッピング）を探す',
];

function hostOf(value: string): string {
  try { return new URL(value).host; } catch { return value; }
}

function failureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  if (text.includes('_404') || text.includes('_409')) {
    return 'この承認の要求は期限切れか、もう使われています。つなぎたいアプリの画面から、もう一度サインインをやり直してください。';
  }
  if (text.includes('_401')) return 'セッションが切れています。ログインし直してから、もう一度お試しください。';
  if (text.includes('_503')) return 'ただいま承認できません。時間をおいてもう一度お試しください。';
  return '承認の内容を読み取れませんでした。時間をおいてもう一度お試しください。';
}

export function McpAuthorizePage() {
  const [params] = useSearchParams();
  const { user } = useAuthStore();
  const requestId = params.get('request_id') ?? '';
  const [pending, setPending] = useState<CloudflareMcpAuthorizationRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!requestId) { setError('承認の要求が指定されていません。'); return; }
    (async () => {
      try {
        if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
        const found = await cloudflareDataPlane.readMcpAuthorizationRequest(requestId);
        if (!cancelled) setPending(found);
      } catch (cause) {
        if (!cancelled) setError(failureMessage(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [requestId]);

  const decide = useCallback(async (approve: boolean) => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
      const { redirectTo } = await cloudflareDataPlane.decideMcpAuthorization(requestId, approve);
      // 戻り先はサーバーが、登録済みの URI から組み立てたもの。ここでは組み立てない。
      window.location.replace(redirectTo);
    } catch (cause) {
      setError(failureMessage(cause));
      setWorking(false);
    }
  }, [requestId, working]);

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[#22262b] px-6 py-16 text-[#e7eaec]">
      <Link to="/dashboard" className="absolute right-6 top-5 text-[14px] text-[#d8dcde] transition hover:text-white sm:right-8 sm:top-6">
        ダッシュボードへ
      </Link>
      <section className="w-full max-w-[460px]" data-testid="mcp-authorize-page">
        <h1 className="text-[22px] font-semibold">外部のアプリをつなぐ</h1>

        {error && (
          <p className="mt-6 rounded-[10px] border border-[#5a3b3b] bg-[#2e2626] px-4 py-3 text-[14px] text-[#f0c9c9]" role="alert">
            {error}
          </p>
        )}

        {!error && !pending && (
          <p className="mt-6 text-[14px] text-[#aab1b6]">確認しています…</p>
        )}

        {pending && (
          <>
            <p className="mt-6 text-[15px] leading-relaxed">
              <strong className="font-semibold">{pending.clientName}</strong> が、
              {user?.email ? <> <span className="text-[#aab1b6]">{user.email}</span> の</> : null}
              Heavy Chain につなごうとしています。
            </p>

            <div className="mt-5 rounded-[10px] border border-[#3a4046] bg-[#272c31] px-4 py-4">
              <p className="text-[13px] font-semibold text-[#d8dcde]">できるようになること</p>
              <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-[#aab1b6]">
                {PERMISSIONS.map((item) => <li key={item}>・{item}</li>)}
              </ul>
              <p className="mt-3 text-[12px] text-[#8e969c]">
                デザインの新規作成や削除はできません。許可は heavychain.app からログアウトすると止まります。
              </p>
            </div>

            <p className="mt-4 text-[12px] text-[#8e969c]">
              承認すると <span className="text-[#aab1b6]">{hostOf(pending.redirectUri)}</span> に戻ります。
              心当たりのないアプリなら「許可しない」を選んでください。
            </p>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => decide(true)}
                disabled={working}
                className="flex-1 rounded-[8px] bg-[#e7eaec] px-4 py-2.5 text-[14px] font-semibold text-[#22262b] transition hover:bg-white disabled:opacity-50"
              >
                {working ? '処理中…' : '許可する'}
              </button>
              <button
                type="button"
                onClick={() => decide(false)}
                disabled={working}
                className="flex-1 rounded-[8px] border border-[#3a4046] px-4 py-2.5 text-[14px] text-[#d8dcde] transition hover:border-[#5a6066] disabled:opacity-50"
              >
                許可しない
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default McpAuthorizePage;
