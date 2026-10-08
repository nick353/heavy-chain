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
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f6f5;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Hiragino Kaku Gothic ProN',Meiryo,sans-serif;color:#172b26">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f5;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:22px;font-weight:700;color:#116b50;padding-bottom:20px">MyPro</td></tr>
<tr><td style="font-size:16px;line-height:1.7;padding-bottom:24px">${escapeHTML(lead)}</td></tr>
<tr><td align="center" style="padding-bottom:24px"><a href="${link}" style="display:inline-block;background:#116b50;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:10px">${escapeHTML(button)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.7;color:#425b51;padding-bottom:12px">${escapeHTML(expiry)}<br>${escapeHTML(ignore)}</td></tr>
<tr><td style="font-size:12px;line-height:1.6;color:#6b7d76;word-break:break-all">ボタンが押せない場合は、次のURLをブラウザで開いてください。<br>${link}</td></tr>
</table>
<p style="font-size:12px;color:#6b7d76;margin:16px 0 0">このメールは送信専用です。— MyPro</p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}
