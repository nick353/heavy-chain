import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';

export interface Awareness {
  clientID: number;
  user?: {
    id: string;
    name: string;
    color: string;
    cursor?: { x: number; y: number };
    selectedIds?: string[];
  };
}

// Generate a random color for user cursor
const generateColor = () => {
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#84cc16', 
    '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

export class CollaborativeDocument {
  public doc: Y.Doc;
  public provider: WebrtcProvider | null = null;
  public objects: Y.Map<any>;
  public awareness: any;
  private roomId: string;
  private userId: string;
  private userName: string;
  private userColor: string;

  constructor(roomId: string, userId: string, userName: string) {
    this.roomId = roomId;
    this.userId = userId;
    this.userName = userName;
    this.userColor = generateColor();
    
    // Create Yjs document
    this.doc = new Y.Doc();
    
    // Create shared types
    this.objects = this.doc.getMap('objects');
  }

  connect() {
    // Connect via WebRTC for peer-to-peer sync
    this.provider = new WebrtcProvider(
      `heavy-chain-${this.roomId}`,
      this.doc,
      {
        signaling: ['wss://signaling.yjs.dev', 'wss://y-webrtc-signaling-eu.herokuapp.com'],
        password: undefined,
        awareness: undefined,
        maxConns: 20,
        filterBcConns: true,
        peerOpts: {},
      }
    );

    // Set up awareness (cursor sharing)
    this.awareness = this.provider.awareness;
    this.awareness.setLocalStateField('user', {
      id: this.userId,
      name: this.userName,
      color: this.userColor,
    });

    return this;
  }

  disconnect() {
    if (this.provider) {
      this.provider.disconnect();
      this.provider.destroy();
      this.provider = null;
    }
    this.doc.destroy();
  }

  // Object operations
  addObject(id: string, object: any) {
    this.objects.set(id, object);
  }

  updateObject(id: string, updates: any) {
    const current = this.objects.get(id);
    if (current) {
      this.objects.set(id, { ...current, ...updates });
    }
  }

  deleteObject(id: string) {
    this.objects.delete(id);
  }

  getObjects(): Map<string, any> {
    return new Map(this.objects.entries());
  }

  // Awareness (cursor/selection)
  updateCursor(x: number, y: number) {
    const current = this.awareness?.getLocalState()?.user || {};
    this.awareness?.setLocalStateField('user', {
      ...current,
      cursor: { x, y },
    });
  }

  updateSelection(selectedIds: string[]) {
    const current = this.awareness?.getLocalState()?.user || {};
    this.awareness?.setLocalStateField('user', {
      ...current,
      selectedIds,
    });
  }

  // Subscribe to changes
  onObjectsChange(callback: (event: Y.YMapEvent<any>) => void) {
    this.objects.observe(callback);
    return () => this.objects.unobserve(callback);
  }

  onAwarenessChange(callback: (changes: any) => void) {
    this.awareness?.on('change', callback);
    return () => this.awareness?.off('change', callback);
  }

  // Get other users' awareness states
  getOtherUsers(): Awareness[] {
    if (!this.awareness) return [];
    
    const states: Awareness[] = [];
    this.awareness.getStates().forEach((state: any, clientID: number) => {
      if (clientID !== this.awareness.clientID && state.user) {
        states.push({
          clientID,
          user: state.user,
        });
      }
    });
    return states;
  }

  // Undo Manager
  createUndoManager(trackedTypes: Y.AbstractType<any>[]) {
    return new Y.UndoManager(trackedTypes);
  }
}

// Hook for React
import { useEffect, useRef, useState, useCallback } from 'react';

export function useCollaborativeDocument(
  roomId: string | null,
  userId: string,
  userName: string
) {
  const docRef = useRef<CollaborativeDocument | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [otherUsers, setOtherUsers] = useState<Awareness[]>([]);

  useEffect(() => {
    if (!roomId) return;

    const doc = new CollaborativeDocument(roomId, userId, userName);
    doc.connect();
    docRef.current = doc;
    setIsConnected(true);

    // Listen for awareness changes
    const unsubscribe = doc.onAwarenessChange(() => {
      setOtherUsers(doc.getOtherUsers());
    });

    return () => {
      unsubscribe();
      doc.disconnect();
      docRef.current = null;
      setIsConnected(false);
    };
  }, [roomId, userId, userName]);

  const updateCursor = useCallback((x: number, y: number) => {
    docRef.current?.updateCursor(x, y);
  }, []);

  const updateSelection = useCallback((selectedIds: string[]) => {
    docRef.current?.updateSelection(selectedIds);
  }, []);

  return {
    doc: docRef.current,
    isConnected,
    otherUsers,
    updateCursor,
    updateSelection,
  };
}

