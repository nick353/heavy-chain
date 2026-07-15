export type SurfaceMapStatus = 'semantic-ready' | 'manual-ready' | 'fallback-required' | 'invalid';

export type SurfaceMapProvenance =
  | 'human-annotated'
  | 'manual-printable-area'
  | 'semantic-model'
  | 'legacy-whole-garment';

/**
 * Snapshot-safe reference to an alpha plane. The decoded RGBA bytes are never
 * stored in a frozen request snapshot.
 */
export type EncodedAlphaPlane = {
  encoding: 'png-alpha-v1';
  width: number;
  height: number;
  dataUrl: string;
  /** sha256 over version + declared dimensions + decoded PNG RGBA bytes. */
  contentHash: `sha256:${string}`;
};

/** Runtime-only plane. Keep this outside request snapshots. */
export type RuntimeAlphaPlane = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
};

export type SemanticSurfacePlanes = {
  garment: RuntimeAlphaPlane;
  printable?: RuntimeAlphaPlane;
  conditional?: RuntimeAlphaPlane;
  forbidden?: RuntimeAlphaPlane;
  occluder?: RuntimeAlphaPlane;
};

export type SurfaceMapIdentity = {
  version: 'garment-surface-map-v1';
  sourceHash: `sha256:${string}`;
  contentHash: `sha256:${string}`;
  manualRevision: number;
  status: SurfaceMapStatus;
};

export type GarmentSurfaceMap = SurfaceMapIdentity & {
  width: number;
  height: number;
  coordinateSpace: 'source-pixels';
  confidence: number;
  provenance: SurfaceMapProvenance;
  fallbackReason?: string;
  planes: {
    garment: EncodedAlphaPlane;
    printable?: EncodedAlphaPlane;
    conditional?: EncodedAlphaPlane;
    forbidden?: EncodedAlphaPlane;
    occluder?: EncodedAlphaPlane;
  };
};
