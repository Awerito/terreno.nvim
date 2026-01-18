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

// Socket.io connection
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

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
