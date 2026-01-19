import { memo, useState, useCallback, useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// Custom theme based on oneDark without line backgrounds
const customTheme = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]'],
    background: "#0f172a",
  },
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]'],
    background: "transparent",
  },
};
import { socket } from "../utils/socket";

// Map file extensions to Prism language identifiers
const getLanguage = (filepath) => {
  if (!filepath) return "text";
  const ext = filepath.split(".").pop()?.toLowerCase();
  const langMap = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    lua: "lua",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sql: "sql",
    html: "html",
    css: "css",
    scss: "scss",
    vue: "vue",
    svelte: "svelte",
  };
  return langMap[ext] || "text";
};

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
        <div className="symbol-code-preview" onWheel={(e) => e.stopPropagation()}>
          {loadingCode ? (
            <div className="code-loading">Loading...</div>
          ) : (
            <SyntaxHighlighter
              language={getLanguage(data.filepath)}
              style={customTheme}
              showLineNumbers
              startingLineNumber={codeLines[0]?.num || 1}
              lineNumberStyle={{ minWidth: "2.5em", paddingRight: "1em", color: "#475569", background: "none" }}
              lineNumberContainerStyle={{ background: "none" }}
              customStyle={{
                margin: 0,
                padding: "8px",
                background: "#0f172a",
                fontSize: "11px",
                borderRadius: "4px",
              }}
              lineProps={() => ({
                style: {
                  display: "block",
                },
              })}
            >
              {codeLines.map((l) => l.text).join("\n")}
            </SyntaxHighlighter>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={`file-node no-wheel-zoom ${data.highlighted ? "highlighted" : ""}`}>
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
        <div className="file-symbols" onWheel={(e) => e.stopPropagation()}>
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
