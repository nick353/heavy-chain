export const getGalleryImageLabel = ({
  prompt,
  featureType,
  index,
  isPrintDesign,
}: {
  prompt?: string | null;
  featureType?: string | null;
  index: number;
  isPrintDesign: boolean;
}) => {
  const promptLabel = prompt?.trim().slice(0, 48);
  const fallback = `ギャラリー画像 ${index + 1}`;
  return isPrintDesign
    ? promptLabel || featureType || fallback
    : featureType || promptLabel || fallback;
};
