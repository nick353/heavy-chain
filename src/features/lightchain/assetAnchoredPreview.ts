export type AssetAnchoredPreviewMode =
  | 'asset'
  | 'line-art'
  | 'vector'
  | 'pattern'
  | 'repair'
  | 'model';

type AssetAnchoredPreviewInput = {
  sourceImageUrl: string;
  secondaryImageUrl?: string | null;
  title: string;
  summary: string;
  mode: AssetAnchoredPreviewMode;
};

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const truncate = (value: string, maxLength: number) => (
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
);

const filterFor = (mode: AssetAnchoredPreviewMode) => {
  if (mode === 'line-art') return 'url(#line-art)';
  if (mode === 'vector') return 'url(#vector)';
  return 'none';
};

/**
 * Keep generated previews grounded in the exact uploaded material.
 * This deterministic, provider-neutral layer never replaces a user's image
 * with a canned illustration and makes the source asset auditable after handoff.
 */
export const buildAssetAnchoredPreviewDataUrl = ({
  sourceImageUrl,
  secondaryImageUrl,
  title,
  summary,
  mode,
}: AssetAnchoredPreviewInput) => {
  if (!sourceImageUrl.startsWith('data:image/')) {
    throw new Error('asset_anchored_preview_source_image_required');
  }

  const source = escapeXml(sourceImageUrl);
  const secondary = secondaryImageUrl?.startsWith('data:image/')
    ? escapeXml(secondaryImageUrl)
    : null;
  const safeTitle = escapeXml(truncate(title, 32));
  const safeSummary = escapeXml(truncate(summary, 92));
  const imageFilter = filterFor(mode);
  const secondaryPanel = secondary
    ? `<rect x="674" y="116" width="218" height="254" rx="18" fill="#0b1113" stroke="#65d3cf" stroke-opacity="0.35"/>
       <image href="${secondary}" x="694" y="136" width="178" height="174" preserveAspectRatio="xMidYMid meet"/>
       <text x="783" y="344" text-anchor="middle" fill="#9ca3af" font-family="Arial, sans-serif" font-size="14">参照素材</text>`
    : '';
  const patternPanel = mode === 'pattern'
    ? `<defs><pattern id="source-pattern" width="164" height="132" patternUnits="userSpaceOnUse">
         <image href="${source}" width="164" height="132" preserveAspectRatio="xMidYMid slice"/>
       </pattern></defs>
       <rect x="108" y="132" width="484" height="314" rx="24" fill="url(#source-pattern)" opacity="0.52"/>`
    : '';
  const repairOverlay = mode === 'repair'
    ? `<circle cx="530" cy="242" r="48" fill="none" stroke="#fbbf24" stroke-width="6" stroke-dasharray="10 8"/>
       <path d="M530 178v128M466 242h128" stroke="#fbbf24" stroke-width="3" opacity="0.7"/>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="980" height="620" viewBox="0 0 980 620" data-preview-kind="asset-anchored-v2">
    <defs>
      <filter id="line-art" color-interpolation-filters="sRGB">
        <feColorMatrix type="saturate" values="0"/>
        <feComponentTransfer><feFuncR type="linear" slope="1.65" intercept="-0.28"/><feFuncG type="linear" slope="1.65" intercept="-0.28"/><feFuncB type="linear" slope="1.65" intercept="-0.28"/></feComponentTransfer>
      </filter>
      <filter id="vector" color-interpolation-filters="sRGB">
        <feComponentTransfer><feFuncR type="discrete" tableValues="0 0.35 0.7 1"/><feFuncG type="discrete" tableValues="0 0.35 0.7 1"/><feFuncB type="discrete" tableValues="0 0.35 0.7 1"/></feComponentTransfer>
      </filter>
    </defs>
    <rect width="980" height="620" fill="#070b0d"/>
    <rect x="54" y="48" width="872" height="512" rx="30" fill="#151b1e" stroke="#65d3cf" stroke-width="3"/>
    <rect x="86" y="84" width="558" height="394" rx="24" fill="#0b1113" stroke="#263337" stroke-width="2"/>
    <image href="${source}" x="102" y="100" width="526" height="362" preserveAspectRatio="xMidYMid meet" filter="${imageFilter}"/>
    ${patternPanel}
    ${repairOverlay}
    ${secondaryPanel}
    <rect x="674" y="398" width="218" height="58" rx="18" fill="#65d3cf" fill-opacity="0.18"/>
    <text x="783" y="433" text-anchor="middle" fill="#65d3cf" font-family="Arial, sans-serif" font-size="19" font-weight="800">入力素材を保持</text>
    <text x="86" y="514" fill="#65d3cf" font-family="Arial, sans-serif" font-size="28" font-weight="800">${safeTitle}</text>
    <text x="86" y="544" fill="#a3a3a3" font-family="Arial, sans-serif" font-size="17">${safeSummary}</text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};
