import { useRef, useEffect, useCallback, useState } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Text, Transformer, Line, Circle } from 'react-konva';
import type Konva from 'konva';
import { useCanvasStore, type CanvasObject } from '../../stores/canvasStore';

interface InfiniteCanvasProps {
  width: number;
  height: number;
  onObjectSelect?: (id: string | null) => void;
}

export function InfiniteCanvas({ width, height, onObjectSelect }: InfiniteCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [loadedImages, setLoadedImages] = useState<Map<string, HTMLImageElement>>(new Map());
  
  const {
    zoom,
    panX,
    panY,
    gridVisible,
    snapToGrid,
    gridSize,
    objects,
    selectedIds,
    setZoom,
    setPan,
    selectObject,
    deselectAll,
    updateObject,
    saveToHistory,
  } = useCanvasStore();

  // Load images
  useEffect(() => {
    objects.forEach((obj) => {
      if (obj.type === 'image' && obj.src && !loadedImages.has(obj.id)) {
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.src = obj.src;
        img.onload = () => {
          setLoadedImages((prev) => new Map(prev).set(obj.id, img));
        };
      }
    });
  }, [objects, loadedImages]);

  // Update transformer
  useEffect(() => {
    if (transformerRef.current && stageRef.current) {
      const selectedNodes = selectedIds
        .map((id) => stageRef.current?.findOne(`#${id}`))
        .filter(Boolean) as Konva.Node[];
      
      transformerRef.current.nodes(selectedNodes);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [selectedIds]);

  // Handle wheel zoom
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    
    const stage = stageRef.current;
    if (!stage) return;

    const oldZoom = zoom;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - panX) / oldZoom,
      y: (pointer.y - panY) / oldZoom,
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newZoom = direction > 0 ? oldZoom * 1.1 : oldZoom / 1.1;
    const clampedZoom = Math.max(0.1, Math.min(5, newZoom));

    setZoom(clampedZoom);
    setPan(
      pointer.x - mousePointTo.x * clampedZoom,
      pointer.y - mousePointTo.y * clampedZoom
    );
  }, [zoom, panX, panY, setZoom, setPan]);

  // Handle stage click (deselect)
  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage()) {
      deselectAll();
      onObjectSelect?.(null);
    }
  }, [deselectAll, onObjectSelect]);

  // Handle object drag end
  const handleDragEnd = useCallback((id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    let x = e.target.x();
    let y = e.target.y();

    if (snapToGrid) {
      x = Math.round(x / gridSize) * gridSize;
      y = Math.round(y / gridSize) * gridSize;
      e.target.position({ x, y });
    }

    updateObject(id, { x, y });
    saveToHistory();
  }, [snapToGrid, gridSize, updateObject, saveToHistory]);

  // Handle transform end
  const handleTransformEnd = useCallback((id: string, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    updateObject(id, {
      x: node.x(),
      y: node.y(),
      width: Math.max(5, node.width() * node.scaleX()),
      height: Math.max(5, node.height() * node.scaleY()),
      rotation: node.rotation(),
      scaleX: 1,
      scaleY: 1,
    });
    
    node.scaleX(1);
    node.scaleY(1);
    saveToHistory();
  }, [updateObject, saveToHistory]);

  // Handle object select
  const handleObjectClick = useCallback((id: string, e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    const isMultiSelect = e.evt.shiftKey || e.evt.metaKey;
    selectObject(id, isMultiSelect);
    onObjectSelect?.(id);
  }, [selectObject, onObjectSelect]);

  // Render grid - extend beyond visible area for smooth resizing
  const renderGrid = () => {
    if (!gridVisible) return null;
    
    const lines = [];
    // Add extra padding to ensure grid covers the entire area even during resize
    const padding = 500;
    const stageWidth = (width + padding * 2) / zoom + Math.abs(panX / zoom) * 2;
    const stageHeight = (height + padding * 2) / zoom + Math.abs(panY / zoom) * 2;
    const startX = Math.floor((-panX / zoom - padding / zoom) / gridSize) * gridSize - gridSize;
    const startY = Math.floor((-panY / zoom - padding / zoom) / gridSize) * gridSize - gridSize;

    for (let i = startX; i < stageWidth + startX; i += gridSize) {
      lines.push(
        <Line
          key={`v-${i}`}
          points={[i, startY - padding, i, startY + stageHeight + padding]}
          stroke="#e5e5e5"
          strokeWidth={0.5 / zoom}
        />
      );
    }
    
    for (let i = startY; i < stageHeight + startY; i += gridSize) {
      lines.push(
        <Line
          key={`h-${i}`}
          points={[startX - padding, i, startX + stageWidth + padding, i]}
          stroke="#e5e5e5"
          strokeWidth={0.5 / zoom}
        />
      );
    }
    
    return <Layer listening={false}>{lines}</Layer>;
  };

  // Render object based on type
  const renderObject = (obj: CanvasObject) => {
    const isSelected = selectedIds.includes(obj.id);
    const commonProps = {
      id: obj.id,
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      rotation: obj.rotation,
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      opacity: obj.opacity,
      draggable: !obj.locked,
      onClick: (e: Konva.KonvaEventObject<MouseEvent>) => handleObjectClick(obj.id, e),
      onTap: (e: Konva.KonvaEventObject<Event>) => handleObjectClick(obj.id, e as any),
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => handleDragEnd(obj.id, e),
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => handleTransformEnd(obj.id, e),
    };

    switch (obj.type) {
      case 'image': {
        const img = loadedImages.get(obj.id);
        if (!img) return null;
        return (
          <KonvaImage
            key={obj.id}
            {...commonProps}
            image={img}
            stroke={isSelected ? '#806a54' : undefined}
            strokeWidth={isSelected ? 2 / zoom : 0}
          />
        );
      }
      
      case 'text':
        return (
          <Text
            key={obj.id}
            {...commonProps}
            text={obj.text || ''}
            fontSize={obj.fontSize || 16}
            fontFamily={obj.fontFamily || 'Inter'}
            fill={obj.fill || '#262626'}
            stroke={isSelected ? '#806a54' : undefined}
            strokeWidth={isSelected ? 1 / zoom : 0}
          />
        );
      
      case 'shape':
        if (obj.shapeType === 'circle') {
          return (
            <Circle
              key={obj.id}
              {...commonProps}
              radius={obj.width / 2}
              fill={obj.fill || '#e5e5e5'}
              stroke={obj.stroke || '#a3a3a3'}
              strokeWidth={obj.strokeWidth || 1}
            />
          );
        }
        return (
          <Rect
            key={obj.id}
            {...commonProps}
            fill={obj.fill || '#e5e5e5'}
            stroke={obj.stroke || '#a3a3a3'}
            strokeWidth={obj.strokeWidth || 1}
            cornerRadius={4}
          />
        );
      
      case 'frame':
        return (
          <Rect
            key={obj.id}
            {...commonProps}
            fill="transparent"
            stroke={obj.stroke || '#806a54'}
            strokeWidth={obj.strokeWidth || 2}
            dash={[5, 5]}
          />
        );
      
      default:
        return null;
    }
  };

  // Sort objects by zIndex
  const sortedObjects = [...objects]
    .filter((obj) => obj.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex);

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      scaleX={zoom}
      scaleY={zoom}
      x={panX}
      y={panY}
      draggable
      onWheel={handleWheel}
      onClick={handleStageClick}
      onDragEnd={(e) => {
        if (e.target === stageRef.current) {
          setPan(e.target.x(), e.target.y());
        }
      }}
      style={{ backgroundColor: '#fafafa' }}
    >
      {renderGrid()}
      
      <Layer>
        {sortedObjects.map(renderObject)}
        
        <Transformer
          ref={transformerRef}
          boundBoxFunc={(oldBox, newBox) => {
            // Limit resize
            if (newBox.width < 5 || newBox.height < 5) {
              return oldBox;
            }
            return newBox;
          }}
          rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
          anchorFill="#fff"
          anchorStroke="#806a54"
          anchorSize={8}
          anchorCornerRadius={2}
          borderStroke="#806a54"
          borderStrokeWidth={1}
        />
      </Layer>
    </Stage>
  );
}

