import express from "express";
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

// Middleware
app.use(express.json());
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
  socket.on("code:request", async ({ filepath, line, context }, callback) => {
    console.log("Socket code request:", { filepath, line, context });
    try {
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
