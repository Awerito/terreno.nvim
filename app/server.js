import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

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

// Serve static files from client build
app.use(express.static(join(__dirname, "client/dist")));

// API endpoint for health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Demo graph to send on connection
const demoGraph = {
  nodes: [
    { id: "1", type: "input", data: { label: "init.lua" }, position: { x: 250, y: 0 } },
    { id: "2", data: { label: "require('terreno')" }, position: { x: 250, y: 100 } },
    { id: "3", data: { label: "terreno.setup()" }, position: { x: 100, y: 200 } },
    { id: "4", data: { label: "terreno.open()" }, position: { x: 400, y: 200 } },
    { id: "5", type: "output", data: { label: "server.start()" }, position: { x: 250, y: 300 } },
  ],
  edges: [
    { id: "e1-2", source: "1", target: "2" },
    { id: "e2-3", source: "2", target: "3" },
    { id: "e2-4", source: "2", target: "4" },
    { id: "e3-5", source: "3", target: "5" },
    { id: "e4-5", source: "4", target: "5" },
  ],
};

// Socket.io connection
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Send demo graph on connection
  socket.emit("graph:data", demoGraph);

  // Receive graph data from Neovim
  socket.on("graph:update", (data) => {
    console.log("Graph update received");
    // Broadcast to all connected clients
    io.emit("graph:data", data);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Terreno server running at http://localhost:${PORT}`);
});
