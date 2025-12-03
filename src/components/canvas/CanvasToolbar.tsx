import { 
  ZoomIn, 
  ZoomOut, 
  Grid3X3, 
  Magnet,
  Type,
  Square,
  Circle,
  Frame,
  Undo2,
  Redo2,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  ArrowUpToLine,
  ArrowDownToLine,
  Download
} from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore';

interface CanvasToolbarProps {
  onAddText?: () => void;
  onAddShape?: (type: 'rect' | 'circle') => void;
  onAddFrame?: () => void;
  onExport?: () => void;
}

export function CanvasToolbar({ 
  onAddText, 
  onAddShape, 
  onAddFrame,
  onExport 
}: CanvasToolbarProps) {
  const {
    zoom,
    gridVisible,
    snapToGrid,
    selectedIds,
    historyIndex,
    history,
    setZoom,
    toggleGrid,
    toggleSnap,
    deleteSelected,
    duplicateSelected,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    undo,
    redo,
  } = useCanvasStore();

  const hasSelection = selectedIds.length > 0;
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const zoomIn = () => setZoom(zoom * 1.2);
  const zoomOut = () => setZoom(zoom / 1.2);
  const resetZoom = () => setZoom(1);

  const ToolButton = ({ 
    onClick, 
    active, 
    disabled, 
    children, 
    title 
  }: { 
    onClick: () => void; 
    active?: boolean; 
    disabled?: boolean;
    children: React.ReactNode;
    title: string;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        p-2 rounded-lg transition-all
        ${active 
          ? 'bg-primary-100 text-primary-700' 
          : 'text-neutral-600 hover:bg-neutral-100'
        }
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
      `}
    >
      {children}
    </button>
  );

  const Divider = () => (
    <div className="w-px h-6 bg-neutral-200 mx-1" />
  );

  return (
    <div className="flex items-center gap-1 p-2 bg-white rounded-xl shadow-soft border border-neutral-100">
      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <ToolButton onClick={zoomOut} title="ズームアウト">
          <ZoomOut className="w-4 h-4" />
        </ToolButton>
        <button
          onClick={resetZoom}
          className="px-2 py-1 text-sm font-medium text-neutral-600 hover:bg-neutral-100 rounded min-w-[60px]"
          title="ズームをリセット"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolButton onClick={zoomIn} title="ズームイン">
          <ZoomIn className="w-4 h-4" />
        </ToolButton>
      </div>

      <Divider />

      {/* Grid controls */}
      <ToolButton onClick={toggleGrid} active={gridVisible} title="グリッド表示">
        <Grid3X3 className="w-4 h-4" />
      </ToolButton>
      <ToolButton onClick={toggleSnap} active={snapToGrid} title="スナップ">
        <Magnet className="w-4 h-4" />
      </ToolButton>

      <Divider />

      {/* Add tools */}
      <ToolButton onClick={() => onAddText?.()} title="テキストを追加">
        <Type className="w-4 h-4" />
      </ToolButton>
      <ToolButton onClick={() => onAddShape?.('rect')} title="四角形を追加">
        <Square className="w-4 h-4" />
      </ToolButton>
      <ToolButton onClick={() => onAddShape?.('circle')} title="円を追加">
        <Circle className="w-4 h-4" />
      </ToolButton>
      <ToolButton onClick={() => onAddFrame?.()} title="フレームを追加">
        <Frame className="w-4 h-4" />
      </ToolButton>

      <Divider />

      {/* History */}
      <ToolButton onClick={undo} disabled={!canUndo} title="元に戻す (Ctrl+Z)">
        <Undo2 className="w-4 h-4" />
      </ToolButton>
      <ToolButton onClick={redo} disabled={!canRedo} title="やり直し (Ctrl+Shift+Z)">
        <Redo2 className="w-4 h-4" />
      </ToolButton>

      <Divider />

      {/* Selection actions */}
      <ToolButton 
        onClick={duplicateSelected} 
        disabled={!hasSelection} 
        title="複製 (Ctrl+D)"
      >
        <Copy className="w-4 h-4" />
      </ToolButton>
      <ToolButton 
        onClick={deleteSelected} 
        disabled={!hasSelection} 
        title="削除 (Delete)"
      >
        <Trash2 className="w-4 h-4" />
      </ToolButton>

      <Divider />

      {/* Layer controls */}
      <ToolButton 
        onClick={() => selectedIds[0] && bringToFront(selectedIds[0])} 
        disabled={!hasSelection}
        title="最前面へ"
      >
        <ArrowUpToLine className="w-4 h-4" />
      </ToolButton>
      <ToolButton 
        onClick={() => selectedIds[0] && bringForward(selectedIds[0])} 
        disabled={!hasSelection}
        title="前面へ"
      >
        <ChevronUp className="w-4 h-4" />
      </ToolButton>
      <ToolButton 
        onClick={() => selectedIds[0] && sendBackward(selectedIds[0])} 
        disabled={!hasSelection}
        title="背面へ"
      >
        <ChevronDown className="w-4 h-4" />
      </ToolButton>
      <ToolButton 
        onClick={() => selectedIds[0] && sendToBack(selectedIds[0])} 
        disabled={!hasSelection}
        title="最背面へ"
      >
        <ArrowDownToLine className="w-4 h-4" />
      </ToolButton>

      <Divider />

      {/* Export */}
      <ToolButton onClick={() => onExport?.()} title="エクスポート">
        <Download className="w-4 h-4" />
      </ToolButton>
    </div>
  );
}

