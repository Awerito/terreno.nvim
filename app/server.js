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
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

// Store Neovim connection info
let neovimSocket = null;
let neovimCwd = null;

// Cache for document symbols per file (for range detection)
const symbolsCache = new Map();

// Pending symbol requests (request_id -> { resolve, reject, timeout })
const pendingSymbolRequests = new Map();

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
  io.emit("graph:data", graph);
  res.json({ status: "ok" });
});

// Pending expand requests
const pendingExpandRequests = new Map();

// API endpoint to request node expansion
app.post("/api/expand", async (req, res) => {
  const { filepath, line, col } = req.body;
  console.log("Expand request:", { filepath, line, col });

  const requestId = `expand_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Create promise for response
  const expandPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingExpandRequests.delete(requestId);
      reject(new Error("Timeout"));
    }, 10000);
    pendingExpandRequests.set(requestId, { resolve, reject, timeout });
  });

  try {
    // Ask Neovim to expand the node
    await sendToNeovim(`require("terreno.lsp").expand_node("${filepath}", ${line}, ${col || 5}, "${requestId}")`);
    const result = await expandPromise;
    res.json({ status: "ok", ...result });
  } catch (err) {
    console.error("Expand error:", err.message);
    res.json({ status: "ok", nodes: [], edges: [] });
  }
});

// API endpoint to receive expand results from Neovim
app.post("/api/expand-result", (req, res) => {
  const { request_id, nodes, edges } = req.body;
  console.log("Expand result:", request_id, nodes?.length, "nodes", edges?.length, "edges");

  const pending = pendingExpandRequests.get(request_id);
  if (pending) {
    clearTimeout(pending.timeout);
    pending.resolve({ nodes, edges });
    pendingExpandRequests.delete(request_id);
  }

  res.json({ status: "ok" });
});

// API endpoint to receive document symbols from Neovim (for range detection)
app.post("/api/symbols", (req, res) => {
  const { request_id, filepath, symbols } = req.body;
  console.log("Symbols received:", filepath, symbols?.length, "symbols");

  // Cache the symbols
  symbolsCache.set(filepath, symbols);

  // Resolve pending request if any
  const pending = pendingSymbolRequests.get(request_id);
  if (pending) {
    clearTimeout(pending.timeout);
    pending.resolve(symbols);
    pendingSymbolRequests.delete(request_id);
  }

  res.json({ status: "ok" });
});

// Request document symbols from Neovim and wait for response
async function requestSymbols(filepath) {
  // Check cache first
  if (symbolsCache.has(filepath)) {
    console.log("Symbols cache hit:", filepath);
    return symbolsCache.get(filepath);
  }

  // Generate unique request ID
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Create promise that will be resolved when Neovim responds
  const symbolsPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingSymbolRequests.delete(requestId);
      reject(new Error("Timeout waiting for symbols"));
    }, 5000);

    pendingSymbolRequests.set(requestId, { resolve, reject, timeout });
  });

  // Ask Neovim to send document symbols
  console.log("Requesting symbols from Neovim:", filepath);
  await sendToNeovim(`require("terreno").send_document_symbols("${filepath}", "${requestId}")`);

  return symbolsPromise;
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
  console.log(`Terreno server running at http://localhost:${PORT}`);
});
