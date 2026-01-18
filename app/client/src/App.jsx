import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./App.css";

// Grafo dummy - simula estructura de código
const initialNodes = [
  {
    id: "1",
    type: "input",
    data: { label: "main.lua" },
    position: { x: 250, y: 0 },
  },
  {
    id: "2",
    data: { label: "terreno.setup()" },
    position: { x: 100, y: 100 },
  },
  {
    id: "3",
    data: { label: "terreno.open()" },
    position: { x: 400, y: 100 },
  },
  {
    id: "4",
    data: { label: "server.start()" },
    position: { x: 100, y: 200 },
  },
  {
    id: "5",
    data: { label: "server.stop()" },
    position: { x: 400, y: 200 },
  },
  {
    id: "6",
    type: "output",
    data: { label: "socket.emit()" },
    position: { x: 250, y: 300 },
  },
];

const initialEdges = [
  { id: "e1-2", source: "1", target: "2" },
  { id: "e1-3", source: "1", target: "3" },
  { id: "e2-4", source: "2", target: "4" },
  { id: "e3-5", source: "3", target: "5" },
  { id: "e4-6", source: "4", target: "6" },
  { id: "e5-6", source: "5", target: "6" },
];

function App() {
  return (
    <div className="app">
      <ReactFlow
        nodes={initialNodes}
        edges={initialEdges}
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
