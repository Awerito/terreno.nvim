import { useState, useCallback, useRef } from "react";
import { fetchReferences, fetchExpandFile } from "../utils/socket";

/**
 * Estimate node height based on symbol count
 */
const estimateNodeHeight = (symbols = []) => {
  const headerHeight = 50;
  const symbolHeight = 28;
  const groupHeaderHeight = 24;
  const groupCount = new Set(symbols.map((s) => s.kind)).size;
  const symbolsHeight = symbols.length * symbolHeight + groupCount * groupHeaderHeight;
  const maxSymbolsHeight = 300;
  return headerHeight + Math.min(symbolsHeight, maxSymbolsHeight) + 16;
};

/**
 * Estimate node width based on content
 * Includes buffer for expanded code preview
 */
const estimateNodeWidth = (node) => {
  const filename = node.data?.filename || "";
  const symbols = node.data?.symbols || [];
  const longestSymbol = symbols.reduce(
    (max, s) => Math.max(max, s.name?.length || 0),
    0
  );
  const maxTextLength = Math.max(filename.length, longestSymbol);
  const baseWidth = Math.max(280, maxTextLength * 8 + 120);
  const codePreviewBuffer = 300;
  return baseWidth + codePreviewBuffer;
};

export const useGraphInteractions = (nodes, setNodes, setEdges) => {
  const [highlightedFiles, setHighlightedFiles] = useState(new Set());

  const expandCallsRef = useRef(null);
  const symbolHoverRef = useRef(null);
  const expandFileRef = useRef(null);

  // Handle symbol hover - find references via LSP
  const handleSymbolHover = useCallback(
    (nodeId, sym, entering) => {
      if (!entering || !sym) {
        setHighlightedFiles(new Set());
        return;
      }

      const node = nodes.find((n) => n.id === nodeId);
      if (!node?.data?.filepath) return;

      fetchReferences(node.data.filepath, sym.line, sym.name)
        .then((result) => {
          if (result.status === "ok" && result.files) {
            setHighlightedFiles(new Set(result.files));
          }
        })
        .catch((err) => {
          console.error("References error:", err);
        });
    },
    [nodes]
  );

  // Handle expanding a file's imports
  const handleExpandFile = useCallback(
    (sourceId, filepath) => {
      return fetchExpandFile(filepath)
        .then((result) => {
          if (result.status === "ok" && result.nodes) {
            setNodes((currentNodes) => {
              const updatedNodes = currentNodes.map((n) =>
                n.id === sourceId
                  ? { ...n, data: { ...n.data, isExpanded: true } }
                  : n
              );

              const sourceNode = currentNodes.find((n) => n.id === sourceId);
              const sourceX = sourceNode?.position?.x || 0;
              const sourceY = sourceNode?.position?.y || 0;

              const existingIds = new Set(currentNodes.map((n) => n.id));
              const newNodes = result.nodes.filter((n) => !existingIds.has(n.id));

              if (newNodes.length === 0) {
                return updatedNodes;
              }

              // Calculate positions based on source node and new nodes content
              const sourceWidth = estimateNodeWidth(sourceNode);
              const horizontalGap = 60;
              const verticalGap = 30;

              let currentY = sourceY;
              const positionedNodes = newNodes.map((node) => {
                const nodeHeight = estimateNodeHeight(node.data?.symbols);
                const positioned = {
                  ...node,
                  type: "file",
                  position: {
                    x: sourceX + sourceWidth + horizontalGap,
                    y: currentY,
                  },
                  data: {
                    ...node.data,
                    onExpandCalls: (...args) => expandCallsRef.current?.(...args),
                    onSymbolHover: (...args) => symbolHoverRef.current?.(...args),
                    onExpandFile: (...args) => expandFileRef.current?.(...args),
                  },
                };
                currentY += nodeHeight + verticalGap;
                return positioned;
              });

              return [...updatedNodes, ...positionedNodes];
            });

            setEdges((currentEdges) => {
              const newEdges = result.nodes
                .filter((n) => n.id !== sourceId)
                .map((n) => ({
                  id: `e_${sourceId}_${n.id}`,
                  source: sourceId,
                  target: n.id,
                }))
                .filter(
                  (e) =>
                    !currentEdges.some(
                      (ce) => ce.source === e.source && ce.target === e.target
                    )
                );
              return [...currentEdges, ...newEdges];
            });
          }
        })
        .catch((err) => {
          console.error("Expand file error:", err);
        });
    },
    [setNodes, setEdges]
  );

  // Handle expanding a node's outgoing calls (legacy)
  const handleExpandCalls = useCallback(
    (sourceId, newNodes, newEdges) => {
      console.log("Expanding calls:", sourceId, newNodes.length, "nodes");

      setNodes((currentNodes) => {
        const sourceNode = currentNodes.find((n) => n.id === sourceId);
        const sourceX = sourceNode?.position?.x || 0;
        const sourceY = sourceNode?.position?.y || 0;

        const existingIds = new Set(currentNodes.map((n) => n.id));
        const uniqueNewNodes = newNodes.filter((n) => !existingIds.has(n.id));

        if (uniqueNewNodes.length === 0) return currentNodes;

        const sourceWidth = estimateNodeWidth(sourceNode);
        const horizontalGap = 60;
        const targetX = sourceX + sourceWidth + horizontalGap;

        // Calculate occupied ranges based on actual node heights
        const occupiedRanges = currentNodes
          .filter((n) => Math.abs(n.position.x - targetX) < sourceWidth)
          .map((n) => {
            const h = estimateNodeHeight(n.data?.symbols);
            return { top: n.position.y, bottom: n.position.y + h };
          });

        // For symbol nodes, use a simpler height estimate
        const symbolNodeHeight = 80;
        const verticalGap = 20;

        const findFreeY = (startY, count) => {
          let y = startY;
          const neededHeight = count * (symbolNodeHeight + verticalGap);

          for (let attempts = 0; attempts < 50; attempts++) {
            const proposedTop = y;
            const proposedBottom = y + neededHeight;

            const hasCollision = occupiedRanges.some(
              (r) => !(proposedBottom < r.top || proposedTop > r.bottom)
            );

            if (!hasCollision) return y;
            y += symbolNodeHeight + verticalGap;
          }
          return y;
        };

        const startY = findFreeY(sourceY, uniqueNewNodes.length);

        const typedNewNodes = uniqueNewNodes.map((node, index) => ({
          ...node,
          type: node.type || "symbol",
          position: {
            x: targetX,
            y: startY + index * (symbolNodeHeight + verticalGap),
          },
          data: {
            ...node.data,
            onExpandCalls: (...args) => expandCallsRef.current?.(...args),
          },
        }));

        return [...currentNodes, ...typedNewNodes];
      });

      setEdges((currentEdges) => {
        const existingEdgeIds = new Set(
          currentEdges.map((e) => `${e.source}-${e.target}`)
        );
        const uniqueNewEdges = newEdges.filter(
          (e) => !existingEdgeIds.has(`${e.source}-${e.target}`)
        );
        return [...currentEdges, ...uniqueNewEdges];
      });
    },
    [setNodes, setEdges]
  );

  // Update refs
  expandCallsRef.current = handleExpandCalls;
  symbolHoverRef.current = handleSymbolHover;
  expandFileRef.current = handleExpandFile;

  return {
    highlightedFiles,
    handleSymbolHover,
    handleExpandFile,
    handleExpandCalls,
    refs: { expandCallsRef, symbolHoverRef, expandFileRef },
  };
};
