export const REMBG_CLOTH_SEG_PRODUCTION_MODEL_URL = 'https://huggingface.co/chwshuang/Stable_diffusion_remove_background_model/resolve/197561dc207c9b23e2739fb81645ef21b4e37d10/u2net_cloth_seg.onnx';
export const REMBG_CLOTH_SEG_MODEL_SHA256 = '6d2cbc27bfbdc989e1fd325656d65902ecc6a3ccbe94b2d3655ec114efcb128e';

export const resolveRembgClothSegModelUrl = ({
  configuredUrl,
  isProduction,
}: {
  configuredUrl: string | undefined;
  isProduction: boolean;
}) => String(configuredUrl || '').trim()
  || (isProduction ? REMBG_CLOTH_SEG_PRODUCTION_MODEL_URL : '');

export const isRembgClothSegModelConfigured = (modelUrl: string) => Boolean(modelUrl);
