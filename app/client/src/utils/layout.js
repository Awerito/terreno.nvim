import Dagre from "@dagrejs/dagre";

/**
 * Estimate node dimensions based on content.
 * These match the CSS styles in App.css for .file-node
 */
const estimateNodeSize = (node) => {
  if (node.type !== "file") {
    // Legacy symbol nodes
    const labelLength = node.data?.label?.length || 10;
    return {
      width: Math.max(180, labelLength * 8 + 80),
      height: 70,
    };
  }

  const symbols = node.data?.symbols || [];

  // Width: based on longest symbol name or filename
  // Also consider that code previews can expand the card significantly
  const filename = node.data?.filename || "";
  const longestSymbol = symbols.reduce(
    (max, s) => Math.max(max, s.name?.length || 0),
    0
  );
  const maxTextLength = Math.max(filename.length, longestSymbol);
  // Base width from text + extra space for potential code preview (avg 80 chars)
  const baseWidth = Math.max(280, maxTextLength * 8 + 120);
  const codePreviewBuffer = 300; // space for expanded code
  const width = baseWidth + codePreviewBuffer;

  // Height: header + path + symbols list
  const headerHeight = 50; // file-header + file-path
  const symbolHeight = 28; // each symbol row
  const groupHeaderHeight = 24; // "METHODS (n)" etc
  const groupCount = new Set(symbols.map((s) => s.kind)).size;
  const symbolsHeight = symbols.length * symbolHeight + groupCount * groupHeaderHeight;
  const maxSymbolsHeight = 300; // matches max-height in CSS
  const height = headerHeight + Math.min(symbolsHeight, maxSymbolsHeight) + 16; // padding

  return { width, height };
};

/**
 * Grid layout for initial view with no edges
 */
export const getGridLayout = (nodes) => {
  const fileNodes = nodes.filter((n) => n.type === "file");

  if (fileNodes.length === 0) return nodes;

  // Calculate max width to use as column spacing
  const sizes = fileNodes.map((n) => estimateNodeSize(n));
  const maxWidth = Math.max(...sizes.map((s) => s.width));
  const gap = 40;

  return fileNodes.map((node, index) => ({
    ...node,
    position: { x: index * (maxWidth + gap), y: 0 },
  }));
};

/**
 * Auto-layout using dagre (LR = left-right, like a call tree)
 */
export const getLayoutedElements = (nodes, edges, direction = "LR") => {
  if (edges.length === 0) {
    return { nodes: getGridLayout(nodes), edges };
  }

  // Calculate sizes for all nodes
  const nodeSizes = new Map();
  nodes.forEach((node) => {
    nodeSizes.set(node.id, estimateNodeSize(node));
  });

  // Find max dimensions for spacing calculations
  const allSizes = Array.from(nodeSizes.values());
  const maxHeight = Math.max(...allSizes.map((s) => s.height));
  const maxWidth = Math.max(...allSizes.map((s) => s.width));

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: Math.max(30, maxHeight * 0.1), // vertical gap proportional to node height
    ranksep: maxWidth + 80, // horizontal gap = node width + margin
  });

  nodes.forEach((node) => {
    const size = nodeSizes.get(node.id);
    g.setNode(node.id, size);
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
