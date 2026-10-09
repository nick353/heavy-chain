// MyPro's account emails: sent as "MyPro" with a short branded HTML body and a plain-text copy, so
// they read as coming from the app rather than from the auth service's workers.dev host.

export const MYPRO_SENDER_NAME = 'MyPro';

const escapeHTML = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function myproLinkMail(purpose: 'verify' | 'reset', url: string): { subject: string; text: string; html: string } {
  const verify = purpose === 'verify';
  const subject = verify ? '【MyPro】メールアドレスの確認' : '【MyPro】パスワードの再設定';
  const lead = verify
    ? 'MyPro にご登録いただきありがとうございます。下のボタンを押して、メールアドレスの確認を完了してください。'
    : 'パスワード再設定のご依頼を受け付けました。下のボタンから新しいパスワードを設定してください。';
  const button = verify ? 'メールアドレスを確認する' : 'パスワードを再設定する';
  const expiry = verify ? 'このリンクの有効期限は1時間です。期限が切れた場合は、MyPro アプリからもう一度ログインすると確認メールが届きます。'
    : 'このリンクの有効期限は30分です。';
  const ignore = verify ? 'このメールに心当たりがない場合は、何もせずに破棄してください。アカウントは有効になりません。'
    : 'このメールに心当たりがない場合は、何もせずに破棄してください。パスワードは変更されません。';
  const text = `${lead}\n\n${button}:\n${url}\n\n${expiry}\n${ignore}\n\n— MyPro`;
  const link = escapeHTML(url);
  // Brand colours match the app: coral #FF8A65 → amber #FFB74D gradient, deep orange #F4511E for actions.
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHTML(subject)}</title></head>
<body style="margin:0;padding:0;background:#fff6f2;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Hiragino Kaku Gothic ProN',Meiryo,sans-serif;color:#2b2b2b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff6f2;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 6px 24px rgba(244,81,30,0.10)">
<tr><td bgcolor="#FF8A65" style="background:#FF8A65;background-image:linear-gradient(135deg,#FFB74D 0%,#FF8A65 55%,#FF6E40 100%);padding:28px 32px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:44px;height:44px;background:#ffffff;border-radius:12px;text-align:center;vertical-align:middle;font-size:24px;font-weight:800;color:#F4511E;line-height:44px">M</td>
<td style="padding-left:12px;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.3px">MyPro</td>
</tr></table>
<div style="font-size:13px;color:#ffffff;opacity:0.92;padding-top:8px">AI食事管理と筋トレ記録</div>
</td></tr>
<tr><td style="padding:28px 32px 8px;font-size:16px;line-height:1.75">${escapeHTML(lead)}</td></tr>
<tr><td align="center" style="padding:20px 32px 24px"><a href="${link}" style="display:inline-block;background:#F4511E;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:15px 34px;border-radius:999px">${escapeHTML(button)}</a></td></tr>
<tr><td style="padding:0 32px 14px;font-size:13px;line-height:1.75;color:#6b6b6b">${escapeHTML(expiry)}<br>${escapeHTML(ignore)}</td></tr>
<tr><td style="padding:0 32px 28px;font-size:12px;line-height:1.6;color:#8a8a8a;word-break:break-all">ボタンが押せない場合は、次のURLをブラウザで開いてください。<br><a href="${link}" style="color:#F4511E">${link}</a></td></tr>
</table>
<p style="font-size:12px;color:#9a8f8a;margin:16px 0 0">このメールは送信専用です。— MyPro</p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}
