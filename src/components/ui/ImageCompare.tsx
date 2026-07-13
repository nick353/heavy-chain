import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2 } from 'lucide-react';
import clsx from 'clsx';

interface ImageCompareProps {
  images: Array<{
    url: string;
    label?: string;
    prompt?: string;
  }>;
  onClose?: () => void;
  className?: string;
}

export function ImageCompare({ images, onClose, className }: ImageCompareProps) {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0, 1]);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle fullscreen
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    
    if (isFullscreen) {
      await document.exitFullscreen();
    } else {
      await containerRef.current.requestFullscreen();
    }
  };

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => setZoom(1);

  const toggleImageSelection = (index: number) => {
    if (selectedIndices.includes(index)) {
      if (selectedIndices.length > 1) {
        setSelectedIndices(prev => prev.filter(i => i !== index));
      }
    } else {
      if (selectedIndices.length >= 4) {
        // Max 4 images for comparison
        setSelectedIndices(prev => [...prev.slice(1), index]);
      } else {
        setSelectedIndices(prev => [...prev, index]);
      }
    }
  };

  const selectedImages = selectedIndices.map(i => images[i]).filter(Boolean);
  const gridCols = selectedImages.length === 1 ? 1 : selectedImages.length === 2 ? 2 : selectedImages.length <= 4 ? 2 : 3;

  return (
    <div
      ref={containerRef}
      className={clsx(
        'fixed inset-0 z-50 bg-black flex flex-col',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50 backdrop-blur-sm border-b border-white/10">
        <h3 className="text-white font-medium">
          画像比較 ({selectedImages.length}枚選択中)
        </h3>
        
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-1">
            <button
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded disabled:opacity-30"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-white/70 text-xs w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= 3}
              className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded disabled:opacity-30"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetZoom}
              className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg"
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>

          {/* Close */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Main comparison area */}
      <div className="flex-1 overflow-hidden p-4">
        <div
          className={clsx(
            'grid gap-4 h-full',
            gridCols === 1 && 'grid-cols-1',
            gridCols === 2 && 'grid-cols-2',
            gridCols === 3 && 'grid-cols-3'
          )}
        >
          {selectedImages.map((image, i) => (
            <motion.div
              key={selectedIndices[i]}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative overflow-auto rounded-xl bg-neutral-900"
            >
              <div
                className="min-h-full flex items-center justify-center p-2"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'center center',
                }}
              >
                <img
                  src={image.url}
                  alt={image.prompt || `比較画像 ${i + 1}`}
                  className="max-w-full max-h-full object-contain rounded-lg"
                />
              </div>
              
              {/* Label overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                {image.label && (
                  <p className="text-white text-sm font-medium">{image.label}</p>
                )}
                {image.prompt && (
                  <p className="text-white/70 text-xs truncate">{image.prompt}</p>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Thumbnail strip */}
      {images.length > 2 && (
        <div className="px-4 py-3 bg-black/50 backdrop-blur-sm border-t border-white/10">
          <div className="flex gap-2 overflow-x-auto">
            {images.map((image, index) => (
              <button
                key={index}
                onClick={() => toggleImageSelection(index)}
                className={clsx(
                  'flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all',
                  selectedIndices.includes(index)
                    ? 'border-primary-500 ring-2 ring-primary-500/50'
                    : 'border-white/20 hover:border-white/40'
                )}
              >
                <img
                  src={image.url}
                  alt={image.prompt || `サムネイル ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
          <p className="text-white/50 text-xs mt-2">
            クリックで選択/解除（最大4枚まで比較可能）
          </p>
        </div>
      )}
    </div>
  );
}

