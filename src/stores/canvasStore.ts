import { create } from 'zustand';

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
}

export interface CanvasState {
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
  
  // Actions
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
  
  // Derived tree
  getDerivatives: (id: string) => CanvasObject[];
  getAncestors: (id: string) => CanvasObject[];
}

const generateId = () => Math.random().toString(36).substring(2, 15);

export const useCanvasStore = create<CanvasState>((set, get) => ({
  // Initial state
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
}));

