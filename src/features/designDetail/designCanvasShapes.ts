/** Shapes, panels and text placed with the design detail toolbar, stored in the same Canvas document as images. */
export type DesignShapeKind = 'rect' | 'circle' | 'triangle' | 'line' | 'arrow';
export type DesignCanvasObject = Record<string, unknown> & { id: string; type: string };

export const DESIGN_SHAPES: readonly { kind: DesignShapeKind; label: string }[] = [
  { kind: 'rect', label: '矩形' }, { kind: 'circle', label: '円形' }, { kind: 'triangle', label: '三角形' },
  { kind: 'line', label: '線' }, { kind: 'arrow', label: '矢印' },
];

const base = (id: string, x: number, y: number, width: number, height: number, zIndex: number) => ({
  id, x, y, width, height, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, visible: true, zIndex,
});

/** Creates a new object centred on (cx, cy) in canvas coordinates; `unit` is the shape size (callers scale it to the view). */
export function createDesignCanvasObject(tool: DesignShapeKind | 'frame' | 'text', cx: number, cy: number, zIndex: number,
  newId: () => string = () => crypto.randomUUID(), unit = 600): DesignCanvasObject {
  const id = `${tool}-${newId()}`;
  const u = Math.max(20, unit);
  if (tool === 'text') return { ...base(id, cx - u / 2, cy - u / 10, u, u / 5, zIndex), type: 'text', text: 'テキストを入力', fontSize: Math.round(u / 7.5), fill: '#ffffff', label: 'テキスト' };
  if (tool === 'frame') return { ...base(id, cx - u * 0.45, cy - u * 0.6, u * 0.9, u * 1.2, zIndex), type: 'frame', fill: '#ffffff', stroke: '#d4d4d4', strokeWidth: 2, label: 'パネル' };
  const line = tool === 'line' || tool === 'arrow';
  const label = DESIGN_SHAPES.find((shape) => shape.kind === tool)?.label ?? '図形';
  const thickness = Math.max(2, Math.round(u / 50));
  return { ...base(id, cx - u / 2, cy - (line ? thickness * 2 : u / 2), u, line ? thickness * 4 : u, zIndex), type: 'shape', shapeType: tool,
    fill: line ? 'transparent' : '#5fcfc4', stroke: line ? '#5fcfc4' : 'transparent', strokeWidth: line ? thickness : 0, label };
}
