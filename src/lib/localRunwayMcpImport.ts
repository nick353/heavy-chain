import type { Json } from '../types/database';

export const LOCAL_RUNWAY_MCP_IMPORT_SCHEMA = 'heavy-chain.local-runway-mcp-import.v1';

export interface LocalRunwayMcpImportImage {
  id?: string;
  title: string;
  imageUrl: string;
  prompt?: string | null;
  featureType?: string;
  metadata?: Record<string, Json | undefined>;
}

export interface LocalRunwayMcpImportBundle {
  schema: typeof LOCAL_RUNWAY_MCP_IMPORT_SCHEMA;
  createdAt?: string;
  brandId?: string;
  featureType?: string;
  source?: Record<string, Json | undefined>;
  images: LocalRunwayMcpImportImage[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const isImportableImageUrl = (value: string) => {
  return value.startsWith('data:image/');
};

const asMetadata = (value: unknown): Record<string, Json | undefined> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      return entry === undefined
        || entry === null
        || ['string', 'number', 'boolean'].includes(typeof entry)
        || Array.isArray(entry)
        || isRecord(entry);
    })
  ) as Record<string, Json | undefined>;
};

export const parseLocalRunwayMcpImportBundle = (value: unknown): LocalRunwayMcpImportBundle => {
  if (!isRecord(value) || value.schema !== LOCAL_RUNWAY_MCP_IMPORT_SCHEMA) {
    throw new Error('Lightchain用のローカルRunway MCP取り込みJSONではありません。');
  }
  if (!Array.isArray(value.images) || value.images.length === 0) {
    throw new Error('取り込める画像が見つかりません。');
  }
  if (value.images.length > 12) {
    throw new Error('一度に取り込める画像は12件までです。');
  }

  const images = value.images.map((rawImage, index) => {
    if (!isRecord(rawImage)) {
      throw new Error(`画像${index + 1}の形式が不正です。`);
    }
    const imageUrl = typeof rawImage.imageUrl === 'string' ? rawImage.imageUrl : '';
    if (!isImportableImageUrl(imageUrl)) {
      throw new Error(`画像${index + 1}はdata URLに変換してください。`);
    }
    const title = typeof rawImage.title === 'string' && rawImage.title.trim()
      ? rawImage.title.trim()
      : `Runway MCP local image ${index + 1}`;
    const prompt = typeof rawImage.prompt === 'string' ? rawImage.prompt : null;
    const featureType = typeof rawImage.featureType === 'string' ? rawImage.featureType : undefined;
    const id = typeof rawImage.id === 'string' ? rawImage.id : undefined;

    return {
      id,
      title,
      imageUrl,
      prompt,
      featureType,
      metadata: asMetadata(rawImage.metadata),
    };
  });

  return {
    schema: LOCAL_RUNWAY_MCP_IMPORT_SCHEMA,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    brandId: typeof value.brandId === 'string' ? value.brandId : undefined,
    featureType: typeof value.featureType === 'string' ? value.featureType : undefined,
    source: asMetadata(value.source),
    images,
  };
};
