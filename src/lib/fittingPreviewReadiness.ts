export interface FittingPreviewReadinessInput {
  currentBrandLoaded: boolean;
  rightsConfirmed: boolean;
  isGenerating: boolean;
  garmentImageUrl?: string;
  productDescription: string;
  selectedBodyTypesCount: number;
  selectedAgeGroupsCount: number;
  patternCount: number;
  maxPatterns?: number;
}

/**
 * Local fitting previews are useful before provider generation, but they still
 * need enough input to represent a real fitting brief. Provider-only gates
 * such as high-precision cutout readiness intentionally stay out of this
 * contract.
 */
export const buildFittingPreviewBlockers = ({
  currentBrandLoaded,
  rightsConfirmed,
  isGenerating,
  garmentImageUrl,
  productDescription,
  selectedBodyTypesCount,
  selectedAgeGroupsCount,
  patternCount,
  maxPatterns = 3,
}: FittingPreviewReadinessInput): string[] => {
  if (isGenerating) return ['生成中です'];
  const blockers: string[] = [];
  if (!currentBrandLoaded) blockers.push('ブランド読込');
  if (!garmentImageUrl) blockers.push('衣服画像');
  if (!rightsConfirmed) blockers.push('権利確認');
  if (!productDescription.trim()) blockers.push('生成brief');
  if (!selectedBodyTypesCount) blockers.push('体型');
  if (!selectedAgeGroupsCount) blockers.push('年代');
  if (patternCount > maxPatterns) blockers.push(`一度に${maxPatterns}パターンまで`);
  return blockers;
};
