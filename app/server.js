import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: /^http:\/\/localhost:\d+$/,
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 0;

// Store Neovim connection info
let neovimSocket = null;
let neovimCwd = null;

// Store latest graph for new clients
let latestGraph = null;

// Cache for document symbols per file (for range detection)
const symbolsCache = new Map();

// Pending requests (request_id -> { resolve, reject, cleanup })
const pendingRequests = new Map();

/**
 * Create a pending request that can be resolved externally.
 * Returns { promise, requestId, cleanup }
 */
function createPendingRequest(prefix, timeoutMs) {
  const requestId = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const { promise, resolve, reject } = Promise.withResolvers();

  const timeoutId = setTimeout(() => {
    pendingRequests.delete(requestId);
    reject(new Error(`Timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(timeoutId);
    pendingRequests.delete(requestId);
  };

  const wrappedResolve = (value) => {
    cleanup();
    resolve(value);
  };

  pendingRequests.set(requestId, { resolve: wrappedResolve, reject, cleanup });

  return { promise, requestId, cleanup };
}

/**
 * Resolve a pending request by ID
 */
function resolvePendingRequest(requestId, value) {
  const pending = pendingRequests.get(requestId);
  if (pending) {
    pending.resolve(value);
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(join(__dirname, "client/dist")));

// API endpoint for health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", neovim: !!neovimSocket });
});

// API endpoint to register Neovim socket
app.post("/api/register", (req, res) => {
  const { socket, cwd } = req.body;
  neovimSocket = socket;
  neovimCwd = cwd;
  console.log("Neovim registered:", { socket, cwd });
  io.emit("neovim:connected", { cwd });
  res.json({ status: "ok" });
});

// API endpoint to receive graph from Neovim
app.post("/api/graph", (req, res) => {
  const graph = req.body;
  console.log("Graph received from Neovim:", graph.nodes?.length, "nodes");
  // Add cwd to graph for resolving relative paths
  graph.cwd = neovimCwd;
  // Store for new clients
  latestGraph = graph;
  io.emit("graph:data", graph);
  res.json({ status: "ok" });
});

// API endpoint to request node expansion
app.post("/api/expand", async (req, res) => {
  const { filepath, line, col } = req.body;
  console.log("Expand request:", { filepath, line, col });

  const { promise, requestId, cleanup } = createPendingRequest("expand", 10000);

  try {
    await sendToNeovim(`require("terreno.lsp").expand_node("${filepath}", ${line}, ${col || 5}, "${requestId}")`);
    const result = await promise;
    res.json({ status: "ok", ...result });
  } catch (err) {
    cleanup();
    console.error("Expand error:", err.message);
    res.json({ status: "ok", nodes: [], edges: [] });
  }
});

// API endpoint to receive expand results from Neovim
app.post("/api/expand-result", (req, res) => {
  const { request_id, nodes, edges, files } = req.body;
  console.log("Expand result:", request_id, "nodes:", nodes?.length, "edges:", edges?.length, "files:", files?.length);
  resolvePendingRequest(request_id, { nodes, edges, files });
  res.json({ status: "ok" });
});

// API endpoint to get LSP references for a symbol
app.post("/api/references", async (req, res) => {
  const { filepath, line, name } = req.body;
  console.log("References request:", { filepath, line, name });

  const { promise, requestId, cleanup } = createPendingRequest("refs", 5000);

  try {
    await sendToNeovim(`require("terreno.lsp").find_references("${filepath}", ${line}, "${requestId}")`);
    const result = await promise;
    res.json({ status: "ok", files: result.files || [] });
  } catch (err) {
    cleanup();
    console.error("References error:", err.message);
    res.json({ status: "ok", files: [] });
  }
});

// API endpoint to expand a file's imports (drill down)
app.post("/api/expand-file", async (req, res) => {
  const { filepath } = req.body;
  console.log("Expand file request:", filepath);

  const { promise, requestId, cleanup } = createPendingRequest("expandfile", 15000);

  try {
    await sendToNeovim(`require("terreno.lsp").expand_file_imports("${filepath}", "${requestId}")`);
    const result = await promise;
    res.json({ status: "ok", ...result });
  } catch (err) {
    cleanup();
    console.error("Expand file error:", err.message);
    res.json({ status: "ok", nodes: [], edges: [] });
  }
});

// API endpoint to receive document symbols from Neovim (for range detection)
app.post("/api/symbols", (req, res) => {
  const { request_id, filepath, symbols } = req.body;
  console.log("Symbols received:", filepath, symbols?.length, "symbols");
  symbolsCache.set(filepath, symbols);
  resolvePendingRequest(request_id, symbols);
  res.json({ status: "ok" });
});

// Request document symbols from Neovim and wait for response
async function requestSymbols(filepath) {
  if (symbolsCache.has(filepath)) {
    console.log("Symbols cache hit:", filepath);
    return symbolsCache.get(filepath);
  }

  const { promise, requestId, cleanup } = createPendingRequest("symbols", 5000);

  try {
    console.log("Requesting symbols from Neovim:", filepath);
    await sendToNeovim(`require("terreno").send_document_symbols("${filepath}", "${requestId}")`);
    return await promise;
  } catch (err) {
    cleanup();
    throw err;
  }
}

// Find symbol in list by name and line
function findSymbolByLine(symbols, line, name) {
  if (!symbols) return null;

  // Try exact match by line
  let match = symbols.find((s) => s.line === line);
  if (match) return match;

  // Try match by name
  match = symbols.find((s) => s.name === name || s.name.endsWith("." + name));
  if (match) return match;

  return null;
}

// Send command to Neovim via --remote-send
function sendToNeovim(luaCommand) {
  return new Promise((resolve, reject) => {
    if (!neovimSocket) {
      reject(new Error("Neovim not connected"));
      return;
    }

    // Escape the Lua command for shell
    const cmd = `<Cmd>lua ${luaCommand}<CR>`;

    const nvim = spawn("nvim", ["--server", neovimSocket, "--remote-send", cmd]);

    let stderr = "";
    nvim.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    nvim.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `nvim exited with code ${code}`));
      }
    });

    nvim.on("error", (err) => {
      reject(err);
    });
  });
}

// API endpoint for navigation (browser -> Neovim)
app.post("/api/navigate", async (req, res) => {
  const { filepath, line } = req.body;
  console.log("Navigate request:", { filepath, line });

  try {
    // Resolve relative path if needed
    let fullPath = filepath;
    if (!filepath.startsWith("/") && neovimCwd) {
      fullPath = join(neovimCwd, filepath);
    }

    await sendToNeovim(`require("terreno").navigate_to("${fullPath}", ${line || 0})`);
    res.json({ status: "ok" });
  } catch (err) {
    console.error("Navigate error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// API endpoint to get code snippet
app.post("/api/code", async (req, res) => {
  const { filepath, line, context } = req.body;
  console.log("Code request:", { filepath, line, context });

  try {
    // Read file directly from server
    const fs = await import("fs/promises");
    let fullPath = filepath;
    if (!filepath.startsWith("/") && neovimCwd) {
      fullPath = join(neovimCwd, filepath);
    }

    const content = await fs.readFile(fullPath, "utf-8");
    const lines = content.split("\n");
    const ctx = context || 5;
    const startLine = Math.max(0, line - ctx - 1);
    const endLine = Math.min(lines.length, line + ctx);

    const snippet = lines.slice(startLine, endLine).map((text, i) => ({
      num: startLine + i + 1,
      text,
    }));

    res.json({ status: "ok", lines: snippet });
  } catch (err) {
    console.error("Code read error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Socket.io connection
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Send current neovim status
  if (neovimSocket) {
    socket.emit("neovim:connected", { cwd: neovimCwd });
  }

  // Send latest graph to new client
  if (latestGraph) {
    socket.emit("graph:data", latestGraph);
  }

  // Receive graph data from Neovim
  socket.on("graph:update", (data) => {
    console.log("Graph update received");
    io.emit("graph:data", data);
  });

  // Handle navigation request from browser
  socket.on("navigate", async ({ filepath, line }) => {
    console.log("Socket navigate:", { filepath, line });
    try {
      let fullPath = filepath;
      if (!filepath.startsWith("/") && neovimCwd) {
        fullPath = join(neovimCwd, filepath);
      }
      await sendToNeovim(`require("terreno").navigate_to("${fullPath}", ${line || 0})`);
      socket.emit("navigate:success");
    } catch (err) {
      socket.emit("navigate:error", { message: err.message });
    }
  });

  // Handle code snippet request
  socket.on("code:request", async ({ filepath, line, end_line, name, context }, callback) => {
    console.log("Socket code request:", { filepath, line, end_line, name });
    try {
      const fs = await import("fs/promises");
      let fullPath = filepath;
      if (!filepath.startsWith("/") && neovimCwd) {
        fullPath = join(neovimCwd, filepath);
      }

      const content = await fs.readFile(fullPath, "utf-8");
      const lines = content.split("\n");

      let startLine, endLine;

      if (end_line && end_line > line) {
        // Use the symbol's actual range from LSP
        startLine = Math.max(0, line - 1);
        endLine = Math.min(lines.length, end_line);
      } else {
        // Need to get the real range from documentSymbols
        try {
          const symbols = await requestSymbols(fullPath);
          const symbol = findSymbolByLine(symbols, line, name);

          if (symbol && symbol.end_line && symbol.end_line > symbol.line) {
            console.log("Found symbol with range:", symbol.name, symbol.line, "-", symbol.end_line);
            startLine = Math.max(0, symbol.line - 1);
            endLine = Math.min(lines.length, symbol.end_line);
          } else {
            // Fallback to context-based
            console.log("Symbol not found or no range, using context");
            const ctx = context || 5;
            startLine = Math.max(0, line - ctx - 1);
            endLine = Math.min(lines.length, line + ctx);
          }
        } catch (err) {
          // Timeout or error getting symbols, fallback to context
          console.log("Error getting symbols:", err.message);
          const ctx = context || 5;
          startLine = Math.max(0, line - ctx - 1);
          endLine = Math.min(lines.length, line + ctx);
        }
      }

      const snippet = lines.slice(startLine, endLine).map((text, i) => ({
        num: startLine + i + 1,
        text,
      }));

      callback({ status: "ok", lines: snippet });
    } catch (err) {
      callback({ status: "error", message: err.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  const actualPort = server.address().port;
  console.log(`TERRENO_PORT=${actualPort}`);
  console.log(`Terreno server running at http://localhost:${actualPort}`);
});
