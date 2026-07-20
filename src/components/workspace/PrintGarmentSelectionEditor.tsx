import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../ui';
import { Modal } from '../ui/Modal';
import {
  buildPointGuidedSelection,
  type PointGuidedSelection,
} from '../../features/printing/selection/pointGuidedSelection';
import {
  preparePointPromptSegmentation,
  type PreparedPointPromptSegmentation,
} from '../../features/printing/selection/pointPromptSegmentation';
import {
  canSubmitGarmentSelectionPreview,
  DEFAULT_GARMENT_SEGMENTATION_TARGET,
  type GarmentSegmentationTarget,
  type GarmentSelectionSource,
} from '../../features/printing/selection/garmentSegmentationPolicy';

type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type SelectionInteraction =
  | { mode: 'tap'; start: { x: number; y: number } }
  | { mode: 'create'; start: { x: number; y: number } }
  | { mode: 'move'; start: { x: number; y: number }; origin: SelectionRect }
  | { mode: 'resize'; start: { x: number; y: number }; origin: SelectionRect; handle: ResizeHandle };

type SelectionMode = 'tap' | 'range';
type SelectionSource = 'tap' | 'range';
type MaskDisplayMode = 'overlay' | 'source' | 'mask-only';

const MAX_CANVAS_EDGE = 1600;
const MIN_SELECTION_EDGE = 16;
const PREVIEW_MASK_CLOSE_RADIUS = 3;
// Keep a small amount of the original background around a guided crop so the
// segmentation model can distinguish the garment boundary from the image edge.
const AI_CONTEXT_PADDING_RATIO = 0.12;
const AI_CONTEXT_MIN_PADDING = 24;

const garmentTargetOptions: Array<{ value: GarmentSegmentationTarget; label: string }> = [
  { value: 'upper', label: 'トップス' },
  { value: 'lower', label: 'ボトムス' },
  { value: 'full', label: '全身' },
];

const closePreviewMask = (mask: NonNullable<PointGuidedSelection['mask']>) => {
  const { width, height, data } = mask;
  // EfficientSAM already returns a full-resolution, smooth object mask. The
  // legacy colour proposal is at most 280px; only that small mask needs the
  // morphological closing pass below.
  if (width * height > 500_000) return mask;
  const dilated = new Uint8Array(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width) + x] !== 1) continue;
      for (let offsetY = -PREVIEW_MASK_CLOSE_RADIUS; offsetY <= PREVIEW_MASK_CLOSE_RADIUS; offsetY += 1) {
        for (let offsetX = -PREVIEW_MASK_CLOSE_RADIUS; offsetX <= PREVIEW_MASK_CLOSE_RADIUS; offsetX += 1) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
          dilated[(nextY * width) + nextX] = 1;
        }
      }
    }
  }

  const closed = new Uint8Array(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let isClosed = true;
      for (let offsetY = -PREVIEW_MASK_CLOSE_RADIUS; offsetY <= PREVIEW_MASK_CLOSE_RADIUS && isClosed; offsetY += 1) {
        for (let offsetX = -PREVIEW_MASK_CLOSE_RADIUS; offsetX <= PREVIEW_MASK_CLOSE_RADIUS; offsetX += 1) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (
            nextX < 0
            || nextY < 0
            || nextX >= width
            || nextY >= height
            || dilated[(nextY * width) + nextX] !== 1
          ) {
            isClosed = false;
            break;
          }
        }
      }
      const index = (y * width) + x;
      // Keep every pixel that the guided proposal already selected. The
      // closing pass only fills small gaps; it must not erase legitimate
      // disconnected garment texture such as a printed flower or logo.
      if (data[index] === 1 || isClosed) closed[index] = 1;
    }
  }
  return { ...mask, data: closed };
};

const resizeHandleDetails: Array<{ id: ResizeHandle; left: number; top: number; cursor: string; label: string }> = [
  { id: 'nw', left: 0, top: 0, cursor: 'nwse-resize', label: '左上' },
  { id: 'n', left: 50, top: 0, cursor: 'ns-resize', label: '上辺' },
  { id: 'ne', left: 100, top: 0, cursor: 'nesw-resize', label: '右上' },
  { id: 'e', left: 100, top: 50, cursor: 'ew-resize', label: '右辺' },
  { id: 'se', left: 100, top: 100, cursor: 'nwse-resize', label: '右下' },
  { id: 's', left: 50, top: 100, cursor: 'ns-resize', label: '下辺' },
  { id: 'sw', left: 0, top: 100, cursor: 'nesw-resize', label: '左下' },
  { id: 'w', left: 0, top: 50, cursor: 'ew-resize', label: '左辺' },
];

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('garment_selection_image_load_failed'));
  image.src = url;
});

let pointPromptPreparationQueue: Promise<void> = Promise.resolve();
let pointPromptPreparationCache: {
  sourceUrl: string;
  promise: Promise<PreparedPointPromptSegmentation>;
} | null = null;

const enqueuePointPromptPreparation = (
  prepare: () => Promise<PreparedPointPromptSegmentation>,
) => {
  const queued = pointPromptPreparationQueue
    .catch(() => undefined)
    .then(prepare);
  pointPromptPreparationQueue = queued.then(() => undefined, () => undefined);
  return queued;
};

const preparePointPromptForImage = (url: string) => {
  if (pointPromptPreparationCache?.sourceUrl === url) {
    return pointPromptPreparationCache.promise;
  }
  const promise = enqueuePointPromptPreparation(async () => {
    const image = await loadImage(url);
    const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = longestEdge > MAX_CANVAS_EDGE ? MAX_CANVAS_EDGE / longestEdge : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('garment_selection_preload_context_missing');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    return preparePointPromptSegmentation({
      width: canvas.width,
      height: canvas.height,
      data: imageData.data,
    });
  });
  const cached = { sourceUrl: url, promise };
  pointPromptPreparationCache = cached;
  void promise.catch(() => {
    if (pointPromptPreparationCache === cached) pointPromptPreparationCache = null;
  });
  return promise;
};

const normalizeRect = (start: { x: number; y: number }, end: { x: number; y: number }): SelectionRect => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const resizeRect = ({
  origin,
  handle,
  point,
  canvasWidth,
  canvasHeight,
}: {
  origin: SelectionRect;
  handle: ResizeHandle;
  point: { x: number; y: number };
  canvasWidth: number;
  canvasHeight: number;
}): SelectionRect => {
  let left = origin.x;
  let right = origin.x + origin.width;
  let top = origin.y;
  let bottom = origin.y + origin.height;

  if (handle.includes('w')) left = clamp(point.x, 0, right - MIN_SELECTION_EDGE);
  if (handle.includes('e')) right = clamp(point.x, left + MIN_SELECTION_EDGE, canvasWidth);
  if (handle.includes('n')) top = clamp(point.y, 0, bottom - MIN_SELECTION_EDGE);
  if (handle.includes('s')) bottom = clamp(point.y, top + MIN_SELECTION_EDGE, canvasHeight);

  return { x: left, y: top, width: right - left, height: bottom - top };
};

export function PrintGarmentSelectionEditor({
  isOpen,
  sourceUrl,
  onClose,
  onApply,
}: {
  isOpen: boolean;
  sourceUrl: string;
  onClose: () => void;
  onApply: (
    selectedImageUrl: string,
    selectionSource: Exclude<GarmentSelectionSource, 'automatic'>,
    segmentationTarget: GarmentSegmentationTarget,
  ) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const scaleRef = useRef(1);
  const interactionRef = useRef<SelectionInteraction | null>(null);
  const maskDisplayModeRef = useRef<MaskDisplayMode>('overlay');
  const pointPromptRef = useRef<Promise<PreparedPointPromptSegmentation> | null>(null);
  const pointPromptSourceRef = useRef<string | null>(null);
  const tapRequestIdRef = useRef(0);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('tap');
  const [selectionSource, setSelectionSource] = useState<SelectionSource | null>(null);
  const [segmentationTarget, setSegmentationTarget] = useState<GarmentSegmentationTarget>(
    DEFAULT_GARMENT_SEGMENTATION_TARGET,
  );
  const [guidedResult, setGuidedResult] = useState<PointGuidedSelection | null>(null);
  const [maskDisplayMode, setMaskDisplayMode] = useState<MaskDisplayMode>('overlay');
  const [tapProcessing, setTapProcessing] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncMaskPreview = useCallback(() => {
    const sourceCanvas = canvasRef.current;
    const previewCanvas = maskPreviewCanvasRef.current;
    if (!sourceCanvas || !previewCanvas || !sourceCanvas.width || !sourceCanvas.height) return;
    const previewWidth = Math.min(420, sourceCanvas.width);
    const previewHeight = Math.max(1, Math.round(previewWidth * (sourceCanvas.height / sourceCanvas.width)));
    if (previewCanvas.width !== previewWidth) previewCanvas.width = previewWidth;
    if (previewCanvas.height !== previewHeight) previewCanvas.height = previewHeight;
    const previewContext = previewCanvas.getContext('2d');
    if (!previewContext) return;
    previewContext.clearRect(0, 0, previewWidth, previewHeight);
    previewContext.imageSmoothingEnabled = true;
    previewContext.imageSmoothingQuality = 'high';
    previewContext.drawImage(sourceCanvas, 0, 0, previewWidth, previewHeight);
  }, []);

  const render = useCallback((
    nextSelection: SelectionRect | null,
    previewMask?: PointGuidedSelection['mask'],
    renderMode: SelectionMode = 'tap',
  ) => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (!nextSelection) {
      syncMaskPreview();
      return;
    }

    // "Source" is a literal before-view: no mask fill, crop shade, or
    // selection outline. This makes comparison with the annotated modes exact.
    if (maskDisplayModeRef.current === 'source') {
      syncMaskPreview();
      return;
    }

    if (previewMask && previewMask.data.length === previewMask.width * previewMask.height) {
      const displayMask = closePreviewMask(previewMask);
      const maskOnly = maskDisplayModeRef.current === 'mask-only';
      if (maskOnly) {
          context.fillStyle = '#030712';
          context.fillRect(0, 0, canvas.width, canvas.height);
      }
        const overlay = context.createImageData(canvas.width, canvas.height);
        for (let y = 0; y < canvas.height; y += 1) {
          const maskY = Math.min(displayMask.height - 1, Math.floor((y / canvas.height) * displayMask.height));
          for (let x = 0; x < canvas.width; x += 1) {
            const maskX = Math.min(displayMask.width - 1, Math.floor((x / canvas.width) * displayMask.width));
            const isSelected = displayMask.data[(maskY * displayMask.width) + maskX] === 1;
            const isMaskBoundary = isSelected && (
              maskX === 0
              || maskY === 0
              || maskX === displayMask.width - 1
              || maskY === displayMask.height - 1
              || displayMask.data[(maskY * displayMask.width) + Math.max(0, maskX - 1)] !== 1
              || displayMask.data[(maskY * displayMask.width) + Math.min(displayMask.width - 1, maskX + 1)] !== 1
              || displayMask.data[(Math.max(0, maskY - 1) * displayMask.width) + maskX] !== 1
              || displayMask.data[(Math.min(displayMask.height - 1, maskY + 1) * displayMask.width) + maskX] !== 1
            );
            const offset = ((y * canvas.width) + x) * 4;
            if (isMaskBoundary) {
              // Keep the recognition boundary fully opaque so it remains clear
              // over both the textured source and the isolated mask view.
              overlay.data[offset] = 103;
              overlay.data[offset + 1] = 232;
              overlay.data[offset + 2] = 255;
              overlay.data[offset + 3] = 255;
            } else if (isSelected) {
              // The default overlay deliberately stays translucent so garment
              // texture, prints, seams, and folds remain available for review.
              overlay.data[offset] = 34;
              overlay.data[offset + 1] = 211;
              overlay.data[offset + 2] = 238;
              overlay.data[offset + 3] = maskOnly ? 210 : 72;
            } else {
              overlay.data[offset] = 3;
              overlay.data[offset + 1] = 7;
              overlay.data[offset + 2] = 18;
              overlay.data[offset + 3] = maskOnly ? 236 : 0;
            }
          }
        }
        // Draw the translucent mask over the source image instead of replacing
        // the source pixels. This keeps the garment details readable while the
        // selected boundary remains visibly blue.
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = canvas.width;
        overlayCanvas.height = canvas.height;
        const overlayContext = overlayCanvas.getContext('2d');
        if (overlayContext) {
          overlayContext.putImageData(overlay, 0, 0);
          context.drawImage(overlayCanvas, 0, 0);
        }
    } else {
      context.save();
      context.fillStyle = 'rgba(0, 0, 0, 0.48)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.beginPath();
      context.rect(nextSelection.x, nextSelection.y, nextSelection.width, nextSelection.height);
      context.clip();
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      context.restore();
    }

    if (renderMode === 'range') {
      context.save();
      context.strokeStyle = '#67e8f9';
      context.lineWidth = Math.max(2, canvas.width / 500);
      context.setLineDash([10, 8]);
      context.strokeRect(nextSelection.x, nextSelection.y, nextSelection.width, nextSelection.height);
      context.restore();
    }
    syncMaskPreview();
  }, [syncMaskPreview]);

  useEffect(() => {
    if (ready) syncMaskPreview();
  }, [guidedResult, ready, selection, selectionMode, syncMaskPreview]);

  useEffect(() => {
    if (!sourceUrl) {
      pointPromptSourceRef.current = null;
      pointPromptRef.current = null;
      return;
    }
    pointPromptSourceRef.current = sourceUrl;
    const preload = preparePointPromptForImage(sourceUrl);
    pointPromptRef.current = preload;
    void preload.catch((modelError) => {
      if (pointPromptSourceRef.current === sourceUrl && pointPromptRef.current === preload) {
        pointPromptRef.current = null;
      }
      console.warn('Point-prompt garment model preload unavailable; keeping on-open preparation.', modelError);
    });
  }, [sourceUrl]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setReady(false);
    setSelection(null);
    setSelectionMode('tap');
    setSelectionSource(null);
    setSegmentationTarget(DEFAULT_GARMENT_SEGMENTATION_TARGET);
    setGuidedResult(null);
    maskDisplayModeRef.current = 'overlay';
    setMaskDisplayMode('overlay');
    setTapProcessing(false);
    setCanvasSize({ width: 0, height: 0 });
    setError(null);
    tapRequestIdRef.current += 1;
    void loadImage(sourceUrl)
      .then((image) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) throw new Error('garment_selection_canvas_missing');
        const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
        const scale = longestEdge > MAX_CANVAS_EDGE ? MAX_CANVAS_EDGE / longestEdge : 1;
        scaleRef.current = scale;
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        imageRef.current = image;
        const analysisContext = canvas.getContext('2d', { willReadFrequently: true });
        if (!analysisContext) throw new Error('garment_selection_analysis_context_missing');
        analysisContext.drawImage(image, 0, 0, canvas.width, canvas.height);
        const analysisData = analysisContext.getImageData(0, 0, canvas.width, canvas.height);
        const prepareFromVisibleCanvas = () => enqueuePointPromptPreparation(() => {
          if (pointPromptSourceRef.current !== sourceUrl) {
            throw new Error('garment_selection_point_prompt_source_changed');
          }
          return preparePointPromptSegmentation({
            width: canvas.width,
            height: canvas.height,
            data: analysisData.data,
          });
        });
        if (pointPromptSourceRef.current !== sourceUrl || !pointPromptRef.current) {
          pointPromptSourceRef.current = sourceUrl;
          pointPromptRef.current = prepareFromVisibleCanvas();
        } else {
          pointPromptRef.current = pointPromptRef.current.catch(prepareFromVisibleCanvas);
        }
        void pointPromptRef.current.catch((modelError) => {
          console.warn('Point-prompt garment model unavailable; keeping local selection fallback.', modelError);
        });
        const initialSelection = { x: 0, y: 0, width: canvas.width, height: canvas.height };
        setCanvasSize({ width: canvas.width, height: canvas.height });
        setSelection(initialSelection);
        render(initialSelection);
        setReady(true);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('Garment selection editor failed to load', loadError);
        setError('画像を選択画面へ読み込めませんでした。');
      });
    return () => {
      cancelled = true;
      interactionRef.current = null;
    };
  }, [isOpen, render, sourceUrl]);

  const pointFromEvent = (event: React.PointerEvent<HTMLElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, ((event.clientX - rect.left) / rect.width) * canvas.width)),
      y: Math.max(0, Math.min(canvas.height, ((event.clientY - rect.top) / rect.height) * canvas.height)),
    };
  };

  const setNextSelection = (
    nextSelection: SelectionRect,
    source?: SelectionSource,
    previewMask?: PointGuidedSelection['mask'],
  ) => {
    setSelection(nextSelection);
    if (source) setSelectionSource(source);
    render(nextSelection, previewMask, source === 'range' ? 'range' : 'tap');
  };

  const updateSelection = (event: React.PointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    const point = pointFromEvent(event);
    if (!interaction || !point || !canvasSize.width || !canvasSize.height) return;
    if (interaction.mode === 'tap') return;
    let nextSelection: SelectionRect;
    if (interaction.mode === 'create') {
      nextSelection = normalizeRect(interaction.start, point);
    } else if (interaction.mode === 'move') {
      nextSelection = {
        ...interaction.origin,
        x: clamp(point.x - (interaction.start.x - interaction.origin.x), 0, canvasSize.width - interaction.origin.width),
        y: clamp(point.y - (interaction.start.y - interaction.origin.y), 0, canvasSize.height - interaction.origin.height),
      };
    } else {
      nextSelection = resizeRect({
        origin: interaction.origin,
        handle: interaction.handle,
        point,
        canvasWidth: canvasSize.width,
        canvasHeight: canvasSize.height,
      });
    }
    setNextSelection(nextSelection, 'range');
  };

  const capturePointer = (event: React.PointerEvent<HTMLElement>) => {
    canvasWrapRef.current?.setPointerCapture(event.pointerId);
  };

  const beginCreate = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || event.button !== 0) return;
    setSelectionMode('range');
    setSelectionSource('range');
    setGuidedResult(null);
    const start = pointFromEvent(event);
    if (!start) return;
    interactionRef.current = { mode: 'create', start };
    capturePointer(event);
    setNextSelection({ x: start.x, y: start.y, width: 1, height: 1 }, 'range');
  };

  const beginMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || !selection || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = pointFromEvent(event);
    if (!start) return;
    setSelectionMode('range');
    setSelectionSource('range');
    setGuidedResult(null);
    interactionRef.current = { mode: 'move', start, origin: selection };
    capturePointer(event);
  };

  const beginResize = (event: React.PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    if (!ready || !selection || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = pointFromEvent(event);
    if (!start) return;
    setSelectionMode('range');
    setSelectionSource('range');
    setGuidedResult(null);
    interactionRef.current = { mode: 'resize', start, origin: selection, handle };
    capturePointer(event);
  };

  const exportSelection = (selectedSelection: SelectionRect, selectionSource: SelectionSource) => {
    const image = imageRef.current;
    const editorCanvas = canvasRef.current;
    if (
      !image
      || !editorCanvas
      || selectedSelection.width < MIN_SELECTION_EDGE
      || selectedSelection.height < MIN_SELECTION_EDGE
    ) {
      throw new Error('garment_selection_bounds_invalid');
    }
    const scale = scaleRef.current;
    const sourceX = selectedSelection.x / scale;
    const sourceY = selectedSelection.y / scale;
    const sourceWidth = selectedSelection.width / scale;
    const sourceHeight = selectedSelection.height / scale;
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const paddingX = Math.max(AI_CONTEXT_MIN_PADDING, sourceWidth * AI_CONTEXT_PADDING_RATIO);
    const paddingY = Math.max(AI_CONTEXT_MIN_PADDING, sourceHeight * AI_CONTEXT_PADDING_RATIO);
    const contextX = Math.max(0, sourceX - paddingX);
    const contextY = Math.max(0, sourceY - paddingY);
    const contextRight = Math.min(imageWidth, sourceX + sourceWidth + paddingX);
    const contextBottom = Math.min(imageHeight, sourceY + sourceHeight + paddingY);
    const contextWidth = Math.max(1, contextRight - contextX);
    const contextHeight = Math.max(1, contextBottom - contextY);
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(contextWidth));
    output.height = Math.max(1, Math.round(contextHeight));
    const context = output.getContext('2d');
    if (!context) throw new Error('garment_selection_output_context_missing');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, contextX, contextY, contextWidth, contextHeight, 0, 0, output.width, output.height);

    if (selectionSource === 'tap' && guidedResult?.mask && guidedResult.source !== 'tap-neighborhood') {
      // The preview and the confirmed PNG must use the same mask. Sample it in
      // the original-image coordinate system while preserving the surrounding
      // AI context crop.
      const displayMask = closePreviewMask(guidedResult.mask);
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = output.width;
      maskCanvas.height = output.height;
      const maskContext = maskCanvas.getContext('2d');
      if (!maskContext) throw new Error('garment_selection_mask_context_missing');
      const maskImageData = maskContext.createImageData(output.width, output.height);
      for (let y = 0; y < output.height; y += 1) {
        const sourceY = contextY + ((y + 0.5) / output.height) * contextHeight;
        const canvasY = sourceY * scale;
        const maskY = Math.max(
          0,
          Math.min(displayMask.height - 1, Math.floor((canvasY / editorCanvas.height) * displayMask.height)),
        );
        for (let x = 0; x < output.width; x += 1) {
          const sourceX = contextX + ((x + 0.5) / output.width) * contextWidth;
          const canvasX = sourceX * scale;
          const maskX = Math.max(
            0,
            Math.min(displayMask.width - 1, Math.floor((canvasX / editorCanvas.width) * displayMask.width)),
          );
          const selected = displayMask.data[(maskY * displayMask.width) + maskX] === 1;
          const offset = ((y * output.width) + x) * 4;
          maskImageData.data[offset] = 255;
          maskImageData.data[offset + 1] = 255;
          maskImageData.data[offset + 2] = 255;
          maskImageData.data[offset + 3] = selected ? 255 : 0;
        }
      }
      maskContext.putImageData(maskImageData, 0, 0);
      context.save();
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(maskCanvas, 0, 0);
      context.restore();
    }
    onApply(output.toDataURL('image/png'), selectionSource, segmentationTarget);
  };

  const recognizeTap = async (point: { x: number; y: number }) => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    const requestId = tapRequestIdRef.current + 1;
    tapRequestIdRef.current = requestId;
    setTapProcessing(true);
    try {
      const prepared = pointPromptRef.current
        ? await pointPromptRef.current.catch(() => null)
        : null;
      if (requestId !== tapRequestIdRef.current) return;
      if (prepared) {
        try {
          const candidate = await prepared.predict(point);
          if (requestId !== tapRequestIdRef.current) return;
          const proposal: PointGuidedSelection = {
            x: candidate.bbox?.x ?? 0,
            y: candidate.bbox?.y ?? 0,
            width: candidate.bbox?.width ?? canvas.width,
            height: candidate.bbox?.height ?? canvas.height,
            confidence: candidate.predictedIou,
            source: 'efficient-sam',
            selectedPixels: candidate.selectedPixels,
            touchesFrame: candidate.touchesFrame,
            mask: { width: canvas.width, height: canvas.height, data: candidate.mask },
          };
          setGuidedResult(proposal);
          setSelectionSource('tap');
          setNextSelection({ x: proposal.x, y: proposal.y, width: proposal.width, height: proposal.height }, 'tap', proposal.mask);
          return;
        } catch (modelError) {
          console.warn('Point-prompt garment prediction failed; using local selection fallback.', modelError);
        }
      }
      const analysisCanvas = document.createElement('canvas');
      analysisCanvas.width = canvas.width;
      analysisCanvas.height = canvas.height;
      const context = analysisCanvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('garment_selection_analysis_context_missing');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const proposal = buildPointGuidedSelection({
        width: canvas.width,
        height: canvas.height,
        data: imageData.data,
        point,
      });
      setGuidedResult(proposal);
      setSelectionSource('tap');
      setNextSelection({
        x: proposal.x,
        y: proposal.y,
        width: proposal.width,
        height: proposal.height,
      }, 'tap', proposal.mask);
    } catch (analysisError) {
      if (requestId !== tapRequestIdRef.current) return;
      console.warn('Point-guided garment selection failed; keeping the current range.', analysisError);
      setGuidedResult(null);
      setSelectionSource(null);
      setError('タップ認識に失敗しました。範囲を調整モードで服全体を囲んでください。');
    } finally {
      if (requestId === tapRequestIdRef.current) setTapProcessing(false);
    }
  };

  const beginTap = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || event.button !== 0 || tapProcessing) return;
    event.preventDefault();
    event.stopPropagation();
    const start = pointFromEvent(event);
    if (!start) return;
    interactionRef.current = { mode: 'tap', start };
    capturePointer(event);
  };

  const endInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    interactionRef.current = null;
    canvasWrapRef.current?.releasePointerCapture?.(event.pointerId);
    if (!interaction || interaction.mode !== 'tap' || tapProcessing) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const distance = Math.hypot(point.x - interaction.start.x, point.y - interaction.start.y);
    if (distance <= Math.max(12, canvasSize.width * 0.015)) void recognizeTap(point);
  };

  const selectWholeCanvas = () => {
    if (!ready || !canvasSize.width || !canvasSize.height) return;
    tapRequestIdRef.current += 1;
    setTapProcessing(false);
    setSelectionMode('range');
    setGuidedResult(null);
    setNextSelection({ x: 0, y: 0, width: canvasSize.width, height: canvasSize.height }, 'range');
  };

  const clearSelection = () => {
    tapRequestIdRef.current += 1;
    setTapProcessing(false);
    interactionRef.current = null;
    setSelection(null);
    setSelectionSource(null);
    setGuidedResult(null);
    // A retry should return to the recommended tap lane. Keeping range mode
    // here makes the next click create a transient 1x1 range, which is easy
    // to mistake for a failed tap recognition in the public UI.
    setSelectionMode('tap');
    render(null);
  };

  const chooseTapMode = () => {
    tapRequestIdRef.current += 1;
    setTapProcessing(false);
    setSelectionMode('tap');
    setError(null);
    if (selectionSource === 'range') {
      setSelection(null);
      setSelectionSource(null);
      setGuidedResult(null);
      render(null);
    }
  };

  const chooseRangeMode = () => {
    tapRequestIdRef.current += 1;
    setTapProcessing(false);
    setSelectionMode('range');
    setError(null);
    if (selectionSource === 'tap' && selection) {
      setGuidedResult(null);
      setSelectionSource('range');
      render(selection, undefined, 'range');
    }
  };

  const chooseMaskDisplayMode = (nextMode: MaskDisplayMode) => {
    maskDisplayModeRef.current = nextMode;
    setMaskDisplayMode(nextMode);
    render(selection, guidedResult?.mask, selectionMode);
  };

  const chooseSegmentationTarget = (nextTarget: GarmentSegmentationTarget) => {
    if (nextTarget === segmentationTarget) return;
    tapRequestIdRef.current += 1;
    setTapProcessing(false);
    setSegmentationTarget(nextTarget);
    setSelection(null);
    setSelectionSource(null);
    setGuidedResult(null);
    render(null);
  };

  const apply = () => {
    const image = imageRef.current;
    const currentSelection = selection;
    if (
      !image
      || !currentSelection
      || !selectionSource
      || !canSubmitGarmentSelectionPreview({
        selectionSource,
        hasGuidedMask: Boolean(guidedResult?.mask),
      })
      || currentSelection.width < MIN_SELECTION_EDGE
      || currentSelection.height < MIN_SELECTION_EDGE
    ) {
      setError('服をタップして認識するか、「範囲を調整」で服全体を16px以上の範囲にしてください。');
      return;
    }
    try {
      exportSelection(
        currentSelection,
        guidedResult?.source === 'tap-neighborhood' ? 'range' : selectionSource,
      );
    } catch (applyError) {
      console.error('Garment selection export failed', applyError);
      setError('選択範囲をAIマスクへ渡せませんでした。別の範囲で再試行してください。');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="服をタップしてAIマスク"
      size="xl"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>キャンセル</Button>
          <Button
            onClick={apply}
            disabled={
              !ready
              || !selection
              || !selectionSource
              || tapProcessing
              || !canSubmitGarmentSelectionPreview({
                selectionSource,
                hasGuidedMask: Boolean(guidedResult?.mask),
              })
            }
            data-testid="garment-mask-confirm"
          >
            {selectionMode === 'tap'
              ? selectionSource === 'tap' && guidedResult?.mask
                ? guidedResult.source === 'tap-neighborhood' ? 'この候補で決定' : '決定'
                : '服をタップしてください'
              : '選択範囲をAIマスクへ渡す'}
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-300">
          「服をタップ（推奨）」で服の位置を1回押すと、タップAIが同じ服の輪郭を候補にします。青色の範囲が実際に切り抜かれる確認用プレビューです。内容を確認して「決定」を押すと、その範囲だけを使用します。細かく指定するときは「範囲を調整」に切り替えます。
        </p>
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="服の選択方法">
          <button
            type="button"
            role="tab"
            aria-selected={selectionMode === 'tap'}
            onClick={chooseTapMode}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${selectionMode === 'tap'
              ? 'border-cyan-300 bg-cyan-300/20 text-cyan-50'
              : 'border-white/10 bg-white/5 text-white/65 hover:bg-white/10'}`}
          >
            服をタップ（推奨）
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectionMode === 'range'}
            onClick={chooseRangeMode}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${selectionMode === 'range'
              ? 'border-cyan-300 bg-cyan-300/20 text-cyan-50'
              : 'border-white/10 bg-white/5 text-white/65 hover:bg-white/10'}`}
          >
            範囲を調整
          </button>
        </div>
        <fieldset className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <legend className="px-1 text-xs font-semibold text-white">認識する服のカテゴリ</legend>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="認識する服のカテゴリ">
            {garmentTargetOptions.map((option) => (
              <label
                key={option.value}
                className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold transition ${segmentationTarget === option.value
                  ? 'border-cyan-300 bg-cyan-300/20 text-cyan-50'
                  : 'border-white/10 bg-white/5 text-white/65 hover:bg-white/10'}`}
              >
                <input
                  type="radio"
                  name="garment-segmentation-target"
                  value={option.value}
                  checked={segmentationTarget === option.value}
                  onChange={() => chooseSegmentationTarget(option.value)}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.8fr)] lg:items-start">
          <div className="overflow-auto rounded-2xl border border-cyan-300/20 bg-neutral-950 p-3">
            <div
              ref={canvasWrapRef}
              className={`relative mx-auto w-fit max-w-full ${ready ? (selectionMode === 'tap' ? 'cursor-pointer' : 'cursor-crosshair') : 'opacity-50'}`}
              onPointerDown={selectionMode === 'tap' ? beginTap : beginCreate}
              onPointerMove={updateSelection}
              onPointerUp={endInteraction}
              onPointerCancel={() => { interactionRef.current = null; }}
            >
              <canvas
                ref={canvasRef}
                data-testid="garment-source-canvas"
                className="block h-auto max-h-[min(50vh,32rem)] max-w-full touch-none object-contain"
              />
              {selectionMode === 'range' && ready && selection && canvasSize.width > 0 && canvasSize.height > 0 && (
                <div className="pointer-events-none absolute inset-0">
                  <div
                    className="pointer-events-auto absolute border-2 border-cyan-300 bg-cyan-300/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.16)]"
                    style={{
                      left: `${(selection.x / canvasSize.width) * 100}%`,
                      top: `${(selection.y / canvasSize.height) * 100}%`,
                      width: `${(selection.width / canvasSize.width) * 100}%`,
                      height: `${(selection.height / canvasSize.height) * 100}%`,
                    }}
                    onPointerDown={beginMove}
                  >
                    <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/65 px-2 py-1 text-[10px] font-medium text-white">
                      中央をドラッグして移動
                    </span>
                    {resizeHandleDetails.map((handle) => (
                      <button
                        key={handle.id}
                        type="button"
                        aria-label={`選択範囲の${handle.label}を調整`}
                        className="pointer-events-auto absolute z-10 h-7 w-7 touch-none select-none -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-400 shadow-lg shadow-cyan-950/50"
                        style={{ left: `${handle.left}%`, top: `${handle.top}%`, cursor: handle.cursor }}
                        onPointerDown={(event) => beginResize(event, handle.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <aside
            className="rounded-xl border border-blue-400/25 bg-blue-950/25 p-3"
            aria-label="認識範囲プレビュー"
            data-testid="garment-mask-preview-panel"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-blue-50">認識範囲プレビュー</p>
                <p className="mt-1 text-[11px] leading-relaxed text-blue-100/65">
                  青い面が、確定前に確認するデザイン適用範囲です。
                </p>
              </div>
              <span className="rounded-full border border-cyan-200/25 bg-cyan-300/10 px-2 py-1 text-[10px] font-semibold text-cyan-100">
                {selectionSource === 'tap' && guidedResult?.mask
                  ? guidedResult.source === 'tap-neighborhood' ? '低信頼候補' : 'タップ認識済み'
                  : '確定前'}
              </span>
            </div>
            <div className="flex min-h-32 items-center justify-center overflow-auto rounded-lg border border-blue-300/20 bg-neutral-950/70 p-2">
              <canvas
                ref={maskPreviewCanvasRef}
                data-testid="garment-mask-preview-canvas"
                className="block h-auto max-h-80 max-w-full object-contain"
              />
              {!ready && <span className="text-xs text-white/45">画像を読み込んでいます…</span>}
            </div>
            {selectionSource === 'tap' && guidedResult?.mask && (
            <fieldset className="mt-3" data-testid="garment-mask-display-controls">
              <legend className="text-[11px] font-semibold text-blue-50">プレビュー表示</legend>
              <div className="mt-2 grid grid-cols-3 gap-1" role="radiogroup" aria-label="マスクのプレビュー表示">
                {([
                  { value: 'overlay', label: '重ねて表示' },
                  { value: 'source', label: '元画像' },
                  { value: 'mask-only', label: 'マスクのみ' },
                ] as const).map((option) => (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-lg border px-2 py-1.5 text-center text-[10px] font-semibold transition focus-within:outline-none focus-within:ring-2 focus-within:ring-cyan-200/80 focus-within:ring-offset-2 focus-within:ring-offset-blue-950 ${maskDisplayMode === option.value
                      ? 'border-cyan-200 bg-cyan-300/15 text-cyan-50'
                      : 'border-white/10 bg-white/[0.04] text-white/55 hover:text-white/80'}`}
                  >
                    <input
                      type="radio"
                      name="garment-mask-display-mode"
                      value={option.value}
                      checked={maskDisplayMode === option.value}
                      onChange={() => chooseMaskDisplayMode(option.value)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
            )}
            {selectionSource === 'tap' && guidedResult?.mask && (
              <p className="mt-2 text-[11px] leading-relaxed text-cyan-100/75" data-testid="garment-mask-preview-note">
                {guidedResult.source === 'tap-neighborhood'
                  ? 'タップ位置から作った矩形候補です。内容を確認してから「この候補で決定」を押してください。'
                  : 'このプレビューを確認してから「決定」を押してください。確定後も既存のAI切り抜き・手動fallbackを保持します。'}
              </p>
            )}
          </aside>
        </div>
        {selectionSource === 'tap' && guidedResult?.mask && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-400/30 bg-blue-950/35 px-3 py-2 text-xs text-blue-50" role="status" data-testid="garment-mask-confirmation">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="h-3 w-3 rounded-sm border border-cyan-100 bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.75)]" />
              {guidedResult.source === 'tap-neighborhood'
                ? '青色の塗りつぶしがタップ位置から作った矩形候補です'
                : '青色の塗りつぶしが今回のタップ認識範囲です'}
            </span>
            <span className="text-cyan-100/80">境界を確認してから確定</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={selectWholeCanvas}
            disabled={!ready}
            className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            画像全体を選択
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={!ready}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            選択をやり直す
          </button>
        </div>
        <p role="status" aria-live="polite" className="text-xs text-neutral-500 dark:text-neutral-400">
          {tapProcessing
            ? 'タップ位置から服を認識しています…'
            : selectionSource === 'tap' && guidedResult
              ? guidedResult.source === 'tap-neighborhood'
                ? `低信頼候補です。タップ位置から作った矩形候補を確認してください。信頼度: ${Math.round(guidedResult.confidence * 100)}% / ${Math.round(selection?.width ? selection.width / scaleRef.current : 0)} × ${Math.round(selection?.height ? selection.height / scaleRef.current : 0)}px`
                : `青色マスクを確認してください。タップ認識: ${Math.round(guidedResult.confidence * 100)}% / ${Math.round(selection?.width ? selection.width / scaleRef.current : 0)} × ${Math.round(selection?.height ? selection.height / scaleRef.current : 0)}px`
              : selectionSource === 'range' && selection
                ? `範囲指定: ${Math.round(selection.width / scaleRef.current)} × ${Math.round(selection.height / scaleRef.current)}px`
                : '服をタップすると、そこにある服の候補範囲を自動認識します。'}
        </p>
      </div>
    </Modal>
  );
}
