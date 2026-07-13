import { useMemo } from 'react';
import { useCanvasStore } from '../../stores/canvasStore';

interface MinimapProps {
  canvasWidth: number;
  canvasHeight: number;
}

export function Minimap({ canvasWidth, canvasHeight }: MinimapProps) {
  const { objects, zoom, panX, panY, setPan } = useCanvasStore();
  
  const minimapWidth = 160;
  const minimapHeight = 120;
  
  // Calculate bounds of all objects
  const bounds = useMemo(() => {
    if (objects.length === 0) {
      return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    }
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    objects.forEach((obj) => {
      minX = Math.min(minX, obj.x);
      minY = Math.min(minY, obj.y);
      maxX = Math.max(maxX, obj.x + obj.width);
      maxY = Math.max(maxY, obj.y + obj.height);
    });
    
    // Add padding
    const padding = 100;
    return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding,
    };
  }, [objects]);

  // Calculate scale to fit all objects in minimap
  const scale = useMemo(() => {
    const boundsWidth = bounds.maxX - bounds.minX;
    const boundsHeight = bounds.maxY - bounds.minY;
    return Math.min(
      minimapWidth / boundsWidth,
      minimapHeight / boundsHeight,
      0.1
    );
  }, [bounds]);

  // Calculate viewport rectangle
  const viewport = useMemo(() => {
    const viewX = (-panX / zoom - bounds.minX) * scale;
    const viewY = (-panY / zoom - bounds.minY) * scale;
    const viewW = (canvasWidth / zoom) * scale;
    const viewH = (canvasHeight / zoom) * scale;
    return { x: viewX, y: viewY, width: viewW, height: viewH };
  }, [panX, panY, zoom, bounds, scale, canvasWidth, canvasHeight]);

  // Handle click to navigate
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert minimap coords to canvas coords
    const canvasX = (x / scale) + bounds.minX;
    const canvasY = (y / scale) + bounds.minY;
    
    // Center the view on clicked point
    setPan(
      -canvasX * zoom + canvasWidth / 2,
      -canvasY * zoom + canvasHeight / 2
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-soft border border-neutral-100 p-2">
      <svg
        width={minimapWidth}
        height={minimapHeight}
        className="cursor-pointer"
        onClick={handleClick}
      >
        {/* Background */}
        <rect
          width={minimapWidth}
          height={minimapHeight}
          fill="#fafafa"
          rx={4}
        />
        
        {/* Objects */}
        {objects.map((obj) => (
          <rect
            key={obj.id}
            x={(obj.x - bounds.minX) * scale}
            y={(obj.y - bounds.minY) * scale}
            width={Math.max(2, obj.width * scale)}
            height={Math.max(2, obj.height * scale)}
            fill={obj.type === 'image' ? '#806a54' : '#a3a3a3'}
            opacity={0.6}
            rx={1}
          />
        ))}
        
        {/* Viewport rectangle */}
        <rect
          x={viewport.x}
          y={viewport.y}
          width={viewport.width}
          height={viewport.height}
          fill="none"
          stroke="#806a54"
          strokeWidth={2}
          rx={2}
        />
      </svg>
    </div>
  );
}

