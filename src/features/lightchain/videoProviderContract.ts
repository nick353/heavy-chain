/**
 * Provider-neutral contract for the Lightchain video surface.
 *
 * This module deliberately does not contain credentials or a provider client.
 * A video route becomes runnable only after all three independent admissions
 * are proven in the same run: source permission, server-side credentials, and
 * provider receipt/readback. Until then the UI must stay fail-closed.
 */

export type VideoProviderId = 'runway' | 'veo' | 'luma' | 'kling';
export type VideoDurationSeconds = 5 | 10 | 15;
export type VideoResolution = '720P' | '1080P';

export const VIDEO_PROVIDER_NOT_ADMITTED = 'video_provider_not_admitted';

export type VideoProviderAdmission = {
  provider: VideoProviderId;
  sourcePermissionConfirmed: boolean;
  serverCredentialConfigured: boolean;
  sameRunReceiptReadbackConfirmed: boolean;
};

export type VideoProviderGate =
  | {
      route: 'unsupported';
      blocker: typeof VIDEO_PROVIDER_NOT_ADMITTED;
    }
  | {
      route: 'video';
      provider: VideoProviderId;
    };

export type VideoGenerationInput = {
  sourceAssetRef: string;
  prompt: string;
  durationSeconds: VideoDurationSeconds;
  resolution: VideoResolution;
  idempotencyKey: string;
};

export function resolveVideoProviderGate(admission?: VideoProviderAdmission | null): VideoProviderGate {
  if (!admission
    || !admission.sourcePermissionConfirmed
    || !admission.serverCredentialConfigured
    || !admission.sameRunReceiptReadbackConfirmed) {
    return { route: 'unsupported', blocker: VIDEO_PROVIDER_NOT_ADMITTED };
  }

  return { route: 'video', provider: admission.provider };
}

export function parseVideoDuration(value: string): VideoDurationSeconds | null {
  switch (value.trim()) {
    case '5秒':
      return 5;
    case '10秒':
      return 10;
    case '15秒':
      return 15;
    default:
      return null;
  }
}

export function buildVideoGenerationInput(input: {
  sourceAssetRef?: string | null;
  prompt?: string | null;
  duration?: string | null;
  resolution?: string | null;
  idempotencyKey?: string | null;
}): VideoGenerationInput | null {
  const sourceAssetRef = input.sourceAssetRef?.trim() ?? '';
  const prompt = input.prompt?.trim() ?? '';
  const idempotencyKey = input.idempotencyKey?.trim() ?? '';
  const durationSeconds = parseVideoDuration(input.duration ?? '');
  const resolution = input.resolution === '720P' || input.resolution === '1080P'
    ? input.resolution
    : null;

  if (!sourceAssetRef || !prompt || !idempotencyKey || durationSeconds === null || resolution === null) {
    return null;
  }

  return { sourceAssetRef, prompt, durationSeconds, resolution, idempotencyKey };
}
