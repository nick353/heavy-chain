import type { SurfaceMapIdentity, SurfaceMapStatus } from '../domain/types';

const MANUAL_PRINTABLE_SURFACE_MAX_PIXELS = 16_000_000;

export type ManualPrintableSurfaceStatus = Extract<SurfaceMapStatus, 'manual-ready'>;

export type ManualPrintableSurfaceErrorCode =
  | 'MANUAL_PRINTABLE_SURFACE_DIMENSION_INVALID'
  | 'MANUAL_PRINTABLE_SURFACE_PIXEL_LIMIT_EXCEEDED'
  | 'MANUAL_PRINTABLE_SURFACE_RGBA_LENGTH_INVALID'
  | 'MANUAL_PRINTABLE_SURFACE_ALPHA_LENGTH_INVALID';

export class ManualPrintableSurfaceValidationError extends Error {
  readonly code: ManualPrintableSurfaceErrorCode;

  constructor(code: ManualPrintableSurfaceErrorCode) {
    super(code);
    this.name = 'ManualPrintableSurfaceValidationError';
    this.code = code;
  }
}

export type ManualPrintableSurfaceCryptoLike =
  | {
      subtle: {
        digest(algorithm: 'SHA-256', data: BufferSource): Promise<ArrayBuffer>;
      };
    }
  | {
      createHash(algorithm: 'sha256'): {
        update(data: Uint8Array): {
          digest(encoding: 'hex'): string;
        };
      };
    };

export type ManualPrintableSurfacePlane = {
  version: 'png-alpha-v1';
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  contentHash: `sha256:${string}`;
};

export type ManualPrintableSurfaceIdentity = SurfaceMapIdentity & {
  status: ManualPrintableSurfaceStatus;
};

export type ManualPrintableSurface = {
  provenance: 'manual-printable-area';
  plane: ManualPrintableSurfacePlane;
  identity: ManualPrintableSurfaceIdentity;
};

export type ManualPrintableSurfaceInput = {
  garment: {
    width: number;
    height: number;
    rgba: Uint8Array | Uint8ClampedArray;
  };
  editedAlpha: Uint8Array | Uint8ClampedArray;
  manualRevision: number;
  crypto?: ManualPrintableSurfaceCryptoLike;
};

const textEncoder = new TextEncoder();

const assertDimensions = (width: number, height: number) => {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    throw new ManualPrintableSurfaceValidationError('MANUAL_PRINTABLE_SURFACE_DIMENSION_INVALID');
  }
  if (width > 0xffff_ffff || height > 0xffff_ffff) {
    throw new ManualPrintableSurfaceValidationError('MANUAL_PRINTABLE_SURFACE_DIMENSION_INVALID');
  }
  if (width > MANUAL_PRINTABLE_SURFACE_MAX_PIXELS / height) {
    throw new ManualPrintableSurfaceValidationError('MANUAL_PRINTABLE_SURFACE_PIXEL_LIMIT_EXCEEDED');
  }
};

const assertLength = (actual: number, expected: number, code: ManualPrintableSurfaceErrorCode) => {
  if (actual !== expected) {
    throw new ManualPrintableSurfaceValidationError(code);
  }
};

const canonicalPayload = (version: string, width: number, height: number, rgba: Uint8ClampedArray) => {
  const versionBytes = textEncoder.encode(version);
  const payload = new Uint8Array(4 + versionBytes.length + 4 + 4 + 4 + rgba.length);
  const view = new DataView(payload.buffer);
  let offset = 0;
  view.setUint32(offset, versionBytes.length, false);
  offset += 4;
  payload.set(versionBytes, offset);
  offset += versionBytes.length;
  view.setUint32(offset, width, false);
  offset += 4;
  view.setUint32(offset, height, false);
  offset += 4;
  view.setUint32(offset, rgba.length, false);
  offset += 4;
  payload.set(rgba, offset);
  return payload;
};

const toHex = (bytes: Uint8Array) => {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
};

const resolveCrypto = (cryptoImpl?: ManualPrintableSurfaceCryptoLike): ManualPrintableSurfaceCryptoLike => {
  if (cryptoImpl) return cryptoImpl;
  if (globalThis.crypto && typeof globalThis.crypto.subtle?.digest === 'function') {
    return { subtle: globalThis.crypto.subtle };
  }
  throw new Error('MANUAL_PRINTABLE_SURFACE_CRYPTO_UNAVAILABLE');
};

const sha256Hex = async (payload: Uint8Array, cryptoImpl?: ManualPrintableSurfaceCryptoLike) => {
  const resolved = resolveCrypto(cryptoImpl);
  if ('createHash' in resolved) {
    return resolved.createHash('sha256').update(payload).digest('hex');
  }
  const digestBytes = new Uint8Array(payload.byteLength);
  digestBytes.set(payload);
  const digest = await resolved.subtle.digest('SHA-256', digestBytes.buffer);
  return toHex(new Uint8Array(digest));
};

const buildContentPlane = (
  garmentRgba: Uint8Array | Uint8ClampedArray,
  editedAlpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
) => {
  const plane = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const rgbaIndex = index * 4;
    plane[rgbaIndex] = 255;
    plane[rgbaIndex + 1] = 255;
    plane[rgbaIndex + 2] = 255;
    plane[rgbaIndex + 3] = Math.min(garmentRgba[rgbaIndex + 3], editedAlpha[index]);
  }
  return plane;
};

export const buildManualPrintableSurface = async ({
  garment,
  editedAlpha,
  manualRevision,
  crypto,
}: ManualPrintableSurfaceInput): Promise<ManualPrintableSurface> => {
  assertDimensions(garment.width, garment.height);
  const pixelCount = garment.width * garment.height;
  assertLength(garment.rgba.length, pixelCount * 4, 'MANUAL_PRINTABLE_SURFACE_RGBA_LENGTH_INVALID');
  assertLength(editedAlpha.length, pixelCount, 'MANUAL_PRINTABLE_SURFACE_ALPHA_LENGTH_INVALID');

  const sourceBytes = new Uint8ClampedArray(garment.rgba);
  const contentRgba = buildContentPlane(sourceBytes, editedAlpha, garment.width, garment.height);

  const sourceHash = await sha256Hex(
    canonicalPayload('garment-source-rgba-v1', garment.width, garment.height, sourceBytes),
    crypto,
  );
  const contentHash = await sha256Hex(
    canonicalPayload('png-alpha-v1', garment.width, garment.height, contentRgba),
    crypto,
  );

  return {
    provenance: 'manual-printable-area',
    plane: {
      version: 'png-alpha-v1',
      width: garment.width,
      height: garment.height,
      rgba: contentRgba,
      contentHash: `sha256:${contentHash}`,
    },
    identity: {
      version: 'garment-surface-map-v1',
      sourceHash: `sha256:${sourceHash}`,
      contentHash: `sha256:${contentHash}`,
      manualRevision,
      status: 'manual-ready',
    },
  };
};
