import { useCallback, useMemo, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  ConnectionMode,
} from 'reactflow';
import type { Node, Edge, NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import { useCanvasStore, type CanvasObject } from '../../stores/canvasStore';
import { Image, GitBranch } from 'lucide-react';

// Custom node component for images
function ImageNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`
        bg-white rounded-lg shadow-soft border-2 overflow-hidden transition-all relative
        ${selected ? 'border-primary-500 shadow-elegant' : 'border-neutral-200'}
      `}
      style={{ width: 120, height: 120 }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-primary-500 !w-2 !h-2"
      />
      
      {data.src ? (
        <img
          src={data.src}
          alt={data.label}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-neutral-100">
          <Image className="w-8 h-8 text-neutral-400" />
        </div>
      )}
      
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-primary-500 !w-2 !h-2"
      />
      
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/60 to-transparent">
        <p className="text-xs text-white truncate">{data.label}</p>
      </div>
      
      {data.derivativeCount > 0 && (
        <div className="absolute top-1 right-1 flex items-center gap-0.5 px-1.5 py-0.5 bg-primary-500 text-white rounded text-xs font-medium">
          <GitBranch className="w-3 h-3" />
          {data.derivativeCount}
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  imageNode: ImageNode,
};

interface DerivationTreeProps {
  onNodeSelect?: (objectId: string) => void;
}

export function DerivationTree({ onNodeSelect }: DerivationTreeProps) {
  const { objects, selectedIds, selectObject, getDerivatives } = useCanvasStore();

  const { initialNodes, initialEdges } = useMemo(() => {
    const imageObjects = objects.filter((obj) => obj.type === 'image');
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    
    const rootObjects = imageObjects.filter((obj) => !obj.derivedFrom);
    let currentY = 0;
    
    const processObject = (obj: CanvasObject, depth: number, yOffset: number): number => {
      const derivatives = getDerivatives(obj.id);
      const derivativeCount = derivatives.length;
      
      nodes.push({
        id: obj.id,
        type: 'imageNode',
        position: { x: depth * 180, y: yOffset },
        data: {
          label: `Image ${obj.id.substring(0, 6)}`,
          src: obj.src,
          derivativeCount,
        },
        selected: selectedIds.includes(obj.id),
      });
      
      let nextY = yOffset;
      derivatives.forEach((derivative, index) => {
        edges.push({
          id: `${obj.id}-${derivative.id}`,
          source: obj.id,
          target: derivative.id,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#806a54', strokeWidth: 2 },
        });
        
        nextY = processObject(derivative, depth + 1, nextY);
        if (index < derivatives.length - 1) {
          nextY += 20;
        }
      });
      
      return Math.max(yOffset + 140, nextY);
    };
    
    rootObjects.forEach((obj) => {
      currentY = processObject(obj, 0, currentY);
      currentY += 40;
    });
    
    return { initialNodes: nodes, initialEdges: edges };
  }, [objects, selectedIds, getDerivatives]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectObject(node.id);
      onNodeSelect?.(node.id);
    },
    [selectObject, onNodeSelect]
  );

  if (objects.filter((obj) => obj.type === 'image').length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500">
        <GitBranch className="w-12 h-12 mb-3 text-neutral-300" />
        <p className="text-sm font-medium">派生ツリーがありません</p>
        <p className="text-xs text-neutral-400 mt-1">
          画像を生成すると、ここに派生関係が表示されます
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background color="#e5e5e5" gap={20} />
        <Controls 
          showInteractive={false}
          className="!bg-white !border-neutral-200 !shadow-soft"
        />
        <MiniMap
          nodeStrokeColor="#806a54"
          nodeColor="#f5f5f5"
          nodeBorderRadius={4}
          className="!bg-white !border-neutral-200"
        />
      </ReactFlow>
    </div>
  );
}

