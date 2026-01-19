import { useEffect, useState, useCallback, memo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
} from "@xyflow/react";
import { io } from "socket.io-client";
import "@xyflow/react/dist/style.css";
import "./App.css";

const socket = io("http://localhost:3000");

// Custom node component with expand/collapse and click-to-navigate
const SymbolNode = memo(({ data, id }) => {
  const [expanded, setExpanded] = useState(false);
  const [codeLines, setCodeLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandingCalls, setExpandingCalls] = useState(false);
  const [callsExpanded, setCallsExpanded] = useState(false);

  const hasFile = data.file || data.path || data.filepath;
  const hasLine = data.line && data.line > 0;

  const handleExpand = useCallback(
    (e) => {
      e.stopPropagation();
      if (!expanded && hasFile && hasLine) {
        setLoading(true);
        const filepath = data.filepath || data.path || data.file;
        socket.emit(
          "code:request",
          {
            filepath,
            line: data.line,
            end_line: data.end_line,
            name: data.label,
            context: 5,
          },
          (response) => {
            setLoading(false);
            if (response.status === "ok") {
              setCodeLines(response.lines);
            }
          }
        );
      }
      setExpanded(!expanded);
    },
    [expanded, hasFile, hasLine, data]
  );

  const handleExpandCalls = useCallback(
    async (e) => {
      e.stopPropagation();
      if (callsExpanded || !hasFile || !hasLine) return;

      setExpandingCalls(true);
      const filepath = data.filepath || data.path || data.file;
      try {
        const response = await fetch("http://localhost:3000/api/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filepath,
            line: data.line,
            col: data.col || 5,
          }),
        });
        const result = await response.json();
        if (result.status === "ok" && data.onExpandCalls) {
          data.onExpandCalls(id, result.nodes || [], result.edges || []);
          setCallsExpanded(true);
        }
      } catch (err) {
        console.error("Expand calls error:", err);
      }
      setExpandingCalls(false);
    },
    [hasFile, hasLine, data, id, callsExpanded]
  );

  const handleNavigate = useCallback(
    (e) => {
      e.stopPropagation();
      if (hasFile) {
        const filepath = data.filepath || data.path || data.file;
        socket.emit("navigate", { filepath, line: data.line || 1 });
      }
    },
    [hasFile, data]
  );

  return (
    <div className={`symbol-node ${expanded ? "expanded" : ""}`}>
      <Handle type="target" position={Position.Top} />

      <div className="node-header">
        <div className="node-label">{data.label}</div>
        <div className="node-actions">
          {hasFile && hasLine && !callsExpanded && (
            <button
              className="node-btn calls-btn"
              onClick={handleExpandCalls}
              title="Expand outgoing calls"
              disabled={expandingCalls}
            >
              {expandingCalls ? "..." : "⤵"}
            </button>
          )}
          {hasFile && hasLine && (
            <button
              className="node-btn expand-btn"
              onClick={handleExpand}
              title={expanded ? "Collapse" : "Show code"}
            >
              {loading ? "..." : expanded ? "−" : "+"}
            </button>
          )}
          {hasFile && (
            <button
              className="node-btn nav-btn"
              onClick={handleNavigate}
              title="Go to definition"
            >
              →
            </button>
          )}
        </div>
      </div>

      {data.file && (
        <div className="node-meta">
          {data.file}
          {hasLine && `:${data.line}`}
        </div>
      )}

      {expanded && codeLines.length > 0 && (
        <div className="code-preview">
          {codeLines.map((line) => (
            <div
              key={line.num}
              className={`code-line ${line.num === data.line ? "highlight" : ""}`}
            >
              <span className="line-num">{line.num}</span>
              <span className="line-text">{line.text || " "}</span>
            </div>
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

SymbolNode.displayName = "SymbolNode";

// Node types
const nodeTypes = {
  symbol: SymbolNode,
  default: SymbolNode,
};

// Initial node with instructions
const defaultNodes = [
  {
    id: "waiting",
    type: "symbol",
    data: { label: "Run :Terreno workspace in Neovim" },
    position: { x: 250, y: 150 },
  },
];

const defaultEdges = [];

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);
  const [connected, setConnected] = useState(false);
  const [neovimConnected, setNeovimConnected] = useState(false);
  const [cwd, setCwd] = useState("");

  // Handle expanding a node's outgoing calls
  const handleExpandCalls = useCallback(
    (sourceId, newNodes, newEdges) => {
      console.log("Expanding calls:", sourceId, newNodes.length, "nodes");

      // Find source node position
      const sourceNode = nodes.find((n) => n.id === sourceId);
      const sourceX = sourceNode?.position?.x || 0;
      const sourceY = sourceNode?.position?.y || 0;

      // Filter out nodes that already exist
      const existingIds = new Set(nodes.map((n) => n.id));
      const uniqueNewNodes = newNodes.filter((n) => !existingIds.has(n.id));

      // Position new nodes below the source node
      const positionedNodes = uniqueNewNodes.map((node, i) => ({
        ...node,
        type: node.type || "symbol",
        position: {
          x: sourceX + (i - uniqueNewNodes.length / 2) * 250,
          y: sourceY + 150,
        },
        data: {
          ...node.data,
          onExpandCalls: handleExpandCalls,
        },
      }));

      // Filter out edges that already exist
      const existingEdgeIds = new Set(edges.map((e) => `${e.source}-${e.target}`));
      const uniqueNewEdges = newEdges.filter(
        (e) => !existingEdgeIds.has(`${e.source}-${e.target}`)
      );

      if (positionedNodes.length > 0) {
        setNodes((nds) => [...nds, ...positionedNodes]);
      }
      if (uniqueNewEdges.length > 0) {
        setEdges((eds) => [...eds, ...uniqueNewEdges]);
      }
    },
    [nodes, edges, setNodes, setEdges]
  );

  useEffect(() => {
    // Check if already connected (socket created before component mounted)
    if (socket.connected) {
      setConnected(true);
    }

    socket.on("connect", () => {
      console.log("Connected to server");
      setConnected(true);
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from server");
      setConnected(false);
    });

    socket.on("neovim:connected", ({ cwd }) => {
      console.log("Neovim connected:", cwd);
      setNeovimConnected(true);
      setCwd(cwd);
    });

    socket.on("graph:data", (data) => {
      console.log("Received graph data:", data);
      if (data.nodes) {
        // Add symbol type and callbacks to nodes
        const typedNodes = data.nodes.map((node) => ({
          ...node,
          type: node.type || "symbol",
          data: {
            ...node.data,
            onExpandCalls: handleExpandCalls,
          },
        }));
        setNodes(typedNodes);
      }
      if (data.edges) {
        setEdges(data.edges);
      }
    });

    socket.on("navigate:success", () => {
      console.log("Navigation successful");
    });

    socket.on("navigate:error", ({ message }) => {
      console.error("Navigation error:", message);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("neovim:connected");
      socket.off("graph:data");
      socket.off("navigate:success");
      socket.off("navigate:error");
    };
  }, [setNodes, setEdges, handleExpandCalls]);

  return (
    <div className="app">
      <div className="status-bar">
        <div className={`status ${connected ? "connected" : "disconnected"}`}>
          Server: {connected ? "Connected" : "Disconnected"}
        </div>
        <div
          className={`status ${neovimConnected ? "connected" : "disconnected"}`}
        >
          Neovim: {neovimConnected ? "Connected" : "Waiting..."}
        </div>
        {cwd && <div className="cwd">{cwd}</div>}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

export default App;
