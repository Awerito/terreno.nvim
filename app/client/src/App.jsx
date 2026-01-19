import { useEffect, useState, useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./App.css";

import { FileNode, StatusBar } from "./components";
import { useSocket, useGraphEvents, useGraphInteractions } from "./hooks";
import { getLayoutedElements } from "./utils/layout";

// Node types for ReactFlow
const nodeTypes = {
  file: FileNode,
};

// Initial placeholder node
const defaultNodes = [
  {
    id: "waiting",
    type: "file",
    data: {
      filename: "Waiting...",
      path: "Run :Terreno workspace in Neovim",
      symbols: [],
    },
    position: { x: 250, y: 150 },
  },
];

const defaultEdges = [];

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);

  // Socket connection state
  const { connected, neovimConnected, cwd } = useSocket();

  // Graph interactions (hover, expand, etc.)
  const { highlightedFiles, refs } = useGraphInteractions(
    nodes,
    setNodes,
    setEdges
  );

  // Handle incoming graph data
  const handleGraphData = useCallback(
    (data) => {
      if (!data.nodes) return;

      const typedNodes = data.nodes.map((node) => ({
        ...node,
        type: node.type || "file",
        position: node.position || { x: 0, y: 0 },
        data: {
          ...node.data,
          onExpandCalls: (...args) => refs.expandCallsRef.current?.(...args),
          onSymbolHover: (...args) => refs.symbolHoverRef.current?.(...args),
          onExpandFile: (...args) => refs.expandFileRef.current?.(...args),
        },
      }));

      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        typedNodes,
        data.edges || []
      );

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    },
    [setNodes, setEdges, refs]
  );

  // Subscribe to graph data events
  useGraphEvents(handleGraphData);

  // Style edges based on highlighted files
  const styledEdges = useMemo(() => {
    return edges.map((edge) => {
      const isHighlighted =
        highlightedFiles.size > 0 &&
        (highlightedFiles.has(edge.source) || highlightedFiles.has(edge.target));
      return {
        ...edge,
        style: isHighlighted
          ? { stroke: "#22c55e", strokeWidth: 3 }
          : { stroke: "#4f46e5", strokeWidth: 2 },
        animated: isHighlighted,
      };
    });
  }, [edges, highlightedFiles]);

  // Style nodes based on highlighting
  const styledNodes = useMemo(() => {
    if (highlightedFiles.size === 0) return nodes;
    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        highlighted: highlightedFiles.has(node.id),
      },
    }));
  }, [nodes, highlightedFiles]);

  return (
    <div className="app">
      <StatusBar
        connected={connected}
        neovimConnected={neovimConnected}
        cwd={cwd}
      />
      <ReactFlow
        nodes={styledNodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        noPanClassName="no-wheel-zoom"
        noWheelClassName="no-wheel-zoom"
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

export default App;
