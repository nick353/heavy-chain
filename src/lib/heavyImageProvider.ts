export const HEAVY_IMAGE_PROVIDER = 'openai' as const;

export const HEAVY_IMAGE_PROVIDER_CONFIGURATION_ERROR =
  'heavy_openai_provider_configuration_invalid';

export function resolveHeavyImageProviderConfiguration(value: unknown): {
  provider: typeof HEAVY_IMAGE_PROVIDER;
  configurationError: string | null;
} {
  const configured = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return {
    provider: HEAVY_IMAGE_PROVIDER,
    configurationError: configured && configured !== HEAVY_IMAGE_PROVIDER
      ? HEAVY_IMAGE_PROVIDER_CONFIGURATION_ERROR
      : null,
  };
}
