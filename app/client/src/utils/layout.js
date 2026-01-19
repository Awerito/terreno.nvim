import Dagre from "@dagrejs/dagre";

/**
 * Grid layout for nodes grouped by file (for initial view with no edges)
 */
export const getGridLayout = (nodes) => {
  const fileNodes = nodes.filter((n) => n.type === "file");
  const otherNodes = nodes.filter((n) => n.type !== "file");

  if (fileNodes.length > 0) {
    const colWidth = 320;
    const layoutedNodes = fileNodes.map((node, index) => ({
      ...node,
      position: { x: index * colWidth, y: 0 },
    }));

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

/**
 * Auto-layout using dagre (LR = left-right, like a call tree)
 */
export const getLayoutedElements = (nodes, edges, direction = "LR") => {
  if (edges.length === 0) {
    return { nodes: getGridLayout(nodes), edges };
  }

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 80, ranksep: 250 });

  nodes.forEach((node) => {
    if (node.type === "file") {
      const symbolCount = node.data?.symbols?.length || 0;
      const height = Math.min(400, 100 + symbolCount * 24);
      g.setNode(node.id, { width: 280, height });
    } else {
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
      position: {
        x: nodeInfo.x - nodeInfo.width / 2,
        y: nodeInfo.y - nodeInfo.height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};
