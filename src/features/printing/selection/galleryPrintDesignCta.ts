import {
  PRINT_DESIGN_ASSET_PURPOSE,
  type PrintDesignAssetPurpose,
} from './printDesignAssetPurpose.ts';

export type GalleryFilter = 'all' | 'recent' | 'favorites';

export const shouldShowPrintDesignCreationCta = ({
  assetPurpose,
  normalizedSearchQuery,
  filter,
  currentFolderId,
  visibleImageCount,
}: {
  assetPurpose?: PrintDesignAssetPurpose;
  normalizedSearchQuery: string;
  filter: GalleryFilter;
  currentFolderId: string | null;
  visibleImageCount: number;
}) => (
  assetPurpose === PRINT_DESIGN_ASSET_PURPOSE
  && normalizedSearchQuery.length === 0
  && filter !== 'favorites'
  && currentFolderId == null
  && visibleImageCount === 0
);
