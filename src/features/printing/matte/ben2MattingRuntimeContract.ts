export const BEN2_ONNX_PRODUCTION_MODEL_URL = 'https://huggingface.co/onnx-community/BEN2-ONNX/resolve/c552aa82688edce09f0ac9d2e31ad53d9d629010/onnx/model_fp16.onnx';

export const resolveBen2OnnxModelUrl = ({
  configuredUrl,
  isProduction,
}: {
  configuredUrl: string | undefined;
  isProduction: boolean;
}) => String(configuredUrl || '').trim()
  || (isProduction ? BEN2_ONNX_PRODUCTION_MODEL_URL : '');

export const isBen2OnnxModelConfigured = (modelUrl: string) => Boolean(modelUrl);
