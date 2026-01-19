import { useState, useCallback, useRef } from "react";
import { fetchReferences, fetchExpandFile } from "../utils/socket";

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

              const positionedNodes = newNodes.map((node, i) => ({
                ...node,
                type: "file",
                position: {
                  x: sourceX + 350,
                  y: sourceY + i * 250,
                },
                data: {
                  ...node.data,
                  onExpandCalls: (...args) => expandCallsRef.current?.(...args),
                  onSymbolHover: (...args) => symbolHoverRef.current?.(...args),
                  onExpandFile: (...args) => expandFileRef.current?.(...args),
                },
              }));

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

        const targetX = sourceX + 300;
        const nodeHeight = 90;
        const occupiedRanges = currentNodes
          .filter((n) => Math.abs(n.position.x - targetX) < 250)
          .map((n) => ({ top: n.position.y, bottom: n.position.y + 70 }));

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
