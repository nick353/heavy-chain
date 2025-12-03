import { useState, useRef } from 'react';
import { 
  Upload, 
  X, 
  Check, 
  Image as ImageIcon,
  FolderOpen,
  Sparkles,
  Layout,
  Palette,
  Layers
} from 'lucide-react';
import { Modal } from './ui';
import { GallerySelector } from './GallerySelector';

export type ReferenceType = 'style' | 'composition' | 'base' | 'pattern';

interface ReferenceTypeOption {
  id: ReferenceType;
  name: string;
  description: string;
  icon: any;
}

const REFERENCE_TYPES: ReferenceTypeOption[] = [
  { id: 'style', name: 'スタイル参考', description: '色味や雰囲気を参考に', icon: Palette },
  { id: 'composition', name: '構図参考', description: 'レイアウトや構成を参考に', icon: Layout },
  { id: 'base', name: 'ベース画像', description: 'この画像を元に生成', icon: Layers },
  { id: 'pattern', name: 'パターン参考', description: '柄やテクスチャを参考に', icon: Sparkles },
];

export interface SelectedImage {
  url: string;
  file?: File;
  referenceType: ReferenceType;
  fromGallery?: boolean;
  galleryImageId?: string;
}

interface ImageSelectorProps {
  label?: string;
  required?: boolean;
  value?: SelectedImage | null;
  onChange: (image: SelectedImage | null) => void;
  allowedReferenceTypes?: ReferenceType[];
  defaultReferenceType?: ReferenceType;
  hint?: string;
  multiple?: boolean;
  maxImages?: number;
  multipleValue?: SelectedImage[];
  onMultipleChange?: (images: SelectedImage[]) => void;
}

export function ImageSelector({
  label = '画像を選択',
  required = false,
  value,
  onChange,
  allowedReferenceTypes = ['style', 'composition', 'base'],
  defaultReferenceType = 'style',
  hint,
  multiple = false,
  maxImages = 5,
  multipleValue = [],
  onMultipleChange,
}: ImageSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showGalleryModal, setShowGalleryModal] = useState(false);
  const [selectedReferenceType, setSelectedReferenceType] = useState<ReferenceType>(defaultReferenceType);

  const availableTypes = REFERENCE_TYPES.filter(t => allowedReferenceTypes.includes(t.id));

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      if (multiple && onMultipleChange) {
        const newImages: SelectedImage[] = [];
        Array.from(files).slice(0, maxImages - multipleValue.length).forEach(file => {
          if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              newImages.push({
                url: ev.target?.result as string,
                file,
                referenceType: selectedReferenceType,
              });
              if (newImages.length === Math.min(files.length, maxImages - multipleValue.length)) {
                onMultipleChange([...multipleValue, ...newImages]);
              }
            };
            reader.readAsDataURL(file);
          }
        });
      } else {
        processFile(files[0]);
      }
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      onChange({
        url: e.target?.result as string,
        file,
        referenceType: selectedReferenceType,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      if (multiple && onMultipleChange) {
        // Handle multiple files
        const newImages: SelectedImage[] = [];
        Array.from(files).slice(0, maxImages - multipleValue.length).forEach(file => {
          if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              newImages.push({
                url: ev.target?.result as string,
                file,
                referenceType: selectedReferenceType,
              });
              if (newImages.length === Math.min(files.length, maxImages - multipleValue.length)) {
                onMultipleChange([...multipleValue, ...newImages]);
              }
            };
            reader.readAsDataURL(file);
          }
        });
      } else {
        processFile(files[0]);
      }
    }
  };

  const handleGallerySelect = (imageUrl: string, imageId: string) => {
    if (multiple && onMultipleChange) {
      if (multipleValue.length < maxImages) {
        onMultipleChange([...multipleValue, {
          url: imageUrl,
          referenceType: selectedReferenceType,
          fromGallery: true,
          galleryImageId: imageId,
        }]);
      }
    } else {
      onChange({
        url: imageUrl,
        referenceType: selectedReferenceType,
        fromGallery: true,
        galleryImageId: imageId,
      });
    }
    setShowGalleryModal(false);
  };

  const removeImage = () => {
    onChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeMultipleImage = (index: number) => {
    if (onMultipleChange) {
      onMultipleChange(multipleValue.filter((_, i) => i !== index));
    }
  };

  // Multiple images view
  if (multiple) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {label} {required && <span className="text-red-500">*</span>}
          </label>
          <span className="text-xs text-neutral-500">
            {multipleValue.length}/{maxImages}枚
          </span>
        </div>

        {/* Reference type selector */}
        {availableTypes.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {availableTypes.map(type => (
              <button
                key={type.id}
                onClick={() => setSelectedReferenceType(type.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-all ${
                  selectedReferenceType === type.id
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'border-neutral-200 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300'
                }`}
              >
                <type.icon className="w-3 h-3" />
                {type.name}
              </button>
            ))}
          </div>
        )}

        {/* Image grid */}
        <div className="grid grid-cols-3 gap-2">
          {multipleValue.map((img, index) => (
            <div key={index} className="relative aspect-square rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800">
              <img src={img.url} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => removeMultipleImage(index)}
                className="absolute top-1 right-1 p-1 bg-black/50 rounded-full text-white hover:bg-black/70"
              >
                <X className="w-3 h-3" />
              </button>
              <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/50 rounded text-white text-[10px]">
                {REFERENCE_TYPES.find(t => t.id === img.referenceType)?.name}
              </div>
            </div>
          ))}

          {multipleValue.length < maxImages && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-neutral-300 dark:border-neutral-600 hover:border-primary-400'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 bg-neutral-100 dark:bg-neutral-700 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-600"
                >
                  <Upload className="w-4 h-4 text-neutral-500" />
                </button>
                <button
                  onClick={() => setShowGalleryModal(true)}
                  className="p-2 bg-neutral-100 dark:bg-neutral-700 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-600"
                >
                  <FolderOpen className="w-4 h-4 text-neutral-500" />
                </button>
              </div>
            </div>
          )}
        </div>

        {hint && <p className="text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}

        <GallerySelector
          isOpen={showGalleryModal}
          onClose={() => setShowGalleryModal(false)}
          onSelect={handleGallerySelect}
        />
      </div>
    );
  }

  // Single image view
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {!value ? (
        <div className="space-y-3">
          {/* Reference type selector */}
          {availableTypes.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {availableTypes.map(type => (
                <button
                  key={type.id}
                  onClick={() => setSelectedReferenceType(type.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-all ${
                    selectedReferenceType === type.id
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                      : 'border-neutral-200 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300'
                  }`}
                >
                  <type.icon className="w-3 h-3" />
                  {type.name}
                </button>
              ))}
            </div>
          )}

          {/* Upload area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
              isDragging
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-neutral-300 dark:border-neutral-600 hover:border-primary-400'
            }`}
          >
            <div className="flex justify-center gap-3 mb-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                <Upload className="w-4 h-4" />
                アップロード
              </button>
              <button
                onClick={() => setShowGalleryModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
                ギャラリーから
              </button>
            </div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              またはドラッグ&ドロップ（PNG, JPG, WebP / 最大10MB）
            </p>
          </div>
        </div>
      ) : (
        <div className="relative">
          <div className="rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800">
            <img
              src={value.url}
              alt="Selected"
              className="w-full max-h-48 object-contain"
            />
          </div>
          <button
            onClick={removeImage}
            className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-lg text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="absolute bottom-2 left-2 flex items-center gap-2">
            <span className="px-2 py-1 bg-green-500 text-white text-xs rounded-lg flex items-center gap-1">
              <Check className="w-3 h-3" />
              選択済み
            </span>
            <span className="px-2 py-1 bg-black/50 text-white text-xs rounded-lg">
              {REFERENCE_TYPES.find(t => t.id === value.referenceType)?.name}
            </span>
          </div>
        </div>
      )}

      {hint && <p className="text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}

      <GallerySelector
        isOpen={showGalleryModal}
        onClose={() => setShowGalleryModal(false)}
        onSelect={handleGallerySelect}
      />
    </div>
  );
}

