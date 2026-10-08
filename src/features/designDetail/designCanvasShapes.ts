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

/** Creates a new object centred on (cx, cy) in canvas coordinates. */
export function createDesignCanvasObject(tool: DesignShapeKind | 'frame' | 'text', cx: number, cy: number, zIndex: number,
  newId: () => string = () => crypto.randomUUID()): DesignCanvasObject {
  const id = `${tool}-${newId()}`;
  if (tool === 'text') return { ...base(id, cx - 300, cy - 60, 600, 120, zIndex), type: 'text', text: 'テキストを入力', fontSize: 80, fill: '#ffffff', label: 'テキスト' };
  if (tool === 'frame') return { ...base(id, cx - 540, cy - 720, 1080, 1440, zIndex), type: 'frame', fill: '#ffffff', stroke: '#d4d4d4', strokeWidth: 2, label: 'パネル' };
  const line = tool === 'line' || tool === 'arrow';
  const label = DESIGN_SHAPES.find((shape) => shape.kind === tool)?.label ?? '図形';
  return { ...base(id, cx - 300, cy - (line ? 20 : 300), 600, line ? 40 : 600, zIndex), type: 'shape', shapeType: tool,
    fill: line ? 'transparent' : '#5fcfc4', stroke: line ? '#5fcfc4' : 'transparent', strokeWidth: line ? 12 : 0, label };
}
