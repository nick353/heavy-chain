import { useState, useEffect } from 'react';
import { Tag, Plus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';

interface TagItem {
  id: string;
  name: string;
  color?: string;
}

interface TagManagerProps {
  imageId?: string;
  selectedTags: string[];
  onTagsChange: (tagIds: string[]) => void;
  compact?: boolean;
}

const TAG_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', 
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
];

export function TagManager({ imageId, selectedTags, onTagsChange, compact = false }: TagManagerProps) {
  const { currentBrand } = useAuthStore();
  const [tags, setTags] = useState<TagItem[]>([]);
  const [showInput, setShowInput] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  useEffect(() => {
    if (currentBrand) {
      fetchTags();
    }
  }, [currentBrand]);

  const fetchTags = async () => {
    if (!currentBrand) return;

    try {
      const { data, error } = await supabase
        .from('tags')
        .select('*')
        .eq('brand_id', currentBrand.id)
        .order('name');

      if (error) throw error;
      setTags(data || []);
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    }
  };

  const handleCreateTag = async () => {
    if (!currentBrand || !newTagName.trim()) return;

    // Check if tag already exists
    if (tags.some(t => t.name.toLowerCase() === newTagName.trim().toLowerCase())) {
      toast.error('同じ名前のタグが既に存在します');
      return;
    }

    try {
      const randomColor = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
      
      const { data, error } = await supabase
        .from('tags')
        .insert({
          brand_id: currentBrand.id,
          name: newTagName.trim(),
        })
        .select()
        .single();

      if (error) throw error;

      setTags([...tags, { ...data, color: randomColor }]);
      setNewTagName('');
      setShowInput(false);

      // Auto-select the new tag
      onTagsChange([...selectedTags, data.id]);
      toast.success('タグを作成しました');
    } catch (error) {
      toast.error('タグの作成に失敗しました');
    }
  };

  const handleToggleTag = async (tagId: string) => {
    const isSelected = selectedTags.includes(tagId);
    const newSelectedTags = isSelected
      ? selectedTags.filter(id => id !== tagId)
      : [...selectedTags, tagId];

    onTagsChange(newSelectedTags);

    // If imageId is provided, update the database
    if (imageId) {
      try {
        if (isSelected) {
          await supabase
            .from('image_tags')
            .delete()
            .eq('image_id', imageId)
            .eq('tag_id', tagId);
        } else {
          await supabase
            .from('image_tags')
            .insert({
              image_id: imageId,
              tag_id: tagId,
            });
        }
      } catch (error) {
        console.error('Failed to update image tags:', error);
        // Revert on error
        onTagsChange(selectedTags);
      }
    }
  };

  const handleDeleteTag = async (tagId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('このタグを削除しますか？すべての画像からこのタグが外れます。')) return;

    try {
      const { error } = await supabase
        .from('tags')
        .delete()
        .eq('id', tagId);

      if (error) throw error;

      setTags(tags.filter(t => t.id !== tagId));
      onTagsChange(selectedTags.filter(id => id !== tagId));
      toast.success('タグを削除しました');
    } catch (error) {
      toast.error('タグの削除に失敗しました');
    }
  };

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag, index) => {
          const isSelected = selectedTags.includes(tag.id);
          const color = TAG_COLORS[index % TAG_COLORS.length];
          
          return (
            <button
              key={tag.id}
              onClick={() => handleToggleTag(tag.id)}
              className={`
                inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all
                ${isSelected
                  ? 'text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }
              `}
              style={isSelected ? { backgroundColor: color } : undefined}
            >
              {tag.name}
            </button>
          );
        })}
        
        {showInput ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateTag();
                if (e.key === 'Escape') {
                  setShowInput(false);
                  setNewTagName('');
                }
              }}
              placeholder="新しいタグ"
              className="w-20 px-2 py-0.5 text-xs border border-neutral-200 rounded-full focus:outline-none focus:ring-1 focus:ring-primary-500"
              autoFocus
            />
            <button
              onClick={handleCreateTag}
              className="p-0.5 text-primary-600"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-neutral-400 border border-dashed border-neutral-300 hover:border-neutral-400 hover:text-neutral-500"
          >
            <Plus className="w-3 h-3" />
            タグを追加
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-neutral-500" />
          <h3 className="text-sm font-medium text-neutral-600">タグ</h3>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tags.map((tag, index) => {
          const isSelected = selectedTags.includes(tag.id);
          const color = TAG_COLORS[index % TAG_COLORS.length];
          
          return (
            <button
              key={tag.id}
              onClick={() => handleToggleTag(tag.id)}
              className={`
                group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all
                ${isSelected
                  ? 'text-white shadow-md'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }
              `}
              style={isSelected ? { backgroundColor: color } : undefined}
            >
              {tag.name}
              <button
                onClick={(e) => handleDeleteTag(tag.id, e)}
                className={`
                  p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity
                  ${isSelected ? 'hover:bg-white/20' : 'hover:bg-neutral-300'}
                `}
              >
                <X className="w-3 h-3" />
              </button>
            </button>
          );
        })}
        
        {showInput ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateTag();
                if (e.key === 'Escape') {
                  setShowInput(false);
                  setNewTagName('');
                }
              }}
              placeholder="新しいタグ名"
              className="w-32 px-3 py-1.5 text-sm border border-neutral-200 rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
            <button
              onClick={handleCreateTag}
              className="p-1.5 bg-primary-500 text-white rounded-full hover:bg-primary-600"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setShowInput(false);
                setNewTagName('');
              }}
              className="p-1.5 text-neutral-400 hover:text-neutral-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm text-neutral-400 border-2 border-dashed border-neutral-200 hover:border-neutral-300 hover:text-neutral-500 transition-colors"
          >
            <Plus className="w-4 h-4" />
            新規タグ
          </button>
        )}
      </div>
    </div>
  );
}

