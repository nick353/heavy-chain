import type { DesignCanvasObject } from './designCanvasShapes';

export { DESIGN_SHAPES, createDesignCanvasObject, type DesignCanvasObject, type DesignShapeKind } from './designCanvasShapes';

const color = (value: unknown, fallback: string) => typeof value === 'string' && value ? value : fallback;

/** Renders one non-image object filling its box; the caller positions the box. */
export function DesignCanvasShape({ object }: { object: DesignCanvasObject }) {
  const width = Number(object.width) || 1;
  const height = Number(object.height) || 1;
  if (object.type === 'text') {
    return <span className="block h-full w-full whitespace-pre-wrap break-words leading-tight" style={{ fontSize: Number(object.fontSize) || 80, color: color(object.fill, '#ffffff') }}>{String(object.text ?? '')}</span>;
  }
  if (object.type === 'frame') {
    return <span className="block h-full w-full" style={{ background: color(object.fill, '#ffffff'), border: `${Number(object.strokeWidth) || 2}px solid ${color(object.stroke, '#d4d4d4')}` }} />;
  }
  const fill = color(object.fill, '#5fcfc4');
  const stroke = color(object.stroke, 'transparent');
  const strokeWidth = Number(object.strokeWidth) || 0;
  const shape = String(object.shapeType ?? 'rect');
  return <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" className="block overflow-visible">
    <defs><marker id={`arrow-${object.id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill={stroke} /></marker></defs>
    {shape === 'circle' && <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />}
    {shape === 'triangle' && <polygon points={`${width / 2},0 ${width},${height} 0,${height}`} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />}
    {(shape === 'line' || shape === 'arrow') && <line x1="0" y1={height / 2} x2={width - (shape === 'arrow' ? strokeWidth * 2 : 0)} y2={height / 2} stroke={stroke} strokeWidth={strokeWidth}
      markerEnd={shape === 'arrow' ? `url(#arrow-${object.id})` : undefined} />}
    {shape === 'rect' && <rect x="0" y="0" width={width} height={height} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />}
  </svg>;
}
