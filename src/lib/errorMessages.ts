// Centralized error messages for better user experience

export const ERROR_MESSAGES: Record<string, string> = {
  // Network errors
  NETWORK_ERROR: 'ネットワークに接続できません。インターネット接続を確認してください。',
  TIMEOUT: '処理に時間がかかっています。しばらくお待ちいただくか、再度お試しください。',
  SERVER_ERROR: 'サーバーエラーが発生しました。しばらくしてから再度お試しください。',
  
  // Rate limiting
  RATE_LIMIT: 'リクエストが多すぎます。しばらくお待ちください。',
  RATE_LIMIT_MINUTE: 'リクエスト制限に達しました。1分後に再度お試しください。',
  RATE_LIMIT_HOUR: '時間あたりのリクエスト制限に達しました。しばらくお待ちください。',
  USER_USAGE_RATE_LIMIT: '短時間に生成リクエストが集中しています。1分ほど待ってから再試行してください。',
  BRAND_USAGE_RATE_LIMIT: 'このブランドで短時間に生成リクエストが集中しています。少し待ってから再試行してください。',
  BRAND_USAGE_QUOTA_EXCEEDED: '今月の生成枠を使い切りました。プラン変更または翌月のリセット後に再試行してください。',
  AUTH_EMAIL_RATE_LIMIT: 'サインアップ確認メールの送信制限に達しました。しばらく待ってから再度お試しください。',
  
  // Image generation errors
  IMAGE_TOO_LARGE: '画像サイズが大きすぎます。10MB以下の画像をアップロードしてください。',
  IMAGE_INVALID_FORMAT: '対応していない画像形式です。JPEG、PNG、WebP形式をご利用ください。',
  IMAGE_CORRUPT: '画像ファイルが破損しています。別の画像をお試しください。',
  NSFW_CONTENT: '不適切なコンテンツが検出されました。ガイドラインに沿った内容でお試しください。',
  GENERATION_FAILED: '画像の生成に失敗しました。プロンプトを変更して再度お試しください。',
  PROMPT_TOO_LONG: 'プロンプトが長すぎます。500文字以内で入力してください。',
  PROMPT_EMPTY: 'プロンプトを入力してください。',
  
  // Auth errors
  INVALID_CREDENTIALS: 'メールアドレスまたはパスワードが正しくありません。',
  EMAIL_EXISTS: 'このメールアドレスは既に登録されています。',
  EMAIL_NOT_CONFIRMED: 'メールアドレスの確認が完了していません。確認メールをご確認ください。',
  PASSWORD_TOO_WEAK: 'パスワードは8文字以上で、大文字・小文字・数字を含めてください。',
  SESSION_EXPIRED: 'セッションの有効期限が切れました。再度ログインしてください。',
  UNAUTHORIZED: 'この操作を行う権限がありません。',
  
  // Brand/Project errors
  BRAND_NOT_FOUND: 'ブランドが見つかりません。',
  BRAND_ACCESS_DENIED: 'このブランドで操作する権限がありません。ブランドを選び直してください。',
  BRAND_SUBSCRIPTION_UNAVAILABLE: 'このブランドの有効なサブスクが見つかりません。ブランド設定でプランの有効期間を確認してください。',
  RUNWAY_MCP_ELIGIBLE_SUBSCRIPTION_REQUIRED: 'Runway生成にはRunway対応の有料プランが必要です。ブランド設定でプラン状態を確認してください。',
  RUNWAY_MCP_CONNECTION_NOT_APPROVED: 'Runway MCP接続が未承認です。ブランド設定から接続を申請し、管理者承認後に再試行してください。',
  RUNWAY_MCP_CONNECTION_STATUS_UNAVAILABLE: 'Runway MCP接続状態を確認できません。時間をおいて再試行してください。',
  RUNWAY_MCP_BRIDGE_NOT_CONFIGURED: 'Runway MCPブリッジが本番に設定されていません。管理者がRUNWAY_MCP_BRIDGE_URLとRUNWAY_MCP_BRIDGE_TOKENを設定する必要があります。',
  RUNWAY_MCP_AUTH_REQUIRED: 'Runway MCPブリッジのRunwayログインが切れています。管理者がRunway MCPへ再接続してください。',
  RUNWAY_MCP_SUBSCRIPTION_INACTIVE: 'Runway側のサブスクまたはクレジットが有効ではありません。Runwayアカウントのプランと残量を確認してください。',
  RUNWAY_MCP_REQUEST_FAILED: 'Runway MCPとの通信に失敗しました。少し待ってから再試行し、続く場合は管理者に接続状態を確認してください。',
  LOCAL_RUNWAY_WORKER_NOT_RUNNING: 'Mac側のRunway workerが起動していません。workerを起動してから再度生成してください。',
  LOCAL_RUNWAY_WORKER_TIMEOUT: 'Runway workerの生成完了を確認できませんでした。workerログとRunway接続状態を確認してください。',
  LOCAL_RUNWAY_OAUTH_FAILED: 'Runway公式OAuthが失敗しています。Runwayの同意画面で「Consent session missing or expired」が出ているため、Runway MCPを再接続してください。',
  PROJECT_NOT_FOUND: 'プロジェクトが見つかりません。',
  BRAND_LIMIT_REACHED: '作成できるブランド数の上限に達しました。',
  
  // Storage errors
  STORAGE_FULL: 'ストレージの容量が不足しています。不要な画像を削除してください。',
  UPLOAD_FAILED: 'アップロードに失敗しました。再度お試しください。',
  DOWNLOAD_FAILED: 'ダウンロードに失敗しました。再度お試しください。',
  
  // Feature-specific errors
  COLORIZE_NEEDS_IMAGE: 'カラバリ生成には元画像が必要です。',
  UPSCALE_ALREADY_HD: 'この画像は既に高解像度です。',
  VARIATION_NEEDS_IMAGE: 'バリエーション生成には元画像が必要です。',
  
  // Generic
  UNKNOWN_ERROR: '予期しないエラーが発生しました。再度お試しください。',
};

const KNOWN_MESSAGE_MAP: Array<[RegExp, string]> = [
  [/email rate limit exceeded/i, ERROR_MESSAGES.AUTH_EMAIL_RATE_LIMIT],
  [/brand usage quota exceeded/i, ERROR_MESSAGES.BRAND_USAGE_QUOTA_EXCEEDED],
  [/user usage rate limit exceeded/i, ERROR_MESSAGES.USER_USAGE_RATE_LIMIT],
  [/brand usage rate limit exceeded/i, ERROR_MESSAGES.BRAND_USAGE_RATE_LIMIT],
  [/no active subscription for brand/i, ERROR_MESSAGES.BRAND_SUBSCRIPTION_UNAVAILABLE],
  [/Runway MCP generation requires an active eligible subscription/i, ERROR_MESSAGES.RUNWAY_MCP_ELIGIBLE_SUBSCRIPTION_REQUIRED],
  [/runway_mcp_connection_not_approved/i, ERROR_MESSAGES.RUNWAY_MCP_CONNECTION_NOT_APPROVED],
  [/runway_mcp_connection_status_unavailable/i, ERROR_MESSAGES.RUNWAY_MCP_CONNECTION_STATUS_UNAVAILABLE],
  [/runway_mcp_bridge_not_configured/i, ERROR_MESSAGES.RUNWAY_MCP_BRIDGE_NOT_CONFIGURED],
  [/Consent session missing or expired|runway_mcp_local_bridge_failed:401|runway_mcp_remote_exited/i, ERROR_MESSAGES.LOCAL_RUNWAY_OAUTH_FAILED],
  [/runway_mcp_auth_required/i, ERROR_MESSAGES.RUNWAY_MCP_AUTH_REQUIRED],
  [/runway_mcp_subscription_inactive/i, ERROR_MESSAGES.RUNWAY_MCP_SUBSCRIPTION_INACTIVE],
  [/runway_mcp_request_failed/i, ERROR_MESSAGES.RUNWAY_MCP_REQUEST_FAILED],
  [/runway_mcp_output_fetch_failed|runway_mcp_empty_image_response/i, ERROR_MESSAGES.RUNWAY_MCP_REQUEST_FAILED],
  [/local_runway_worker_not_running/i, ERROR_MESSAGES.LOCAL_RUNWAY_WORKER_NOT_RUNNING],
  [/local_runway_worker_timeout/i, ERROR_MESSAGES.LOCAL_RUNWAY_WORKER_TIMEOUT],
  [/brand not found or access denied/i, ERROR_MESSAGES.BRAND_ACCESS_DENIED],
  [/missing authorization|unauthorized/i, ERROR_MESSAGES.SESSION_EXPIRED],
];

const getMappedKnownMessage = (message: string) => {
  const matched = KNOWN_MESSAGE_MAP.find(([pattern]) => pattern.test(message));
  return matched?.[1] ?? null;
};

const isSupabaseAuthError = (error: any) => (
  error?.name === 'AuthApiError' ||
  error?.name === 'AuthError' ||
  error?.__isAuthError === true
);

// Map API error codes to user-friendly messages
export function getErrorMessage(error: any): string {
  // If it's a string, return as-is if it looks user-friendly
  if (typeof error === 'string') {
    if (ERROR_MESSAGES[error]) {
      return ERROR_MESSAGES[error];
    }
    const mappedMessage = getMappedKnownMessage(error);
    if (mappedMessage) {
      return mappedMessage;
    }
    // Check if it's already a Japanese message
    if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(error)) {
      return error;
    }
    return ERROR_MESSAGES.UNKNOWN_ERROR;
  }

  // Handle Error objects
  if (error instanceof Error) {
    // Check for network errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return ERROR_MESSAGES.NETWORK_ERROR;
    }
    if (error.name === 'AbortError') {
      return ERROR_MESSAGES.TIMEOUT;
    }
  }

  // Handle Supabase errors
  if (error?.code) {
    switch (error.code) {
      case 'PGRST116':
        return ERROR_MESSAGES.PROJECT_NOT_FOUND;
      case '23505':
        return ERROR_MESSAGES.EMAIL_EXISTS;
      case '42501':
        return ERROR_MESSAGES.UNAUTHORIZED;
      case 'email_not_confirmed':
        return ERROR_MESSAGES.EMAIL_NOT_CONFIRMED;
      case 'invalid_credentials':
        return ERROR_MESSAGES.INVALID_CREDENTIALS;
      default:
        break;
    }
  }

  // Handle HTTP status codes
  if (error?.status) {
    switch (error.status) {
      case 400:
        return error.message || ERROR_MESSAGES.UNKNOWN_ERROR;
      case 401:
        return ERROR_MESSAGES.SESSION_EXPIRED;
      case 403:
        return ERROR_MESSAGES.UNAUTHORIZED;
      case 404:
        return ERROR_MESSAGES.PROJECT_NOT_FOUND;
      case 413:
        return ERROR_MESSAGES.IMAGE_TOO_LARGE;
      case 429:
        if (isSupabaseAuthError(error)) {
          return ERROR_MESSAGES.AUTH_EMAIL_RATE_LIMIT;
        }
        return getMappedKnownMessage(error.message || '') || ERROR_MESSAGES.RATE_LIMIT;
      case 500:
      case 502:
      case 503:
        return ERROR_MESSAGES.SERVER_ERROR;
      default:
        break;
    }
  }

  // Try to get message from error object
  if (error?.message) {
    // Map known error messages
    const mappedMessage = getMappedKnownMessage(error.message);
    if (mappedMessage) {
      return mappedMessage;
    }
    const message = error.message.toLowerCase();
    if (message.includes('network') || message.includes('fetch')) {
      return ERROR_MESSAGES.NETWORK_ERROR;
    }
    if (message.includes('timeout')) {
      return ERROR_MESSAGES.TIMEOUT;
    }
    if (message.includes('rate') || message.includes('limit')) {
      return ERROR_MESSAGES.RATE_LIMIT;
    }
    if (message.includes('nsfw') || message.includes('inappropriate')) {
      return ERROR_MESSAGES.NSFW_CONTENT;
    }
    // Return original message if it's in Japanese
    if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(error.message)) {
      return error.message;
    }
  }

  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

// Helper for handling async operations with better error messages
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  customErrorMap?: Record<string, string>
): Promise<{ data: T | null; error: string | null }> {
  try {
    const data = await operation();
    return { data, error: null };
  } catch (err: any) {
    let errorMessage = getErrorMessage(err);
    
    // Apply custom error mapping if provided
    if (customErrorMap && err?.code && customErrorMap[err.code]) {
      errorMessage = customErrorMap[err.code];
    }
    
    console.error('Operation failed:', err);
    return { data: null, error: errorMessage };
  }
}
