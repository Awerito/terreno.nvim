import { memo, useState, useCallback, useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import { socket } from "../utils/socket";

const KIND_ORDER = [
  "Class",
  "Function",
  "Method",
  "Variable",
  "Constant",
  "Property",
];

const FileNode = memo(({ data, id }) => {
  const [expanded, setExpanded] = useState(true);
  const [expandedSymbol, setExpandedSymbol] = useState(null);
  const [codeLines, setCodeLines] = useState([]);
  const [loadingCode, setLoadingCode] = useState(false);
  const [expandingFile, setExpandingFile] = useState(false);

  const handleNavigate = useCallback((filepath, line) => {
    socket.emit("navigate", { filepath, line: line || 1 });
  }, []);

  const handleToggle = useCallback(
    (e) => {
      e.stopPropagation();
      setExpanded(!expanded);
    },
    [expanded]
  );

  const handleExpandFile = useCallback(
    async (e) => {
      e.stopPropagation();
      if (expandingFile || !data.filepath || !data.onExpandFile) return;

      setExpandingFile(true);
      try {
        await data.onExpandFile(id, data.filepath);
      } catch (err) {
        console.error("Expand file error:", err);
      }
      setExpandingFile(false);
    },
    [data, id, expandingFile]
  );

  const handleSymbolClick = useCallback(
    (sym, e) => {
      e.stopPropagation();

      if (expandedSymbol === sym.name) {
        setExpandedSymbol(null);
        setCodeLines([]);
        return;
      }

      setLoadingCode(true);
      setExpandedSymbol(sym.name);

      socket.emit(
        "code:request",
        {
          filepath: data.filepath,
          line: sym.line,
          end_line: sym.end_line,
          name: sym.name,
          context: 2,
        },
        (response) => {
          setLoadingCode(false);
          if (response.status === "ok") {
            setCodeLines(response.lines);
          }
        }
      );
    },
    [data.filepath, expandedSymbol]
  );

  const handleSymbolDoubleClick = useCallback(
    (sym, e) => {
      e.stopPropagation();
      handleNavigate(data.filepath, sym.line);
    },
    [data.filepath, handleNavigate]
  );

  const handleSymbolHover = useCallback(
    (sym, entering) => {
      if (data.onSymbolHover) {
        data.onSymbolHover(id, sym, entering);
      }
    },
    [id, data]
  );

  const groupedSymbols = useMemo(() => {
    const groups = {};
    (data.symbols || []).forEach((sym) => {
      const kind = sym.kind || "Other";
      if (!groups[kind]) groups[kind] = [];
      groups[kind].push(sym);
    });
    return groups;
  }, [data.symbols]);

  const renderSymbol = (sym, i) => (
    <div key={i} className="symbol-item-wrapper">
      <div
        className={`symbol-item ${expandedSymbol === sym.name ? "active" : ""}`}
        onClick={(e) => handleSymbolClick(sym, e)}
        onDoubleClick={(e) => handleSymbolDoubleClick(sym, e)}
        onMouseEnter={() => handleSymbolHover(sym, true)}
        onMouseLeave={() => handleSymbolHover(sym, false)}
        title={`Click to expand • Double-click to go to line ${sym.line}`}
      >
        <span className="symbol-bullet">•</span>
        <span className="symbol-name">{sym.name}</span>
        <span className="symbol-line">:{sym.line}</span>
        <span className="symbol-expand-icon">
          {expandedSymbol === sym.name ? "−" : "+"}
        </span>
      </div>

      {expandedSymbol === sym.name && (
        <div className="symbol-code-preview">
          {loadingCode ? (
            <div className="code-loading">Loading...</div>
          ) : (
            codeLines.map((line) => (
              <div
                key={line.num}
                className={`code-line ${line.num === sym.line ? "highlight" : ""}`}
              >
                <span className="line-num">{line.num}</span>
                <span className="line-text">{line.text || " "}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={`file-node ${data.highlighted ? "highlighted" : ""}`}>
      <Handle type="target" position={Position.Left} />

      <div className="file-header" onClick={handleToggle}>
        <span className="file-icon">📄</span>
        <span className="file-name">{data.filename}</span>
        <span className="file-toggle">{expanded ? "▼" : "▶"}</span>
        <div className="file-actions">
          {!data.isExpanded && (
            <button
              className="file-expand-btn"
              onClick={handleExpandFile}
              title="Expand imports"
              disabled={expandingFile}
            >
              {expandingFile ? "..." : "⤵"}
            </button>
          )}
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
      </div>

      <div className="file-path">{data.path}</div>

      {expanded && (
        <div className="file-symbols">
          {KIND_ORDER.map((kind) =>
            groupedSymbols[kind] ? (
              <div key={kind} className="symbol-group">
                <div className="symbol-group-header">
                  {kind}s ({groupedSymbols[kind].length})
                </div>
                {groupedSymbols[kind].map((sym, i) => renderSymbol(sym, i))}
              </div>
            ) : null
          )}
          {Object.keys(groupedSymbols)
            .filter((k) => !KIND_ORDER.includes(k))
            .map((kind) => (
              <div key={kind} className="symbol-group">
                <div className="symbol-group-header">
                  {kind}s ({groupedSymbols[kind].length})
                </div>
                {groupedSymbols[kind].map((sym, i) => renderSymbol(sym, i))}
              </div>
            ))}
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
});

FileNode.displayName = "FileNode";

export default FileNode;
