import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { Button, Input, Modal } from './ui';
import toast from 'react-hot-toast';

interface StylePreset {
  id: string;
  name: string;
  prompt_template: string;
  settings: {
    style?: string;
    aspectRatio?: string;
    negativePrompt?: string;
  };
}

interface StylePresetsProps {
  onSelect: (preset: StylePreset) => void;
  selectedPresetId?: string;
}

export function StylePresets({ onSelect, selectedPresetId }: StylePresetsProps) {
  const { currentBrand } = useAuthStore();
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPreset, setEditingPreset] = useState<StylePreset | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    promptTemplate: '',
    style: '',
    aspectRatio: '1:1',
    negativePrompt: ''
  });

  // Default presets
  const defaultPresets: StylePreset[] = [
    {
      id: 'default-minimal',
      name: 'ミニマル',
      prompt_template: '{prompt}, minimalist style, clean background, simple composition',
      settings: { style: 'minimal', aspectRatio: '1:1' }
    },
    {
      id: 'default-luxury',
      name: 'ラグジュアリー',
      prompt_template: '{prompt}, luxury fashion photography, high-end, elegant lighting',
      settings: { style: 'luxury', aspectRatio: '1:1' }
    },
    {
      id: 'default-street',
      name: 'ストリート',
      prompt_template: '{prompt}, street style, urban environment, dynamic pose',
      settings: { style: 'street', aspectRatio: '1:1' }
    },
    {
      id: 'default-vintage',
      name: 'ヴィンテージ',
      prompt_template: '{prompt}, vintage aesthetic, film grain, warm tones',
      settings: { style: 'vintage', aspectRatio: '1:1' }
    },
    {
      id: 'default-modern',
      name: 'モダン',
      prompt_template: '{prompt}, modern contemporary style, bold colors, geometric',
      settings: { style: 'modern', aspectRatio: '1:1' }
    },
    {
      id: 'default-natural',
      name: 'ナチュラル',
      prompt_template: '{prompt}, natural lighting, organic textures, earth tones',
      settings: { style: 'natural', aspectRatio: '1:1' }
    }
  ];

  useEffect(() => {
    if (currentBrand) {
      fetchPresets();
    }
  }, [currentBrand]);

  const fetchPresets = async () => {
    if (!currentBrand) return;
    
    try {
      const { data, error } = await supabase
        .from('style_presets')
        .select('*')
        .eq('brand_id', currentBrand.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPresets(data || []);
    } catch (error) {
      console.error('Failed to fetch presets:', error);
    }
  };

  const handleCreate = async () => {
    if (!currentBrand || !formData.name.trim()) return;

    try {
      const { data, error } = await supabase
        .from('style_presets')
        .insert({
          brand_id: currentBrand.id,
          name: formData.name,
          prompt_template: formData.promptTemplate || '{prompt}',
          settings: {
            style: formData.style,
            aspectRatio: formData.aspectRatio,
            negativePrompt: formData.negativePrompt
          }
        })
        .select()
        .single();

      if (error) throw error;

      setPresets([data, ...presets]);
      setShowCreateModal(false);
      resetForm();
      toast.success('プリセットを作成しました');
    } catch (error) {
      toast.error('プリセットの作成に失敗しました');
    }
  };

  const handleUpdate = async () => {
    if (!editingPreset) return;

    try {
      const { error } = await supabase
        .from('style_presets')
        .update({
          name: formData.name,
          prompt_template: formData.promptTemplate,
          settings: {
            style: formData.style,
            aspectRatio: formData.aspectRatio,
            negativePrompt: formData.negativePrompt
          }
        })
        .eq('id', editingPreset.id);

      if (error) throw error;

      setPresets(presets.map(p => 
        p.id === editingPreset.id 
          ? { ...p, name: formData.name, prompt_template: formData.promptTemplate, settings: { style: formData.style, aspectRatio: formData.aspectRatio, negativePrompt: formData.negativePrompt } }
          : p
      ));
      setEditingPreset(null);
      resetForm();
      toast.success('プリセットを更新しました');
    } catch (error) {
      toast.error('プリセットの更新に失敗しました');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このプリセットを削除しますか？')) return;

    try {
      const { error } = await supabase
        .from('style_presets')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setPresets(presets.filter(p => p.id !== id));
      toast.success('プリセットを削除しました');
    } catch (error) {
      toast.error('プリセットの削除に失敗しました');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      promptTemplate: '',
      style: '',
      aspectRatio: '1:1',
      negativePrompt: ''
    });
  };

  const startEdit = (preset: StylePreset) => {
    setEditingPreset(preset);
    setFormData({
      name: preset.name,
      promptTemplate: preset.prompt_template,
      style: preset.settings.style || '',
      aspectRatio: preset.settings.aspectRatio || '1:1',
      negativePrompt: preset.settings.negativePrompt || ''
    });
  };

  const allPresets = [...defaultPresets, ...presets];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-neutral-800">スタイルプリセット</h3>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={() => setShowCreateModal(true)}
        >
          新規作成
        </Button>
      </div>

      {/* Preset grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {allPresets.map((preset) => (
          <div
            key={preset.id}
            className={`
              relative group p-3 rounded-xl border-2 cursor-pointer transition-all
              ${selectedPresetId === preset.id
                ? 'border-primary-500 bg-primary-50'
                : 'border-neutral-200 hover:border-neutral-300'
              }
            `}
            onClick={() => onSelect(preset)}
          >
            <p className="font-medium text-sm text-neutral-800 mb-1">
              {preset.name}
            </p>
            <p className="text-xs text-neutral-500 line-clamp-2">
              {preset.prompt_template.replace('{prompt}', '...').substring(0, 50)}
            </p>

            {/* Actions for custom presets */}
            {!preset.id.startsWith('default-') && (
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(preset);
                  }}
                  className="p-1 bg-white rounded shadow-sm hover:bg-neutral-50"
                >
                  <Edit2 className="w-3 h-3 text-neutral-500" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(preset.id);
                  }}
                  className="p-1 bg-white rounded shadow-sm hover:bg-red-50"
                >
                  <Trash2 className="w-3 h-3 text-red-500" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showCreateModal || !!editingPreset}
        onClose={() => {
          setShowCreateModal(false);
          setEditingPreset(null);
          resetForm();
        }}
        title={editingPreset ? 'プリセットを編集' : '新規プリセット'}
      >
        <div className="space-y-4">
          <Input
            label="プリセット名"
            placeholder="例: 夏キャンペーン用"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              プロンプトテンプレート
            </label>
            <textarea
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={3}
              placeholder="{prompt} を含めると、入力プロンプトに置換されます"
              value={formData.promptTemplate}
              onChange={(e) => setFormData({ ...formData, promptTemplate: e.target.value })}
            />
            <p className="text-xs text-neutral-500 mt-1">
              例: {'{prompt}'}, minimalist style, white background
            </p>
          </div>

          <Input
            label="ネガティブプロンプト（任意）"
            placeholder="除外したい要素"
            value={formData.negativePrompt}
            onChange={(e) => setFormData({ ...formData, negativePrompt: e.target.value })}
          />

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setShowCreateModal(false);
                setEditingPreset(null);
                resetForm();
              }}
            >
              キャンセル
            </Button>
            <Button onClick={editingPreset ? handleUpdate : handleCreate}>
              {editingPreset ? '更新' : '作成'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

