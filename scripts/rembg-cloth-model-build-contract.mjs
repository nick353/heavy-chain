export const SAME_ORIGIN_CLOTH_MODEL_URL = '/models/u2net_cloth_seg.onnx';
export const OFFICIAL_CLOTH_MODEL_SOURCE_URL =
  'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_cloth_seg.onnx';

export const validateClothModelBuildUrl = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return { configured: false, valid: false, reason: 'not_configured', delivery: null };
  if (normalized.startsWith('/')) {
    if (normalized.startsWith('//')) {
      return { configured: true, valid: false, reason: 'protocol_relative_url_forbidden', delivery: null };
    }
    let parsed;
    try {
      parsed = new URL(normalized, 'https://same-origin.invalid');
    } catch {
      return { configured: true, valid: false, reason: 'invalid_url', delivery: null };
    }
    if (parsed.search || parsed.hash) {
      return { configured: true, valid: false, reason: 'query_or_fragment_forbidden', delivery: null };
    }
    if (parsed.pathname !== SAME_ORIGIN_CLOTH_MODEL_URL) {
      return { configured: true, valid: false, reason: 'same_origin_path_not_allowed', delivery: null };
    }
    return { configured: true, valid: true, reason: null, delivery: 'same_origin' };
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.username || parsed.password) {
      return { configured: true, valid: false, reason: 'embedded_credentials_forbidden', delivery: null };
    }
    if (parsed.search || parsed.hash) {
      return { configured: true, valid: false, reason: 'query_or_fragment_forbidden', delivery: null };
    }
    if (parsed.protocol !== 'https:') {
      return { configured: true, valid: false, reason: 'https_required', delivery: null };
    }
    if (!parsed.pathname.toLowerCase().endsWith('.onnx')) {
      return { configured: true, valid: false, reason: 'onnx_path_required', delivery: null };
    }
    return { configured: true, valid: true, reason: null, delivery: 'cross_origin' };
  } catch {
    return { configured: true, valid: false, reason: 'invalid_url', delivery: null };
  }
};
