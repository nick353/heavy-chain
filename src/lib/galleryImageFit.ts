export type GalleryImageFitInput = {
  naturalW: number;
  naturalH: number;
  availW: number;
  availH: number;
};

export type GalleryImageFitSize = {
  width: number;
  height: number;
};

export const fitContain = ({
  naturalW,
  naturalH,
  availW,
  availH,
}: GalleryImageFitInput): GalleryImageFitSize | null => {
  const values = [naturalW, naturalH, availW, availH];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;

  const scale = Math.min(1, availW / naturalW, availH / naturalH);
  return {
    width: Math.floor(naturalW * scale),
    height: Math.floor(naturalH * scale),
  };
};
