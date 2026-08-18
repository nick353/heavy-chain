#!/usr/bin/env node

import { getErrorMessage, getFailureRecoveryGuidance } from '../src/lib/errorMessages.ts';

const cases = [
  ['No active subscription for brand', '有効なサブスクが見つかりません'],
  ['openai_image_edit_failed:429: insufficient_quota', '画像生成プロバイダの利用枠が不足しています'],
  ['gemini_image_request_failed:429: free_tier quota', '画像生成プロバイダの利用枠が不足しています'],
  ['video_provider_not_admitted: provider unavailable', '動画providerはまだ利用可能な状態ではありません'],
  ['LOCAL_WORKSPACE_REMOTE_PATH_MISSING', '永続Storage pathがないため'],
  ['LOCAL_WORKSPACE_QUOTA_EXCEEDED', '保存容量が不足'],
  [{ code: 'LOCAL_WORKSPACE_SAVE_READBACK_FAILED', message: 'Local workspace artifact save could not be verified.' }, '再読込確認に失敗'],
];
const failures = [];
for (const [input, expected] of cases) {
  const actual = getErrorMessage(input);
  if (!actual.includes(expected)) failures.push({ input, expected, actual });
}

const recoveryCases = [
  ['image_provider_quota_exhausted', 'provider-quota'],
  ['openai_image_edit_failed: insufficient_quota', 'openai-quota'],
  ['gemini_image_request_failed: free_tier quota', 'gemini-quota'],
  ['video_provider_not_admitted', 'provider-admission'],
  ['generated image storage signed url failed', 'network-api'],
];
for (const [input, expectedKind] of recoveryCases) {
  const actual = getFailureRecoveryGuidance(input);
  if (actual.kind !== expectedKind || !actual.userMessage || !actual.retryLabel) {
    failures.push({ input, expectedKind, actual });
  }
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(`Error message mapping verification passed (${cases.length + recoveryCases.length} cases).`);
