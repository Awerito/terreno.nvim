import { useState, useCallback, useRef, useEffect } from "react";
import { fetchReferences, fetchExpandFile } from "../utils/socket";
import { estimateNodeSize } from "../utils/layout";

export const useGraphInteractions = (nodes, setNodes, setEdges) => {
  const [highlightedFiles, setHighlightedFiles] = useState(new Set());

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
    [nodes],
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
                  : n,
              );

              const sourceNode = currentNodes.find((n) => n.id === sourceId);
              const sourceX = sourceNode?.position?.x || 0;
              const sourceY = sourceNode?.position?.y || 0;

              const existingIds = new Set(currentNodes.map((n) => n.id));
              const newNodes = result.nodes.filter(
                (n) => !existingIds.has(n.id),
              );

              if (newNodes.length === 0) {
                return updatedNodes;
              }

              // Stack new nodes to the right of the source node
              const sourceWidth = estimateNodeSize(sourceNode).width;
              const horizontalGap = 60;
              const verticalGap = 30;

              let currentY = sourceY;
              const positionedNodes = newNodes.map((node) => {
                const positioned = {
                  ...node,
                  type: "file",
                  position: {
                    x: sourceX + sourceWidth + horizontalGap,
                    y: currentY,
                  },
                  data: {
                    ...node.data,
                    onSymbolHover: (...args) =>
                      symbolHoverRef.current?.(...args),
                    onExpandFile: (...args) => expandFileRef.current?.(...args),
                  },
                };
                currentY += estimateNodeSize(node).height + verticalGap;
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
                      (ce) => ce.source === e.source && ce.target === e.target,
                    ),
                );
              return [...currentEdges, ...newEdges];
            });
          }
        })
        .catch((err) => {
          console.error("Expand file error:", err);
        });
    },
    [setNodes, setEdges],
  );

  // Keep refs pointing at the latest handlers (node data holds stable wrappers)
  useEffect(() => {
    symbolHoverRef.current = handleSymbolHover;
    expandFileRef.current = handleExpandFile;
  });

  return {
    highlightedFiles,
    refs: { symbolHoverRef, expandFileRef },
  };
};
