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
  Download,
  MoreHorizontal
} from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore';
import { useState } from 'react';

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
  const [showMoreTools, setShowMoreTools] = useState(false);
  
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
    title,
    className = ''
  }: { 
    onClick: () => void; 
    active?: boolean; 
    disabled?: boolean;
    children: React.ReactNode;
    title: string;
    className?: string;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        p-1.5 sm:p-2 rounded-md sm:rounded-lg transition-all touch-manipulation
        ${active 
          ? 'bg-primary-100 text-primary-700' 
          : 'text-neutral-600 hover:bg-neutral-100 active:bg-neutral-200'
        }
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
        ${className}
      `}
    >
      {children}
    </button>
  );

  const Divider = () => (
    <div className="hidden sm:block w-px h-5 sm:h-6 bg-neutral-200 mx-0.5 sm:mx-1" />
  );

  return (
    <div className="relative">
      {/* Main toolbar */}
      <div className="flex items-center gap-0.5 sm:gap-1 p-1 sm:p-2 bg-white rounded-lg sm:rounded-xl shadow-soft border border-neutral-100">
        {/* Zoom controls - always visible */}
        <div className="flex items-center">
          <ToolButton onClick={zoomOut} title="ズームアウト">
            <ZoomOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </ToolButton>
          <button
            onClick={resetZoom}
            className="px-1.5 sm:px-2 py-0.5 sm:py-1 text-xs sm:text-sm font-medium text-neutral-600 hover:bg-neutral-100 rounded min-w-[40px] sm:min-w-[60px] touch-manipulation"
            title="ズームをリセット"
          >
            {Math.round(zoom * 100)}%
          </button>
          <ToolButton onClick={zoomIn} title="ズームイン">
            <ZoomIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </ToolButton>
        </div>

        <Divider />

        {/* Grid controls - visible on sm+ */}
        <div className="hidden sm:flex items-center">
          <ToolButton onClick={toggleGrid} active={gridVisible} title="グリッド表示">
            <Grid3X3 className="w-4 h-4" />
          </ToolButton>
          <ToolButton onClick={toggleSnap} active={snapToGrid} title="スナップ">
            <Magnet className="w-4 h-4" />
          </ToolButton>
          <Divider />
        </div>

        {/* Add tools - compact on mobile */}
        <ToolButton onClick={() => onAddText?.()} title="テキストを追加">
          <Type className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </ToolButton>
        <ToolButton onClick={() => onAddShape?.('rect')} title="四角形を追加">
          <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </ToolButton>
        
        {/* Hidden on mobile */}
        <div className="hidden sm:flex items-center">
          <ToolButton onClick={() => onAddShape?.('circle')} title="円を追加">
            <Circle className="w-4 h-4" />
          </ToolButton>
          <ToolButton onClick={() => onAddFrame?.()} title="フレームを追加">
            <Frame className="w-4 h-4" />
          </ToolButton>
        </div>

        <Divider />

        {/* History - always visible */}
        <ToolButton onClick={undo} disabled={!canUndo} title="元に戻す (Ctrl+Z)">
          <Undo2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </ToolButton>
        <ToolButton onClick={redo} disabled={!canRedo} title="やり直し (Ctrl+Shift+Z)">
          <Redo2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </ToolButton>

        {/* Selection actions - hidden on mobile */}
        <div className="hidden sm:flex items-center">
          <Divider />
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
        </div>

        {/* Layer controls - hidden on mobile */}
        <div className="hidden lg:flex items-center">
          <Divider />
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
        </div>

        {/* Export - hidden on mobile */}
        <div className="hidden sm:flex items-center">
          <Divider />
          <ToolButton onClick={() => onExport?.()} title="エクスポート">
            <Download className="w-4 h-4" />
          </ToolButton>
        </div>

        {/* More button - visible only on mobile */}
        <div className="sm:hidden">
          <ToolButton 
            onClick={() => setShowMoreTools(!showMoreTools)} 
            active={showMoreTools}
            title="その他のツール"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </ToolButton>
        </div>
      </div>

      {/* Mobile expanded menu */}
      {showMoreTools && (
        <div className="sm:hidden absolute top-full left-0 right-0 mt-1 p-2 bg-white rounded-lg shadow-lg border border-neutral-100 z-50">
          <div className="grid grid-cols-5 gap-1">
            <ToolButton onClick={toggleGrid} active={gridVisible} title="グリッド表示">
              <Grid3X3 className="w-4 h-4" />
            </ToolButton>
            <ToolButton onClick={toggleSnap} active={snapToGrid} title="スナップ">
              <Magnet className="w-4 h-4" />
            </ToolButton>
            <ToolButton onClick={() => onAddShape?.('circle')} title="円を追加">
              <Circle className="w-4 h-4" />
            </ToolButton>
            <ToolButton onClick={() => onAddFrame?.()} title="フレームを追加">
              <Frame className="w-4 h-4" />
            </ToolButton>
            <ToolButton onClick={() => onExport?.()} title="エクスポート">
              <Download className="w-4 h-4" />
            </ToolButton>
            <ToolButton 
              onClick={duplicateSelected} 
              disabled={!hasSelection} 
              title="複製"
            >
              <Copy className="w-4 h-4" />
            </ToolButton>
            <ToolButton 
              onClick={deleteSelected} 
              disabled={!hasSelection} 
              title="削除"
            >
              <Trash2 className="w-4 h-4" />
            </ToolButton>
            <ToolButton 
              onClick={() => selectedIds[0] && bringToFront(selectedIds[0])} 
              disabled={!hasSelection}
              title="最前面へ"
            >
              <ArrowUpToLine className="w-4 h-4" />
            </ToolButton>
            <ToolButton 
              onClick={() => selectedIds[0] && sendToBack(selectedIds[0])} 
              disabled={!hasSelection}
              title="最背面へ"
            >
              <ArrowDownToLine className="w-4 h-4" />
            </ToolButton>
          </div>
        </div>
      )}
    </div>
  );
}
