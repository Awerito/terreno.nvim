import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { spawn } from "child_process";
import { readFile } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ALLOWED_ORIGIN = /^http:\/\/localhost:\d+$/;

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 0;
const HOST = "127.0.0.1";

// Store Neovim connection info
let neovimSocket = null;
let neovimCwd = null;

// Store latest graph for new clients
let latestGraph = null;

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

/**
 * Quote a value as a Lua string literal, safe for --remote-send key notation.
 */
function luaStr(value) {
  const escaped = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/</g, "<lt>");
  return `"${escaped}"`;
}

/**
 * Coerce a request value to an integer, or throw.
 */
function luaInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`Expected integer, got ${JSON.stringify(value)}`);
  }
  return n;
}

/**
 * Resolve a path against the registered Neovim cwd; throw if it escapes it.
 */
function projectPath(filepath) {
  if (!neovimCwd) {
    throw new Error("Neovim not connected");
  }
  const full = resolve(neovimCwd, filepath);
  if (full !== neovimCwd && !full.startsWith(neovimCwd + "/")) {
    throw new Error("Path outside project");
  }
  return full;
}

// Send command to Neovim via --remote-send
function sendToNeovim(luaCommand) {
  return new Promise((resolve, reject) => {
    if (!neovimSocket) {
      reject(new Error("Neovim not connected"));
      return;
    }

    const cmd = `<Cmd>lua ${luaCommand}<CR>`;
    const nvim = spawn("nvim", [
      "--server",
      neovimSocket,
      "--remote-send",
      cmd,
    ]);

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

// Middleware
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "10mb" }));
app.use(express.static(join(__dirname, "client/dist")));

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

// API endpoint to receive expand / references results from Neovim
app.post("/api/expand-result", (req, res) => {
  const { request_id, nodes, edges, files } = req.body;
  console.log(
    "Expand result:",
    request_id,
    "nodes:",
    nodes?.length,
    "edges:",
    edges?.length,
    "files:",
    files?.length,
  );
  resolvePendingRequest(request_id, { nodes, edges, files });
  res.json({ status: "ok" });
});

// API endpoint to get LSP references for a symbol
app.post("/api/references", async (req, res) => {
  const { filepath, line } = req.body;
  console.log("References request:", { filepath, line });

  const { promise, requestId, cleanup } = createPendingRequest("refs", 5000);

  try {
    await sendToNeovim(
      `require("terreno.lsp").find_references(${luaStr(filepath)}, ${luaInt(line)}, ${luaStr(requestId)})`,
    );
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

  const { promise, requestId, cleanup } = createPendingRequest(
    "expandfile",
    15000,
  );

  try {
    await sendToNeovim(
      `require("terreno.lsp").expand_file_imports(${luaStr(filepath)}, ${luaStr(requestId)})`,
    );
    const result = await promise;
    res.json({ status: "ok", ...result });
  } catch (err) {
    cleanup();
    console.error("Expand file error:", err.message);
    res.json({ status: "ok", nodes: [], edges: [] });
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

  // Handle navigation request from browser
  socket.on("navigate", async ({ filepath, line }) => {
    console.log("Socket navigate:", { filepath, line });
    try {
      let fullPath = filepath;
      if (!filepath.startsWith("/") && neovimCwd) {
        fullPath = join(neovimCwd, filepath);
      }
      await sendToNeovim(
        `require("terreno").navigate_to(${luaStr(fullPath)}, ${luaInt(line || 0)})`,
      );
      socket.emit("navigate:success");
    } catch (err) {
      socket.emit("navigate:error", { message: err.message });
    }
  });

  // Handle code snippet request: the symbol's range when known, else context lines around it
  socket.on(
    "code:request",
    async ({ filepath, line, end_line, context }, callback) => {
      console.log("Socket code request:", { filepath, line, end_line });
      try {
        const content = await readFile(projectPath(filepath), "utf-8");
        const lines = content.split("\n");
        const ctx = context || 5;
        const hasRange = end_line && end_line > line;

        const startLine = Math.max(0, hasRange ? line - 1 : line - ctx - 1);
        const endLine = Math.min(
          lines.length,
          hasRange ? end_line : line + ctx,
        );

        const snippet = lines.slice(startLine, endLine).map((text, i) => ({
          num: startLine + i + 1,
          text,
        }));

        callback({ status: "ok", lines: snippet });
      } catch (err) {
        callback({ status: "error", message: err.message });
      }
    },
  );

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(PORT, HOST, () => {
  const actualPort = server.address().port;
  console.log(`TERRENO_PORT=${actualPort}`);
  console.log(`Terreno server running at http://${HOST}:${actualPort}`);
});
