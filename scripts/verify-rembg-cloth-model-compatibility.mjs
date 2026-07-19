#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';
import sharp from 'sharp';

export const OFFICIAL_CLOTH_MODEL = Object.freeze({
  bytes: 176194565,
  sha256: '6d2cbc27bfbdc989e1fd325656d65902ecc6a3ccbe94b2d3655ec114efcb128e',
  inputShape: [1, 3, 768, 768],
  outputShape: [1, 4, 768, 768],
});

export const CLOTH_CATEGORIES = Object.freeze([
  { id: 1, key: 'upper', label: 'トップス', color: [32, 145, 255] },
  { id: 2, key: 'lower', label: 'ボトムス', color: [55, 210, 120] },
  { id: 3, key: 'full', label: '全身', color: [36, 210, 208] },
]);

export const parseCrop = (value) => {
  if (!value) return null;
  if (!/^(0|[1-9]\d*),(0|[1-9]\d*),([1-9]\d*),([1-9]\d*)$/.test(value)) {
    throw new Error('crop_must_be_left_top_width_height');
  }
  const values = value.split(',').map(Number);
  const [left, top, width, height] = values;
  return { left, top, width, height };
};

export const summarizeClassMap = (classMap) => {
  const counts = [0, 0, 0, 0];
  for (const value of classMap) {
    if (value >= 0 && value < counts.length) counts[value] += 1;
  }
  const total = classMap.length;
  return {
    totalPixels: total,
    background: { pixels: counts[0], ratio: counts[0] / total },
    categories: Object.fromEntries(CLOTH_CATEGORIES.map((category) => [category.key, {
      label: category.label,
      pixels: counts[category.id],
      ratio: counts[category.id] / total,
    }])),
  };
};

const parseArguments = (argv) => Object.fromEntries(argv.slice(2).map((argument) => {
  const separator = argument.indexOf('=');
  return separator === -1
    ? [argument.replace(/^--/, ''), true]
    : [argument.slice(0, separator).replace(/^--/, ''), argument.slice(separator + 1)];
}));

const shapeMatches = (actual, expected) => (
  Array.isArray(actual)
  && actual.length === expected.length
  && actual.every((value, index) => (
    index === 0 ? value === expected[index] || typeof value === 'string' : value === expected[index]
  ))
);

const buildInputTensor = async ({ imagePath, crop }) => {
  let pipeline = sharp(imagePath);
  if (crop) pipeline = pipeline.extract(crop);
  const { data, info } = await pipeline
    .resize(768, 768, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`unexpected_input_channels:${info.channels}`);
  let maxValue = 0;
  for (const value of data) maxValue = Math.max(maxValue, value / 255);
  const divisor = Math.max(maxValue, 1e-6);
  const spatialSize = 768 * 768;
  const normalized = new Float32Array(3 * spatialSize);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let pixel = 0; pixel < spatialSize; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = (data[(pixel * 3) + channel] / 255) / divisor;
      normalized[(channel * spatialSize) + pixel] = (value - mean[channel]) / std[channel];
    }
  }
  return {
    tensor: new ort.Tensor('float32', normalized, OFFICIAL_CLOTH_MODEL.inputShape),
    resizedRgb: data,
    maxValue,
  };
};

const buildClassMap = (output) => {
  const [, channels, height, width] = output.dims;
  const spatialSize = height * width;
  const classMap = new Uint8Array(spatialSize);
  for (let pixel = 0; pixel < spatialSize; pixel += 1) {
    let maximum = output.data[pixel];
    let selected = 0;
    for (let channel = 1; channel < channels; channel += 1) {
      const value = output.data[(channel * spatialSize) + pixel];
      if (value > maximum) {
        maximum = value;
        selected = channel;
      }
    }
    classMap[pixel] = selected;
  }
  return classMap;
};

const writeVisualEvidence = async ({ outputDir, resizedRgb, classMap }) => {
  await sharp(resizedRgb, { raw: { width: 768, height: 768, channels: 3 } })
    .png()
    .toFile(path.join(outputDir, 'input-768.png'));
  const colorMask = Buffer.alloc(768 * 768 * 4);
  for (const category of CLOTH_CATEGORIES) {
    const binaryMask = Buffer.alloc(768 * 768);
    for (let pixel = 0; pixel < classMap.length; pixel += 1) {
      if (classMap[pixel] !== category.id) continue;
      binaryMask[pixel] = 255;
      const offset = pixel * 4;
      colorMask[offset] = category.color[0];
      colorMask[offset + 1] = category.color[1];
      colorMask[offset + 2] = category.color[2];
      colorMask[offset + 3] = 220;
    }
    await sharp(binaryMask, { raw: { width: 768, height: 768, channels: 1 } })
      .png()
      .toFile(path.join(outputDir, `${category.key}-mask.png`));
  }
  await sharp(colorMask, { raw: { width: 768, height: 768, channels: 4 } })
    .png()
    .toFile(path.join(outputDir, 'category-mask.png'));
};

const runCompatibilityDiagnosticAttempt = async ({
  modelPath,
  imagePath,
  outputDir,
  crop = null,
  expectedCategory = null,
}) => {
  if (!modelPath || !imagePath || !outputDir) {
    throw new Error('model_image_and_output_dir_are_required');
  }
  if (expectedCategory && !CLOTH_CATEGORIES.some(({ key }) => key === expectedCategory)) {
    throw new Error(`unsupported_expected_category:${expectedCategory}`);
  }
  await fs.mkdir(outputDir, { recursive: true });
  const model = await fs.readFile(modelPath);
  const sha256 = crypto.createHash('sha256').update(model).digest('hex');
  const pinnedAsset = model.byteLength === OFFICIAL_CLOTH_MODEL.bytes
    && sha256 === OFFICIAL_CLOTH_MODEL.sha256;
  if (!pinnedAsset) throw new Error(`cloth_model_identity_mismatch:${model.byteLength}:${sha256}`);

  const sessionStartedAt = performance.now();
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const sessionMilliseconds = performance.now() - sessionStartedAt;
  try {
    const inputMetadata = session.inputMetadata[0];
    const outputMetadata = session.outputMetadata[0];
    if (!shapeMatches(inputMetadata?.shape, OFFICIAL_CLOTH_MODEL.inputShape)) {
      throw new Error(`cloth_model_input_shape_mismatch:${JSON.stringify(inputMetadata?.shape)}`);
    }
    if (!shapeMatches(outputMetadata?.shape, OFFICIAL_CLOTH_MODEL.outputShape)) {
      throw new Error(`cloth_model_output_shape_mismatch:${JSON.stringify(outputMetadata?.shape)}`);
    }
    const { tensor, resizedRgb, maxValue } = await buildInputTensor({ imagePath, crop });
    const inferenceStartedAt = performance.now();
    const outputs = await session.run({ [session.inputNames[0]]: tensor });
    const inferenceMilliseconds = performance.now() - inferenceStartedAt;
    const output = outputs[session.outputNames[0]];
    if (!output || !shapeMatches(output.dims, OFFICIAL_CLOTH_MODEL.outputShape)) {
      throw new Error(`cloth_model_runtime_output_shape_mismatch:${JSON.stringify(output?.dims)}`);
    }
    const classMap = buildClassMap(output);
    const summary = summarizeClassMap(classMap);
    const garmentPixels = Object.values(summary.categories).reduce((total, category) => total + category.pixels, 0);
    if (garmentPixels === 0) throw new Error('cloth_model_returned_no_garment_pixels');
    if (expectedCategory && summary.categories[expectedCategory].pixels === 0) {
      throw new Error(`expected_cloth_category_missing:${expectedCategory}`);
    }
    await writeVisualEvidence({ outputDir, resizedRgb, classMap });
    const result = {
      schema: 'heavy-chain-rembg-cloth-model-compatibility.v1',
      ok: true,
      checkedAt: new Date().toISOString(),
      model: {
        bytes: model.byteLength,
        sha256,
        pinnedAsset,
        inputName: session.inputNames[0],
        inputShape: inputMetadata.shape,
        outputName: session.outputNames[0],
        outputShape: outputMetadata.shape,
      },
      input: { imagePath, crop, resizedShape: [768, 768, 3], maxValue },
      expectedCategory,
      segmentation: summary,
      timing: { sessionMilliseconds, inferenceMilliseconds },
      artifacts: {
        input: path.join(outputDir, 'input-768.png'),
        categoryMask: path.join(outputDir, 'category-mask.png'),
        upperMask: path.join(outputDir, 'upper-mask.png'),
        lowerMask: path.join(outputDir, 'lower-mask.png'),
        fullMask: path.join(outputDir, 'full-mask.png'),
      },
      claims: {
        proves: ['pinned model identity', 'runtime metadata compatibility', 'local WASM inference', 'three-category output decoding'],
        doesNotProve: ['browser canvas parity', 'production CORS', 'semantic quality acceptance', '0713 video equivalence'],
      },
    };
    await fs.writeFile(path.join(outputDir, 'compatibility.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await session.release();
  }
};

const compatibilityEvidenceFiles = [
  'compatibility.json',
  'input-768.png',
  'category-mask.png',
  'upper-mask.png',
  'lower-mask.png',
  'full-mask.png',
];

export const runCompatibilityDiagnostic = async (options) => {
  const outputDir = options?.outputDir;
  if (!outputDir) throw new Error('model_image_and_output_dir_are_required');
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all(compatibilityEvidenceFiles.map((file) => (
    fs.rm(path.join(outputDir, file), { force: true })
  )));
  const evidencePath = path.join(outputDir, 'compatibility.json');
  await fs.writeFile(evidencePath, `${JSON.stringify({
    schema: 'heavy-chain-rembg-cloth-model-compatibility.v1',
    ok: false,
    status: 'running',
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  try {
    return await runCompatibilityDiagnosticAttempt({
      ...options,
      crop: typeof options.crop === 'string' ? parseCrop(options.crop) : options.crop,
    });
  } catch (error) {
    const failure = {
      schema: 'heavy-chain-rembg-cloth-model-compatibility.v1',
      ok: false,
      status: 'failed',
      checkedAt: new Date().toISOString(),
      exactBlocker: error instanceof Error ? error.message : String(error),
    };
    await fs.writeFile(evidencePath, `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  }
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const args = parseArguments(process.argv);
  runCompatibilityDiagnostic({
    modelPath: args.model,
    imagePath: args.image,
    outputDir: args['output-dir'],
    crop: args.crop || null,
    expectedCategory: args['expected-category'] || null,
  }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      exactBlocker: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  });
}
