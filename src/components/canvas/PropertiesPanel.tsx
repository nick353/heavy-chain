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
  Trash2,
  Layers3,
  Scissors,
  ScanLine
} from 'lucide-react';
import { useCanvasStore, type CanvasObject } from '../../stores/canvasStore';

interface PropertiesPanelProps {
  selectedObject: CanvasObject | null;
}

function normalizeMaterialWorkflowParameters(parameters: any) {
  const workbenchState = parameters?.lightchainWorkbenchState ?? parameters?.garmentReferenceState ?? null;
  const materialReference = Array.isArray(parameters?.materialReferences)
    ? parameters.materialReferences.find((item: any) => item?.hasImage || item?.materialKind)
    : parameters?.materialReference ?? parameters?.materialReferences ?? null;

  if (!workbenchState) {
    return {
      materialReference,
      layerPlan: parameters?.layerPlan ?? null,
      maskPlan: parameters?.maskPlan ?? null,
      compositionPreview: parameters?.compositionPreview ?? null,
    };
  }

  const normalizedMaterialReference = materialReference ?? {
    hasImage: Boolean(workbenchState.hasImage),
    fileName: workbenchState.garmentFileName ?? null,
    materialKind: workbenchState.materialKind,
    maskMode: workbenchState.cutMode,
    activeLayer: workbenchState.activeLayer,
    placement: workbenchState.printPlacement,
    scale: workbenchState.printScale,
    note: workbenchState.referenceNote,
  };

  return {
    materialReference: normalizedMaterialReference,
    layerPlan: parameters?.layerPlan ?? {
      activeLayer: workbenchState.activeLayer,
      placement: workbenchState.printPlacement,
      scale: workbenchState.printScale,
      objectRole: 'design-overlay',
    },
    maskPlan: parameters?.maskPlan ?? {
      mode: workbenchState.cutMode,
      maskMode: workbenchState.cutMode,
      source: workbenchState.hasImage ? 'uploaded-garment' : 'brief-only',
    },
    compositionPreview: parameters?.compositionPreview ?? {
      summary: `${workbenchState.materialKind ?? '素材'} / ${workbenchState.activeLayer ?? 'レイヤー'} / ${workbenchState.printPlacement ?? '配置'}`,
      status: 'Canvas保存済み',
    },
  };
}

export function PropertiesPanel({ selectedObject }: PropertiesPanelProps) {
  const { updateObject, deleteObject, saveToHistory } = useCanvasStore();
  const [localValues, setLocalValues] = useState<Partial<CanvasObject>>({});
  const lightchainEditStages = selectedObject?.metadata?.lightchainEditStages ?? [];
  const parameters = selectedObject?.metadata?.parameters ?? {};
  const { materialReference, layerPlan, maskPlan, compositionPreview } = normalizeMaterialWorkflowParameters(parameters);
  const sourceLabel = parameters.source ?? selectedObject?.metadata?.feature ?? null;

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

      {(sourceLabel || materialReference || layerPlan || maskPlan || compositionPreview) && (
        <div className="pt-4 border-t border-neutral-100">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 mb-3">
            <Layers3 className="w-3.5 h-3.5" />
            素材・レイヤー情報
          </h4>
          <div className="space-y-2">
            {sourceLabel && (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-neutral-400">生成元</p>
                <p className="mt-1 truncate text-sm font-semibold text-neutral-800">{String(sourceLabel)}</p>
              </div>
            )}
            {materialReference && (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-400">
                  <ScanLine className="w-3 h-3" />
                  認識素材
                </p>
                <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-neutral-600">
                  <span className="truncate">種類: {String(materialReference.materialKind ?? '未設定')}</span>
                  <span className="truncate">配置: {String(materialReference.placement ?? layerPlan?.placement ?? '未設定')}</span>
                  <span className="truncate">層: {String(materialReference.activeLayer ?? layerPlan?.activeLayer ?? '未設定')}</span>
                  <span className="truncate">サイズ: {String(materialReference.scale ?? layerPlan?.scale ?? '未設定')}%</span>
                </div>
                {materialReference.note && (
                  <p className="mt-2 line-clamp-2 text-xs text-neutral-500">{String(materialReference.note)}</p>
                )}
              </div>
            )}
            {(layerPlan || maskPlan || compositionPreview) && (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-400">
                  <Scissors className="w-3 h-3" />
                  編集設計
                </p>
                <div className="mt-1 space-y-1 text-xs text-neutral-600">
                  {layerPlan && (
                    <p className="truncate">
                      レイヤー: {String(layerPlan.activeLayer ?? layerPlan.layer ?? '未設定')} / {String(layerPlan.placement ?? '配置未設定')}
                    </p>
                  )}
                  {maskPlan && (
                    <p className="truncate">
                      カット: {String(maskPlan.maskMode ?? maskPlan.mode ?? '未設定')}
                    </p>
                  )}
                  {compositionPreview && (
                    <p className="truncate">
                      プレビュー: {String(compositionPreview.summary ?? compositionPreview.label ?? compositionPreview.status ?? '保存済み')}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedObject.type === 'image' && lightchainEditStages.length > 0 && (
        <div className="pt-4 border-t border-neutral-100">
          <h4 className="text-xs font-semibold text-neutral-500 mb-2">素材編集履歴</h4>
          <div className="space-y-2">
            {lightchainEditStages.map((stage) => (
              <div
                key={stage.stageId}
                className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-neutral-800">{stage.label}</span>
                  <span className="text-[11px] text-emerald-700">完了</span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  Step {stage.stepIndex + 1}: {stage.action}
                </p>
              </div>
            ))}
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
