import { useEffect, useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import { io } from "socket.io-client";
import "@xyflow/react/dist/style.css";
import "./App.css";

// Initial node with instructions
const defaultNodes = [
  {
    id: "waiting",
    data: { label: "Run :Terreno buffer in Neovim" },
    position: { x: 250, y: 150 },
  },
];

const defaultEdges = [];

const socket = io("http://localhost:3000");

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    socket.on("connect", () => {
      console.log("Connected to server");
      setConnected(true);
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from server");
      setConnected(false);
    });

    socket.on("graph:data", (data) => {
      console.log("Received graph data:", data);
      if (data.nodes) setNodes(data.nodes);
      if (data.edges) setEdges(data.edges);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("graph:data");
    };
  }, [setNodes, setEdges]);

  return (
    <div className="app">
      <div className="status">
        {connected ? "Connected" : "Disconnected"}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

export default App;
