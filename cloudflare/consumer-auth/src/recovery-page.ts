/** MyPro's independent recovery surface. No Heavy proxy or cross-app cookies. */
export function recoveryPage(verification: boolean): Response {
  const nonce = crypto.randomUUID();
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>MyPro アカウント</title>
<script nonce="${nonce}">const resetToken = new URL(location.href).searchParams.get('token');
history.replaceState(null, '', location.pathname);
document.addEventListener('DOMContentLoaded', () => {
 const reset = document.getElementById('reset'), recovery = document.getElementById('recovery');
 if (!reset || !recovery) return;
 reset.hidden = !resetToken; recovery.hidden = !!resetToken;
 for (const form of [reset,recovery]) form.addEventListener('submit', async event => {
  event.preventDefault(); const status = document.getElementById('status'), button = form.querySelector('button');
  const fields = new FormData(form), password = String(fields.get('password') || '');
  if (form === reset && (password.length < 12 || password.length > 128 || password !== fields.get('confirm'))) {
   status.textContent = '12〜128文字の同じパスワードを2回入力してください。'; return;
  }
  button.disabled = true; status.textContent = '処理中です…';
  try {
   const response = await fetch(form === reset ? '/api/auth/reset-password' : '/api/auth/request-password-reset', {
    method:'POST', credentials:'same-origin', cache:'no-store', headers:{'content-type':'application/json'},
    body:JSON.stringify(form === reset ? {token:resetToken,newPassword:password} :
      {email:String(fields.get('email') || ''),redirectTo:location.origin+'/reset-password'})
   });
   if (!response.ok) throw new Error('request_failed');
   form.reset();
   status.textContent = form === reset ? 'パスワードを再設定しました。MyProアプリに戻ってログインしてください。' :
    '登録済みのメールアドレスの場合、再設定メールを送信します。';
  } catch { status.textContent = '再設定できませんでした。リンクの期限や通信状態を確認し、時間をおいてお試しください。'; }
  finally { button.disabled = false; if (form === reset) form.reset(); }
 });
});</script>
<style>html{color-scheme:light}body{margin:0;background:#f3f6f5;color:#172b26;font:16px/1.65 system-ui,sans-serif}
main{max-width:440px;margin:8vh auto;padding:32px;background:white;border-radius:20px}
h1{font-size:26px;line-height:1.3}label{display:block;margin-top:20px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:12px;border-radius:9px}
input{border:1px solid #86968f}button{margin-top:24px;background:#116b50;color:white;border:0;cursor:pointer}
button:disabled{opacity:.6}small{color:#425b51}#status{min-height:3em}@media(max-width:520px){main{margin:20px;padding:24px}}</style>
</head><body><main><small>MyPro アカウント</small>
${verification ? '<h1>メールアドレスの確認</h1><p>メールの確認を完了した方は、MyProアプリに戻ってログインしてください。</p>' :
  '<h1>パスワードの再設定</h1><p>MyPro専用の手続きです。Heavy Chainのアカウントは変更されません。</p><form id="reset" hidden><label>新しいパスワード<input type="password" name="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><label>パスワードの確認<input type="password" name="confirm" minlength="12" maxlength="128" autocomplete="new-password" required></label><small>12〜128文字で入力してください。</small><button>パスワードを再設定</button></form><form id="recovery" hidden><p>再設定リンクをメールで受け取ります。</p><label>メールアドレス<input type="email" name="email" autocomplete="email" required></label><button>再設定メールを送信</button></form><p id="status" role="status" aria-live="polite"></p><noscript>このページではJavaScriptを有効にしてください。</noscript>'}
</main></body></html>`;
  return new Response(html, { headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff", "x-frame-options": "DENY",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  } });
}
