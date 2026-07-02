export type MockImageResult = {
  base64: string;
  mimeType: string;
  model: string;
  taskId: string;
};

export type MockImageArtifact = {
  base64: string;
  dataUrl: string;
  contentType: string;
  extension: string;
};

function assertMockGenerationAllowed() {
  if (Deno.env.get('ALLOW_MOCK_IMAGE_GENERATION') !== 'true') {
    throw new Error('mock_image_generation_not_enabled');
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function utf8ToBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function mockSvg(params: {
  prompt: string;
  width?: number;
  height?: number;
  model?: string | null;
}) {
  const width = Math.max(512, Math.min(1536, Math.round(Number(params.width) || 1024)));
  const height = Math.max(512, Math.min(1536, Math.round(Number(params.height) || 1024)));
  const title = escapeXml(String(params.model || 'mock-image-provider'));
  const prompt = escapeXml(params.prompt.replace(/\s+/g, ' ').trim().slice(0, 180));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f6f4ef"/>
  <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.08)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.84)}" rx="24" fill="#171717"/>
  <path d="M ${Math.round(width * 0.36)} ${Math.round(height * 0.28)} C ${Math.round(width * 0.24)} ${Math.round(height * 0.42)}, ${Math.round(width * 0.25)} ${Math.round(height * 0.72)}, ${Math.round(width * 0.5)} ${Math.round(height * 0.78)} C ${Math.round(width * 0.75)} ${Math.round(height * 0.72)}, ${Math.round(width * 0.76)} ${Math.round(height * 0.42)}, ${Math.round(width * 0.64)} ${Math.round(height * 0.28)} Z" fill="#2b2b2b" stroke="#d8d0c4" stroke-width="4"/>
  <path d="M ${Math.round(width * 0.33)} ${Math.round(height * 0.48)} C ${Math.round(width * 0.43)} ${Math.round(height * 0.41)}, ${Math.round(width * 0.57)} ${Math.round(height * 0.41)}, ${Math.round(width * 0.67)} ${Math.round(height * 0.48)}" fill="none" stroke="#c7ccd1" stroke-width="10" stroke-linecap="round" stroke-dasharray="22 18"/>
  <text x="50%" y="${Math.round(height * 0.16)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700" fill="#f8fafc">${title}</text>
  <text x="50%" y="${Math.round(height * 0.88)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="20" fill="#f8fafc">API-less generation proof</text>
  <text x="50%" y="${Math.round(height * 0.93)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="14" fill="#cbd5e1">${prompt}</text>
</svg>`;
}

export async function generateMockImage(params: {
  prompt: string;
  width?: number;
  height?: number;
  model?: string | null;
}): Promise<MockImageResult> {
  assertMockGenerationAllowed();
  const svg = mockSvg(params);
  return {
    base64: utf8ToBase64(svg),
    mimeType: 'image/svg+xml',
    model: params.model || 'mock-image-provider',
    taskId: `mock-${crypto.randomUUID()}`,
  };
}

export function mockImageArtifact(result: Pick<MockImageResult, 'base64' | 'mimeType'>): MockImageArtifact {
  const contentType = result.mimeType || 'image/svg+xml';
  return {
    base64: result.base64,
    dataUrl: `data:${contentType};base64,${result.base64}`,
    contentType,
    extension: contentType === 'image/svg+xml' ? 'svg' : 'png',
  };
}
