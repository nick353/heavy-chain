import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildLocalCanvasAssetReference, hasLocalCanvasAsset } from '../lib/canvasLocalAssets';
import type {
  CanvasSourceIdentity,
  CanvasSourceReadback,
  CanvasSourceRevision,
} from '../features/canvasSourceMetadata';

export type {
  CanvasSourceIdentity,
  CanvasSourceMetadata,
  CanvasSourceReadback,
  CanvasSourceRevision,
} from '../features/canvasSourceMetadata';
export {
  buildLocalUploadSourceMetadata,
  sanitizeCanvasSourceMetadata,
  sha256Hex,
  sourceRevisionMatches,
} from '../features/canvasSourceMetadata';

export interface CanvasObject {
  id: string;
  type: 'image' | 'text' | 'shape' | 'frame';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
  zIndex: number;
  // Type-specific properties
  src?: string; // for image
  text?: string; // for text
  fontSize?: number;
  fontFamily?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  shapeType?: 'rect' | 'circle' | 'line' | 'arrow';
  // Parent relationship for derived images
  parentId?: string | null;
  derivedFrom?: string | null;
  // Label for display purposes
  label?: string;
  // Generation metadata
  metadata?: {
    feature: string;        // 使用した機能 ('generate', 'remove-bg', 'colorize'等)
    prompt?: string;        // プロンプト
    parentId?: string;      // 親画像のID
    generation: number;     // 世代数 (0=最初の生成, 1=1回派生...)
    parameters?: any;       // 使用したパラメータ
    parentObjectId?: string | null;
    maskApplied?: boolean;
    backendProvider?: string | null;
    provider?: string | null;
    status?: string | null;
    jobId?: string | null;
    imageId?: string | null;
    storagePath?: string | null;
    persistenceStatus?: string | null;
    lightchainCompat?: any;  // Heavy Chain互換の機能/タスク状態
    galleryStoragePath?: string;
    galleryImageId?: string;
    galleryImageUrl?: string;
    legalSafety?: {
      rightsConfirmed?: boolean;
    };
    /** Sanitized provenance for local uploads; never contains paths or bytes. */
    sourceIdentity?: CanvasSourceIdentity;
    sourceRevision?: CanvasSourceRevision;
    sourceReadback?: CanvasSourceReadback;
    lightchainEditStages?: Array<{
      stageId: string;
      action: string;
      label: string;
      status: 'completed' | 'retryable';
      sourceObjectId?: string;
      stepIndex: number;
      prompt?: string;
      parameters?: any;
      createdAt: string;
    }>;
    timestamp?: string;     // 生成日時
  };
}

export interface CanvasProject {
  id: string;
  name: string;
  objects: CanvasObject[];
  thumbnail?: string;
  createdAt: string;
  updatedAt: string;
  brandId?: string;
}

export interface CanvasState {
  // Current project
  currentProjectId: string | null;
  currentProjectName: string;
  
  // All projects
  projects: CanvasProject[];
  
  // Canvas properties
  zoom: number;
  panX: number;
  panY: number;
  gridVisible: boolean;
  snapToGrid: boolean;
  gridSize: number;
  
  // Objects
  objects: CanvasObject[];
  selectedIds: string[];
  
  // History
  history: CanvasObject[][];
  historyIndex: number;
  
  // Project actions
  createProject: (name: string, brandId?: string, initialObjects?: CanvasObject[]) => string;
  loadProject: (projectId: string) => void;
  saveCurrentProject: () => void;
  deleteProject: (projectId: string) => void;
  renameProject: (projectId: string, name: string) => void;
  updateProjectThumbnail: (projectId: string, thumbnail: string) => void;
  getRecentProjects: (limit?: number) => CanvasProject[];
  
  // Canvas actions
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  
  addObject: (object: Omit<CanvasObject, 'id' | 'zIndex'>) => string;
  updateObject: (id: string, updates: Partial<CanvasObject>) => void;
  deleteObject: (id: string) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  
  selectObject: (id: string, addToSelection?: boolean) => void;
  selectAll: () => void;
  deselectAll: () => void;
  
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  
  undo: () => void;
  redo: () => void;
  saveToHistory: () => void;
  
  clearCanvas: () => void;
  
  // Derived tree
  getDerivatives: (id: string) => CanvasObject[];
  getAncestors: (id: string) => CanvasObject[];
}

const generateId = () => Math.random().toString(36).substring(2, 15);

const stripPersistedDataUrls = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value.startsWith('data:') ? '' : value;
  }
  if (Array.isArray(value)) {
    return value.map(stripPersistedDataUrls);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, stripPersistedDataUrls(entry)]),
    );
  }
  return value;
};

const sanitizePersistedObject = (obj: CanvasObject): CanvasObject => {
  let candidate = obj;
  if (obj.type === 'image' && typeof obj.src === 'string' && obj.src.startsWith('data:')) {
    const galleryStoragePath = obj.metadata?.galleryStoragePath;
    if (galleryStoragePath) {
      candidate = { ...obj, src: galleryStoragePath };
    } else if (
      obj.metadata?.feature === 'gallery-import'
      || obj.metadata?.feature === 'local-upload'
      || obj.metadata?.sourceIdentity?.kind === 'local-upload'
    ) {
      const revision = obj.metadata?.sourceRevision?.revision || obj.metadata?.sourceIdentity?.hash;
      candidate = revision && hasLocalCanvasAsset(revision)
        ? { ...obj, src: buildLocalCanvasAssetReference(revision) }
        : { ...obj, src: '' };
    }
  }

  // Local files and generated previews can also be nested in metadata
  // parameters. Strip every data URL from the persisted snapshot so any
  // canvas mutation remains below localStorage quota while the active canvas
  // still retains the full in-memory object.
  return stripPersistedDataUrls(candidate) as CanvasObject;
};

const sanitizePersistedObjects = (objects: CanvasObject[]): CanvasObject[] =>
  objects.map(sanitizePersistedObject).filter((obj) => obj.src !== '');

const sanitizePersistedProject = (project: CanvasProject): CanvasProject => ({
  ...(stripPersistedDataUrls(project) as CanvasProject),
  objects: sanitizePersistedObjects(project.objects),
});

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentProjectId: null,
      currentProjectName: 'プロジェクト名',
      projects: [],
      zoom: 1,
      panX: 0,
      panY: 0,
      gridVisible: true,
      snapToGrid: true,
      gridSize: 20,
      objects: [],
      selectedIds: [],
      history: [[]],
      historyIndex: 0,

      // Project management
      createProject: (name, brandId, initialObjects = []) => {
        const id = generateId();
        const now = new Date().toISOString();
        const newProject: CanvasProject = {
          id,
          name,
          objects: initialObjects,
          createdAt: now,
          updatedAt: now,
          brandId,
        };
        
        set((state) => ({
          projects: [newProject, ...state.projects],
          currentProjectId: id,
          currentProjectName: name,
          objects: initialObjects,
          selectedIds: [],
          history: [initialObjects],
          historyIndex: 0,
          zoom: 1,
          panX: 0,
          panY: 0,
        }));
        
        return id;
      },

      loadProject: (projectId) => {
        const { projects } = get();
        const project = projects.find(p => p.id === projectId);
        
        if (project) {
          set({
            currentProjectId: project.id,
            currentProjectName: project.name,
            objects: project.objects,
            selectedIds: [],
            history: [project.objects],
            historyIndex: 0,
            zoom: 1,
            panX: 0,
            panY: 0,
          });
        }
      },

      saveCurrentProject: () => {
        const { currentProjectId, currentProjectName, objects, projects } = get();
        
        if (!currentProjectId) {
          // Create new project if none exists
          const id = get().createProject(currentProjectName);
          set((state) => ({
            projects: state.projects.map(p =>
              p.id === id ? { ...p, objects, updatedAt: new Date().toISOString() } : p
            ),
          }));
          return;
        }
        
        set({
          projects: projects.map(p =>
            p.id === currentProjectId
              ? { ...p, name: currentProjectName, objects, updatedAt: new Date().toISOString() }
              : p
          ),
        });
      },

      deleteProject: (projectId) => {
        const { currentProjectId } = get();
        
        set((state) => ({
          projects: state.projects.filter(p => p.id !== projectId),
          ...(currentProjectId === projectId && {
            currentProjectId: null,
            currentProjectName: 'プロジェクト名',
            objects: [],
            selectedIds: [],
          }),
        }));
      },

      renameProject: (projectId, name) => {
        const { currentProjectId } = get();
        
        set((state) => ({
          projects: state.projects.map(p =>
            p.id === projectId ? { ...p, name, updatedAt: new Date().toISOString() } : p
          ),
          ...(currentProjectId === projectId && { currentProjectName: name }),
        }));
      },

      updateProjectThumbnail: (projectId, thumbnail) => {
        set((state) => ({
          projects: state.projects.map(p =>
            p.id === projectId ? { ...p, thumbnail } : p
          ),
        }));
      },

      getRecentProjects: (limit = 10) => {
        const { projects } = get();
        return [...projects]
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, limit);
      },

      clearCanvas: () => {
        set({
          currentProjectId: null,
          currentProjectName: 'プロジェクト名',
          objects: [],
          selectedIds: [],
          history: [[]],
          historyIndex: 0,
          zoom: 1,
          panX: 0,
          panY: 0,
        });
      },

      // Zoom and pan
      setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),
      
      setPan: (x, y) => set({ panX: x, panY: y }),
      
      toggleGrid: () => set((state) => ({ gridVisible: !state.gridVisible })),
      
      toggleSnap: () => set((state) => ({ snapToGrid: !state.snapToGrid })),

      // Object management
      addObject: (object) => {
        const id = generateId();
        const { objects } = get();
        const maxZIndex = objects.length > 0 
          ? Math.max(...objects.map(o => o.zIndex)) + 1 
          : 0;
        
        const newObject: CanvasObject = {
          ...object,
          id,
          zIndex: maxZIndex,
        };
        
        set((state) => ({
          objects: [...state.objects, newObject],
        }));
        
        get().saveToHistory();
        return id;
      },

      updateObject: (id, updates) => {
        set((state) => ({
          objects: state.objects.map((obj) =>
            obj.id === id ? { ...obj, ...updates } : obj
          ),
        }));
      },

      deleteObject: (id) => {
        set((state) => ({
          objects: state.objects.filter((obj) => obj.id !== id),
          selectedIds: state.selectedIds.filter((selectedId) => selectedId !== id),
        }));
        get().saveToHistory();
      },

      deleteSelected: () => {
        const { selectedIds } = get();
        set((state) => ({
          objects: state.objects.filter((obj) => !selectedIds.includes(obj.id)),
          selectedIds: [],
        }));
        get().saveToHistory();
      },

      duplicateSelected: () => {
        const { selectedIds, objects, addObject } = get();
        const newIds: string[] = [];
        
        selectedIds.forEach((id) => {
          const obj = objects.find((o) => o.id === id);
          if (obj) {
            const { id: _, zIndex: __, ...rest } = obj;
            const newId = addObject({
              ...rest,
              x: obj.x + 20,
              y: obj.y + 20,
            });
            newIds.push(newId);
          }
        });
        
        set({ selectedIds: newIds });
      },

      // Selection
      selectObject: (id, addToSelection = false) => {
        set((state) => ({
          selectedIds: addToSelection
            ? state.selectedIds.includes(id)
              ? state.selectedIds.filter((i) => i !== id)
              : [...state.selectedIds, id]
            : [id],
        }));
      },

      selectAll: () => {
        set((state) => ({
          selectedIds: state.objects.map((obj) => obj.id),
        }));
      },

      deselectAll: () => {
        set({ selectedIds: [] });
      },

      // Z-index management
      bringToFront: (id) => {
        const { objects } = get();
        const maxZIndex = Math.max(...objects.map((o) => o.zIndex));
        set((state) => ({
          objects: state.objects.map((obj) =>
            obj.id === id ? { ...obj, zIndex: maxZIndex + 1 } : obj
          ),
        }));
      },

      sendToBack: (id) => {
        const { objects } = get();
        const minZIndex = Math.min(...objects.map((o) => o.zIndex));
        set((state) => ({
          objects: state.objects.map((obj) =>
            obj.id === id ? { ...obj, zIndex: minZIndex - 1 } : obj
          ),
        }));
      },

      bringForward: (id) => {
        const { objects } = get();
        const obj = objects.find((o) => o.id === id);
        if (!obj) return;
        
        const nextObj = objects
          .filter((o) => o.zIndex > obj.zIndex)
          .sort((a, b) => a.zIndex - b.zIndex)[0];
        
        if (nextObj) {
          set((state) => ({
            objects: state.objects.map((o) => {
              if (o.id === id) return { ...o, zIndex: nextObj.zIndex };
              if (o.id === nextObj.id) return { ...o, zIndex: obj.zIndex };
              return o;
            }),
          }));
        }
      },

      sendBackward: (id) => {
        const { objects } = get();
        const obj = objects.find((o) => o.id === id);
        if (!obj) return;
        
        const prevObj = objects
          .filter((o) => o.zIndex < obj.zIndex)
          .sort((a, b) => b.zIndex - a.zIndex)[0];
        
        if (prevObj) {
          set((state) => ({
            objects: state.objects.map((o) => {
              if (o.id === id) return { ...o, zIndex: prevObj.zIndex };
              if (o.id === prevObj.id) return { ...o, zIndex: obj.zIndex };
              return o;
            }),
          }));
        }
      },

      // History (Undo/Redo)
      saveToHistory: () => {
        const { objects, history, historyIndex } = get();
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(JSON.parse(JSON.stringify(objects)));
        
        // Limit history to 50 entries
        if (newHistory.length > 50) {
          newHistory.shift();
        }
        
        set({
          history: newHistory,
          historyIndex: newHistory.length - 1,
        });
      },

      undo: () => {
        const { historyIndex, history } = get();
        if (historyIndex > 0) {
          set({
            historyIndex: historyIndex - 1,
            objects: JSON.parse(JSON.stringify(history[historyIndex - 1])),
            selectedIds: [],
          });
        }
      },

      redo: () => {
        const { historyIndex, history } = get();
        if (historyIndex < history.length - 1) {
          set({
            historyIndex: historyIndex + 1,
            objects: JSON.parse(JSON.stringify(history[historyIndex + 1])),
            selectedIds: [],
          });
        }
      },

      // Derived tree helpers
      getDerivatives: (id) => {
        const { objects } = get();
        return objects.filter((obj) => obj.derivedFrom === id);
      },

      getAncestors: (id) => {
        const { objects } = get();
        const ancestors: CanvasObject[] = [];
        let current = objects.find((obj) => obj.id === id);
        
        while (current?.derivedFrom) {
          const parent = objects.find((obj) => obj.id === current!.derivedFrom);
          if (parent) {
            ancestors.push(parent);
            current = parent;
          } else {
            break;
          }
        }
        
        return ancestors;
      },
    }),
    {
      name: 'heavy-chain-canvas',
      version: 2,
      migrate: (persistedState: any) => {
        const state = persistedState?.state ?? persistedState;
        if (!state || typeof state !== 'object') {
          return persistedState;
        }

        return {
          ...state,
          objects: Array.isArray(state.objects) ? sanitizePersistedObjects(state.objects) : [],
          projects: Array.isArray(state.projects)
            ? state.projects.map(sanitizePersistedProject)
            : [],
        };
      },
      partialize: (state) => ({
        projects: state.projects.map(sanitizePersistedProject),
        currentProjectId: state.currentProjectId,
        currentProjectName: state.currentProjectName,
        objects: sanitizePersistedObjects(state.objects),
      }),
    }
  )
);
