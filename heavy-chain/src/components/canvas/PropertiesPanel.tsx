import { useState, useEffect } from 'react';
import { 
  Type, 
  Palette, 
  Move, 
  RotateCw,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Trash2
} from 'lucide-react';
import { useCanvasStore, type CanvasObject } from '../../stores/canvasStore';

interface PropertiesPanelProps {
  selectedObject: CanvasObject | null;
}

export function PropertiesPanel({ selectedObject }: PropertiesPanelProps) {
  const { updateObject, deleteObject, saveToHistory } = useCanvasStore();
  const [localValues, setLocalValues] = useState<Partial<CanvasObject>>({});

  useEffect(() => {
    if (selectedObject) {
      setLocalValues({
        x: selectedObject.x,
        y: selectedObject.y,
        width: selectedObject.width,
        height: selectedObject.height,
        rotation: selectedObject.rotation,
        opacity: selectedObject.opacity,
        text: selectedObject.text,
        fontSize: selectedObject.fontSize,
        fill: selectedObject.fill,
      });
    }
  }, [selectedObject]);

  if (!selectedObject) {
    return (
      <div className="p-4 text-center text-neutral-500">
        <p className="text-sm">オブジェクトを選択してください</p>
      </div>
    );
  }

  const handleChange = (key: keyof CanvasObject, value: any) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleBlur = (key: keyof CanvasObject) => {
    if (localValues[key] !== undefined) {
      updateObject(selectedObject.id, { [key]: localValues[key] });
      saveToHistory();
    }
  };

  const toggleLock = () => {
    updateObject(selectedObject.id, { locked: !selectedObject.locked });
  };

  const toggleVisibility = () => {
    updateObject(selectedObject.id, { visible: !selectedObject.visible });
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-neutral-800">プロパティ</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleLock}
            className={`p-1.5 rounded-lg transition-colors ${
              selectedObject.locked 
                ? 'bg-primary-100 text-primary-700' 
                : 'text-neutral-400 hover:bg-neutral-100'
            }`}
            title={selectedObject.locked ? 'ロック解除' : 'ロック'}
          >
            {selectedObject.locked ? (
              <Lock className="w-4 h-4" />
            ) : (
              <Unlock className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={toggleVisibility}
            className={`p-1.5 rounded-lg transition-colors ${
              selectedObject.visible === false
                ? 'bg-neutral-200 text-neutral-500'
                : 'text-neutral-400 hover:bg-neutral-100'
            }`}
            title={selectedObject.visible === false ? '表示' : '非表示'}
          >
            {selectedObject.visible === false ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Position */}
      <div>
        <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 mb-2">
          <Move className="w-3.5 h-3.5" />
          位置
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-neutral-400">X</label>
            <input
              type="number"
              value={Math.round(localValues.x || 0)}
              onChange={(e) => handleChange('x', parseFloat(e.target.value))}
              onBlur={() => handleBlur('x')}
              className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400">Y</label>
            <input
              type="number"
              value={Math.round(localValues.y || 0)}
              onChange={(e) => handleChange('y', parseFloat(e.target.value))}
              onBlur={() => handleBlur('y')}
              className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>
      </div>

      {/* Size */}
      <div>
        <label className="text-xs font-medium text-neutral-500 mb-2 block">サイズ</label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-neutral-400">幅</label>
            <input
              type="number"
              value={Math.round(localValues.width || 0)}
              onChange={(e) => handleChange('width', parseFloat(e.target.value))}
              onBlur={() => handleBlur('width')}
              className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400">高さ</label>
            <input
              type="number"
              value={Math.round(localValues.height || 0)}
              onChange={(e) => handleChange('height', parseFloat(e.target.value))}
              onBlur={() => handleBlur('height')}
              className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>
      </div>

      {/* Rotation */}
      <div>
        <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 mb-2">
          <RotateCw className="w-3.5 h-3.5" />
          回転
        </label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max="360"
            value={localValues.rotation || 0}
            onChange={(e) => {
              handleChange('rotation', parseFloat(e.target.value));
              updateObject(selectedObject.id, { rotation: parseFloat(e.target.value) });
            }}
            className="flex-1"
          />
          <span className="text-sm text-neutral-600 w-12">
            {Math.round(localValues.rotation || 0)}°
          </span>
        </div>
      </div>

      {/* Opacity */}
      <div>
        <label className="text-xs font-medium text-neutral-500 mb-2 block">不透明度</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={localValues.opacity ?? 1}
            onChange={(e) => {
              handleChange('opacity', parseFloat(e.target.value));
              updateObject(selectedObject.id, { opacity: parseFloat(e.target.value) });
            }}
            className="flex-1"
          />
          <span className="text-sm text-neutral-600 w-12">
            {Math.round((localValues.opacity ?? 1) * 100)}%
          </span>
        </div>
      </div>

      {/* Text properties */}
      {selectedObject.type === 'text' && (
        <>
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 mb-2">
              <Type className="w-3.5 h-3.5" />
              テキスト
            </label>
            <textarea
              value={localValues.text || ''}
              onChange={(e) => handleChange('text', e.target.value)}
              onBlur={() => handleBlur('text')}
              className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
              rows={3}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-2 block">フォントサイズ</label>
            <input
              type="number"
              value={localValues.fontSize || 16}
              onChange={(e) => handleChange('fontSize', parseFloat(e.target.value))}
              onBlur={() => handleBlur('fontSize')}
              className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </>
      )}

      {/* Color */}
      {(selectedObject.type === 'shape' || selectedObject.type === 'text') && (
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 mb-2">
            <Palette className="w-3.5 h-3.5" />
            色
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={localValues.fill || '#e5e5e5'}
              onChange={(e) => {
                handleChange('fill', e.target.value);
                updateObject(selectedObject.id, { fill: e.target.value });
              }}
              className="w-8 h-8 rounded cursor-pointer"
            />
            <input
              type="text"
              value={localValues.fill || '#e5e5e5'}
              onChange={(e) => handleChange('fill', e.target.value)}
              onBlur={() => handleBlur('fill')}
              className="flex-1 px-2 py-1.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>
      )}

      {/* Delete button */}
      <div className="pt-4 border-t border-neutral-100">
        <button
          onClick={() => deleteObject(selectedObject.id)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          オブジェクトを削除
        </button>
      </div>
    </div>
  );
}

