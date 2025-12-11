import { useRef, useEffect, useCallback, useState } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Text, Transformer, Line, Circle } from 'react-konva';
import type Konva from 'konva';
import { useCanvasStore, type CanvasObject } from '../../stores/canvasStore';
import { ContextMenu } from './ContextMenu';

interface InfiniteCanvasProps {
  width: number;
  height: number;
  onObjectSelect?: (id: string | null) => void;
  onContextAction?: (action: string, objectId: string | null) => void;
}

export function InfiniteCanvas({ width, height, onObjectSelect, onContextAction }: InfiniteCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [loadedImages, setLoadedImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; objectId: string | null; objectType: 'image' | 'text' | 'shape' | 'frame' | null } | null>(null);
  
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

  // Handle right click (context menu)
  const handleContextMenu = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const pointerPosition = stage.getPointerPosition();
    if (!pointerPosition) return;

    // Check if clicking on an object
    const clickedObject = objects.find(obj => {
      const node = stage.findOne(`#${obj.id}`);
      if (!node) return false;
      const pos = node.getClientRect();
      return (
        pointerPosition.x >= pos.x &&
        pointerPosition.x <= pos.x + pos.width &&
        pointerPosition.y >= pos.y &&
        pointerPosition.y <= pos.y + pos.height
      );
    });

    setContextMenu({
      x: e.evt.clientX,
      y: e.evt.clientY,
      objectId: clickedObject?.id || null,
      objectType: clickedObject?.type || null,
    });
  }, [objects]);

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
    const padding = 1000;
    const stageWidth = (width + padding * 2) / zoom + Math.abs(panX / zoom) * 2;
    const stageHeight = (height + padding * 2) / zoom + Math.abs(panY / zoom) * 2;
    const startX = Math.floor((-panX / zoom - padding / zoom) / gridSize) * gridSize - gridSize * 2;
    const startY = Math.floor((-panY / zoom - padding / zoom) / gridSize) * gridSize - gridSize * 2;

    for (let i = startX; i < stageWidth + startX + padding; i += gridSize) {
      lines.push(
        <Line
          key={`v-${i}`}
          points={[i, startY - padding, i, startY + stageHeight + padding * 2]}
          stroke="rgba(0,0,0,0.1)"
          strokeWidth={0.5 / zoom}
          listening={false}
        />
      );
    }
    
    for (let i = startY; i < stageHeight + startY + padding; i += gridSize) {
      lines.push(
        <Line
          key={`h-${i}`}
          points={[startX - padding, i, startX + stageWidth + padding * 2, i]}
          stroke="rgba(0,0,0,0.1)"
          strokeWidth={0.5 / zoom}
          listening={false}
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

  // Render derivation connections
  const renderDerivationLines = () => {
    const lines: JSX.Element[] = [];
    
    objects.forEach((obj) => {
      if (obj.derivedFrom) {
        const parent = objects.find((o) => o.id === obj.derivedFrom);
        if (parent) {
          const startX = parent.x + parent.width / 2;
          const startY = parent.y + parent.height / 2;
          const endX = obj.x + obj.width / 2;
          const endY = obj.y + obj.height / 2;
          
          lines.push(
            <Line
              key={`derivation-${parent.id}-${obj.id}`}
              points={[startX, startY, endX, endY]}
              stroke="#806a54"
              strokeWidth={2 / zoom}
              dash={[10 / zoom, 5 / zoom]}
              opacity={0.5}
              listening={false}
            />
          );
          
          // Add arrow head
          const angle = Math.atan2(endY - startY, endX - startX);
          const arrowLength = 15 / zoom;
          const arrowAngle = Math.PI / 6;
          
          lines.push(
            <Line
              key={`arrow-${parent.id}-${obj.id}`}
              points={[
                endX,
                endY,
                endX - arrowLength * Math.cos(angle - arrowAngle),
                endY - arrowLength * Math.sin(angle - arrowAngle),
                endX - arrowLength * Math.cos(angle + arrowAngle),
                endY - arrowLength * Math.sin(angle + arrowAngle),
                endX,
                endY,
              ]}
              stroke="#806a54"
              fill="#806a54"
              strokeWidth={1 / zoom}
              opacity={0.5}
              listening={false}
              closed
            />
          );
        }
      }
    });
    
    return lines;
  };

  // Render generation badge
  const renderGenerationBadge = (obj: CanvasObject) => {
    if (!obj.metadata?.generation || obj.metadata.generation === 0) return null;
    
    const badgeWidth = 50 / zoom;
    const badgeHeight = 20 / zoom;
    const badgeX = obj.x + obj.width - badgeWidth - 5 / zoom;
    const badgeY = obj.y + 5 / zoom;
    
    return (
      <>
        <Rect
          key={`gen-badge-bg-${obj.id}`}
          x={badgeX}
          y={badgeY}
          width={badgeWidth}
          height={badgeHeight}
          fill="#806a54"
          cornerRadius={4 / zoom}
          opacity={0.9}
          listening={false}
        />
        <Text
          key={`gen-badge-text-${obj.id}`}
          x={badgeX}
          y={badgeY}
          width={badgeWidth}
          height={badgeHeight}
          text={`Gen ${obj.metadata.generation}`}
          fontSize={10 / zoom}
          fill="#fff"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </>
    );
  };

  // Sort objects by zIndex
  const sortedObjects = [...objects]
    .filter((obj) => obj.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex);

  return (
    <>
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
        onContextMenu={handleContextMenu}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            setPan(e.target.x(), e.target.y());
          }
        }}
        style={{ backgroundColor: '#fafafa' }}
      >
        {renderGrid()}
        
        <Layer>
          {/* Derivation connection lines (drawn first, behind objects) */}
          {renderDerivationLines()}
          
          {sortedObjects.map(renderObject)}
          
          {/* Generation badges (drawn on top of images) */}
          {sortedObjects.filter(obj => obj.type === 'image').map(renderGenerationBadge)}
          
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          objectType={contextMenu.objectType}
          selectedObjectId={contextMenu.objectId}
          onClose={() => setContextMenu(null)}
          onAction={(action) => {
            onContextAction?.(action, contextMenu.objectId);
            setContextMenu(null);
          }}
          isLocked={contextMenu.objectId ? objects.find(o => o.id === contextMenu.objectId)?.locked : false}
          isVisible={contextMenu.objectId ? objects.find(o => o.id === contextMenu.objectId)?.visible : true}
          hasMultipleSelected={selectedIds.length > 1}
        />
      )}
    </>
  );
}

