import { useState, useEffect } from 'react';
import { 
  Folder, 
  FolderPlus, 
  ChevronRight, 
  ChevronDown,
  Edit2,
  Trash2,
  FolderOpen
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { Button, Input, Modal } from './ui';
import toast from 'react-hot-toast';

interface FolderItem {
  id: string;
  name: string;
  parent_folder_id: string | null;
  children?: FolderItem[];
  imageCount?: number;
}

interface FolderManagerProps {
  onSelectFolder: (folderId: string | null) => void;
  selectedFolderId: string | null;
}

export function FolderManager({ onSelectFolder, selectedFolderId }: FolderManagerProps) {
  const { currentBrand } = useAuthStore();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [parentFolderId, setParentFolderId] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<FolderItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (currentBrand) {
      fetchFolders();
    }
  }, [currentBrand]);

  const fetchFolders = async () => {
    if (!currentBrand) return;

    try {
      const { data, error } = await supabase
        .from('folders')
        .select('*')
        .eq('brand_id', currentBrand.id)
        .order('name');

      if (error) throw error;

      // Build folder tree
      const folderMap = new Map<string, FolderItem>();
      const rootFolders: FolderItem[] = [];

      data?.forEach((folder: any) => {
        folderMap.set(folder.id, { ...folder, children: [] });
      });

      data?.forEach((folder: any) => {
        const folderItem = folderMap.get(folder.id)!;
        if (folder.parent_folder_id) {
          const parent = folderMap.get(folder.parent_folder_id);
          if (parent) {
            parent.children = parent.children || [];
            parent.children.push(folderItem);
          }
        } else {
          rootFolders.push(folderItem);
        }
      });

      setFolders(rootFolders);
    } catch (error) {
      console.error('Failed to fetch folders:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!currentBrand || !newFolderName.trim()) return;

    try {
      const { error } = await supabase
        .from('folders')
        .insert({
          brand_id: currentBrand.id,
          name: newFolderName.trim(),
          parent_folder_id: parentFolderId,
        })
        .select()
        .single();

      if (error) throw error;

      await fetchFolders();
      setShowCreateModal(false);
      setNewFolderName('');
      setParentFolderId(null);
      toast.success('フォルダを作成しました');
    } catch (error) {
      toast.error('フォルダの作成に失敗しました');
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm('このフォルダを削除しますか？中の画像はフォルダから外れます。')) return;

    try {
      const { error } = await supabase
        .from('folders')
        .delete()
        .eq('id', folderId);

      if (error) throw error;

      await fetchFolders();
      if (selectedFolderId === folderId) {
        onSelectFolder(null);
      }
      toast.success('フォルダを削除しました');
    } catch (error) {
      toast.error('フォルダの削除に失敗しました');
    }
  };

  const handleRenameFolder = async () => {
    if (!editingFolder || !newFolderName.trim()) return;

    try {
      const { error } = await supabase
        .from('folders')
        .update({ name: newFolderName.trim() })
        .eq('id', editingFolder.id);

      if (error) throw error;

      await fetchFolders();
      setEditingFolder(null);
      setNewFolderName('');
      toast.success('フォルダ名を変更しました');
    } catch (error) {
      toast.error('フォルダ名の変更に失敗しました');
    }
  };

  const toggleExpand = (folderId: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  const renderFolder = (folder: FolderItem, depth = 0) => {
    const isExpanded = expandedFolders.has(folder.id);
    const isSelected = selectedFolderId === folder.id;
    const hasChildren = folder.children && folder.children.length > 0;

    return (
      <div key={folder.id}>
        <div
          className={`
            flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer group
            ${isSelected ? 'bg-primary-100 text-primary-700' : 'hover:bg-neutral-100'}
          `}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => onSelectFolder(folder.id)}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(folder.id);
              }}
              className="p-0.5"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-neutral-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-neutral-400" />
              )}
            </button>
          ) : (
            <span className="w-5" />
          )}
          
          {isSelected ? (
            <FolderOpen className="w-4 h-4 text-primary-600" />
          ) : (
            <Folder className="w-4 h-4 text-neutral-400" />
          )}
          
          <span className="flex-1 text-sm truncate">{folder.name}</span>
          
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingFolder(folder);
                setNewFolderName(folder.name);
              }}
              className="p-1 hover:bg-neutral-200 rounded"
            >
              <Edit2 className="w-3 h-3 text-neutral-500" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteFolder(folder.id);
              }}
              className="p-1 hover:bg-red-100 rounded"
            >
              <Trash2 className="w-3 h-3 text-red-500" />
            </button>
          </div>
        </div>
        
        {isExpanded && hasChildren && (
          <div>
            {folder.children!.map((child) => renderFolder(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-sm font-medium text-neutral-600">フォルダ</h3>
        <button
          onClick={() => setShowCreateModal(true)}
          className="p-1 hover:bg-neutral-100 rounded"
          title="新規フォルダ"
        >
          <FolderPlus className="w-4 h-4 text-neutral-500" />
        </button>
      </div>

      {/* All images option */}
      <div
        className={`
          flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer
          ${selectedFolderId === null ? 'bg-primary-100 text-primary-700' : 'hover:bg-neutral-100'}
        `}
        onClick={() => onSelectFolder(null)}
      >
        <span className="w-5" />
        <Folder className={`w-4 h-4 ${selectedFolderId === null ? 'text-primary-600' : 'text-neutral-400'}`} />
        <span className="text-sm">すべての画像</span>
      </div>

      {/* Folder list */}
      {folders.map((folder) => renderFolder(folder))}

      {isLoading && (
        <div className="flex justify-center py-4">
          <div className="spinner w-5 h-5" />
        </div>
      )}

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setNewFolderName('');
          setParentFolderId(null);
        }}
        title="新規フォルダ"
        size="sm"
      >
        <div className="space-y-4">
          <Input
            label="フォルダ名"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="フォルダ名を入力"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreateModal(false)}>
              キャンセル
            </Button>
            <Button onClick={handleCreateFolder}>
              作成
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={!!editingFolder}
        onClose={() => {
          setEditingFolder(null);
          setNewFolderName('');
        }}
        title="フォルダ名を変更"
        size="sm"
      >
        <div className="space-y-4">
          <Input
            label="フォルダ名"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="フォルダ名を入力"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditingFolder(null)}>
              キャンセル
            </Button>
            <Button onClick={handleRenameFolder}>
              変更
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

