import { useEffect, useState, useCallback, useRef, memo, useMemo } from "react";
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
import Dagre from "@dagrejs/dagre";
import { io } from "socket.io-client";
import "@xyflow/react/dist/style.css";
import "./App.css";

const socket = io("http://localhost:3000");

// Grid layout grouped by file (for initial view with no edges)
const getGridLayout = (nodes) => {
  // For file nodes (Nogic style), lay them out in a row
  const fileNodes = nodes.filter((n) => n.type === "file");
  const otherNodes = nodes.filter((n) => n.type !== "file");

  if (fileNodes.length > 0) {
    // File nodes: horizontal layout with spacing
    const colWidth = 320;
    const layoutedNodes = fileNodes.map((node, index) => ({
      ...node,
      position: { x: index * colWidth, y: 0 },
    }));

    // Add any other nodes below
    otherNodes.forEach((node, index) => {
      layoutedNodes.push({
        ...node,
        position: { x: (index % 4) * 280, y: 400 + Math.floor(index / 4) * 90 },
      });
    });

    return layoutedNodes;
  }

  // Legacy: Group symbol nodes by file
  const byFile = {};
  nodes.forEach((node) => {
    const file = node.data?.file || "unknown";
    if (!byFile[file]) byFile[file] = [];
    byFile[file].push(node);
  });

  const files = Object.keys(byFile).sort();
  const layoutedNodes = [];

  const colWidth = 280;
  const rowHeight = 90;

  files.forEach((file, colIndex) => {
    const fileNodes = byFile[file];
    fileNodes.forEach((node, rowIndex) => {
      layoutedNodes.push({
        ...node,
        position: { x: colIndex * colWidth, y: rowIndex * rowHeight },
      });
    });
  });

  return layoutedNodes;
};

// Auto-layout using dagre (LR = left-right, like a call tree)
const getLayoutedElements = (nodes, edges, direction = "LR") => {
  // If no edges, use grid layout grouped by file
  if (edges.length === 0) {
    return { nodes: getGridLayout(nodes), edges };
  }

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 80, ranksep: 250 });

  nodes.forEach((node) => {
    // File nodes are taller (contain symbol list)
    if (node.type === "file") {
      const symbolCount = node.data?.symbols?.length || 0;
      const height = Math.min(400, 100 + symbolCount * 24);
      g.setNode(node.id, { width: 280, height });
    } else {
      // Estimate symbol node size based on label length
      const width = Math.max(180, (node.data?.label?.length || 10) * 8 + 80);
      g.setNode(node.id, { width, height: 70 });
    }
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  Dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const nodeInfo = g.node(node.id);
    return {
      ...node,
      position: { x: nodeInfo.x - nodeInfo.width / 2, y: nodeInfo.y - nodeInfo.height / 2 },
    };
  });

  return { nodes: layoutedNodes, edges };
};

// File node component (Nogic style) - shows file with its symbols
const FileNode = memo(({ data, id }) => {
  const [expanded, setExpanded] = useState(true);

  const handleNavigate = useCallback(
    (filepath, line) => {
      socket.emit("navigate", { filepath, line: line || 1 });
    },
    []
  );

  const handleToggle = useCallback((e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  }, [expanded]);

  // Group symbols by kind
  const groupedSymbols = useMemo(() => {
    const groups = {};
    (data.symbols || []).forEach((sym) => {
      const kind = sym.kind || "Other";
      if (!groups[kind]) groups[kind] = [];
      groups[kind].push(sym);
    });
    return groups;
  }, [data.symbols]);

  const kindOrder = ["Class", "Function", "Method", "Variable", "Constant", "Property"];

  return (
    <div className="file-node">
      <Handle type="target" position={Position.Left} />

      <div className="file-header" onClick={handleToggle}>
        <span className="file-icon">📄</span>
        <span className="file-name">{data.filename}</span>
        <span className="file-toggle">{expanded ? "▼" : "▶"}</span>
        <button
          className="file-nav-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleNavigate(data.filepath, 1);
          }}
          title="Open file"
        >
          →
        </button>
      </div>

      <div className="file-path">{data.path}</div>

      {expanded && (
        <div className="file-symbols">
          {kindOrder.map((kind) =>
            groupedSymbols[kind] ? (
              <div key={kind} className="symbol-group">
                <div className="symbol-group-header">{kind}s ({groupedSymbols[kind].length})</div>
                {groupedSymbols[kind].map((sym, i) => (
                  <div
                    key={i}
                    className="symbol-item"
                    onClick={() => handleNavigate(data.filepath, sym.line)}
                    title={`Line ${sym.line}`}
                  >
                    <span className="symbol-bullet">•</span>
                    <span className="symbol-name">{sym.name}</span>
                    <span className="symbol-line">:{sym.line}</span>
                  </div>
                ))}
              </div>
            ) : null
          )}
          {/* Show any other kinds not in the order */}
          {Object.keys(groupedSymbols)
            .filter((k) => !kindOrder.includes(k))
            .map((kind) => (
              <div key={kind} className="symbol-group">
                <div className="symbol-group-header">{kind}s ({groupedSymbols[kind].length})</div>
                {groupedSymbols[kind].map((sym, i) => (
                  <div
                    key={i}
                    className="symbol-item"
                    onClick={() => handleNavigate(data.filepath, sym.line)}
                    title={`Line ${sym.line}`}
                  >
                    <span className="symbol-bullet">•</span>
                    <span className="symbol-name">{sym.name}</span>
                    <span className="symbol-line">:{sym.line}</span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
});

FileNode.displayName = "FileNode";

// Custom node component with expand/collapse and click-to-navigate (legacy)
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
      <Handle type="target" position={Position.Left} />

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

      <Handle type="source" position={Position.Right} />
    </div>
  );
});

SymbolNode.displayName = "SymbolNode";

// Node types
const nodeTypes = {
  file: FileNode,
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

  // Ref for stable callback
  const expandCallsRef = useRef(null);

  // Handle expanding a node's outgoing calls
  const handleExpandCalls = useCallback((sourceId, newNodes, newEdges) => {
    console.log("Expanding calls:", sourceId, newNodes.length, "nodes");

    setNodes((currentNodes) => {
      // Find source node position
      const sourceNode = currentNodes.find((n) => n.id === sourceId);
      const sourceX = sourceNode?.position?.x || 0;
      const sourceY = sourceNode?.position?.y || 0;

      const existingIds = new Set(currentNodes.map((n) => n.id));
      const uniqueNewNodes = newNodes.filter((n) => !existingIds.has(n.id));

      if (uniqueNewNodes.length === 0) return currentNodes;

      // Find occupied Y ranges at the target X position (with some tolerance)
      const targetX = sourceX + 300;
      const nodeHeight = 90;
      const occupiedRanges = currentNodes
        .filter((n) => Math.abs(n.position.x - targetX) < 250)
        .map((n) => ({ top: n.position.y, bottom: n.position.y + 70 }));

      // Find a free Y position starting from sourceY
      const findFreeY = (startY, count) => {
        let y = startY;
        const neededHeight = count * nodeHeight;

        for (let attempts = 0; attempts < 50; attempts++) {
          const proposedTop = y;
          const proposedBottom = y + neededHeight;

          const hasCollision = occupiedRanges.some(
            (r) => !(proposedBottom < r.top || proposedTop > r.bottom)
          );

          if (!hasCollision) return y;
          y += nodeHeight;
        }
        return y;
      };

      const startY = findFreeY(sourceY, uniqueNewNodes.length);

      // Position new nodes to the right of source, stacked vertically
      const typedNewNodes = uniqueNewNodes.map((node, index) => ({
        ...node,
        type: node.type || "symbol",
        position: {
          x: targetX,
          y: startY + index * nodeHeight,
        },
        data: {
          ...node.data,
          onExpandCalls: (...args) => expandCallsRef.current?.(...args),
        },
      }));

      return [...currentNodes, ...typedNewNodes];
    });

    setEdges((currentEdges) => {
      const existingEdgeIds = new Set(currentEdges.map((e) => `${e.source}-${e.target}`));
      const uniqueNewEdges = newEdges.filter(
        (e) => !existingEdgeIds.has(`${e.source}-${e.target}`)
      );
      return [...currentEdges, ...uniqueNewEdges];
    });

    // No global re-layout - nodes are positioned relative to parent
  }, [setNodes, setEdges]);

  expandCallsRef.current = handleExpandCalls;

  // Apply layout when triggered
  const [needsLayout, setNeedsLayout] = useState(false);

  useEffect(() => {
    if (needsLayout && nodes.length > 0) {
      const { nodes: layouted } = getLayoutedElements(nodes, edges);
      setNodes(layouted);
      setNeedsLayout(false);
    }
  }, [needsLayout, nodes, edges, setNodes]);

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
          // Ensure position exists (React Flow requires it)
          position: node.position || { x: 0, y: 0 },
          data: {
            ...node.data,
            onExpandCalls: (...args) => expandCallsRef.current?.(...args),
          },
        }));

        // Apply layout BEFORE setting nodes
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
          typedNodes,
          data.edges || []
        );

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
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
  }, [setNodes, setEdges]);

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
