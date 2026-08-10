export const MODNET_ONNX_PRODUCTION_MODEL_URL = 'https://huggingface.co/onnx-community/modnet-webnn/resolve/6af52070d14deafc5e55ce6cc4d752a322cdff76/onnx/model_quantized.onnx';

export const resolveModnetOnnxModelUrl = ({
  configuredUrl,
  isProduction,
}: {
  configuredUrl: string | undefined;
  isProduction: boolean;
}) => String(configuredUrl || '').trim()
  || (isProduction ? MODNET_ONNX_PRODUCTION_MODEL_URL : '');

export const isModnetOnnxModelConfigured = (modelUrl: string) => Boolean(modelUrl);
