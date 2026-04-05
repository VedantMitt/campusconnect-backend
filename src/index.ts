import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import app from "./app";
import submissionsRoutes from "./routes/submissions.routes";
import { runMigrations } from "./migrations";

const PORT = Number(process.env.PORT) || 5000;

// Global error handlers
process.on("uncaughtException", (err) => {
  console.error("💥 UNCAUGHT EXCEPTION! Shutting down...", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("💥 UNHANDLED REJECTION! Shutting down...", err);
  process.exit(1);
});

async function startServer() {
  try {
    // 1. Run database migrations first
    await runMigrations();

    // 2. Setup routes that aren't in app.ts
    app.use("/submissions", submissionsRoutes);

    // 3. Create HTTP Server
    const httpServer = http.createServer(app);

    // --- Rooms Media Sync (Global State) ---
    type RoomState = { isPlaying: boolean; startedAt: number; pausedAt: number; };
    const activeRoomStates = new Map<string, RoomState>();
    
    // 4. Setup Socket.io
    const io = new Server(httpServer, {
      cors: {
        origin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(",").map(o => o.trim()),
        methods: ["GET", "POST"]
      }
    });
    app.set("io", io);

    io.on("connection", (socket) => {
      console.log("Client connected to socket:", socket.id);
      
      socket.on("join_chat", (conversationId) => {
        socket.join(conversationId);
      });

      socket.on("send_message", (data) => {
        socket.to(data.conversationId).emit("receive_message", data.message);
      });

      socket.on("delete_message", (data) => {
        socket.to(data.conversationId).emit("message_deleted", data.messageId);
      });

      // --- Rooms Media Sync Handlers ---
      socket.on("room_user_join", (data) => {
        if (!data.roomId) return;
        socket.join(`media_${data.roomId}`);
        socket.to(`media_${data.roomId}`).emit("room_action", { type: "JOIN", user: data.user });
        
        // Master state sync
        const state = activeRoomStates.get(data.roomId) || { isPlaying: false, startedAt: 0, pausedAt: 0 };
        socket.emit("state_update", state);

        // Legacy compatibility
        const currentTime = state.isPlaying ? (Date.now() - state.startedAt) / 1000 : state.pausedAt;
        if (state.isPlaying) {
          socket.emit("receive_sync_play", currentTime);
        } else {
          socket.emit("receive_sync_pause", currentTime);
        }
      });
      
      socket.on("room_user_leave", (data) => {
        if (!data.roomId) return;
        socket.leave(`media_${data.roomId}`);
        socket.to(`media_${data.roomId}`).emit("room_action", { type: "LEAVE", userId: data.userId });
      });

      socket.on("sync_play", (data) => {
        if (!data.roomId) return;
        let state = activeRoomStates.get(data.roomId) || { isPlaying: false, startedAt: 0, pausedAt: 0 };
        state.isPlaying = true;
        state.startedAt = Date.now() - (data.currentTime * 1000);
        activeRoomStates.set(data.roomId, state);
        
        io.to(`media_${data.roomId}`).emit("state_update", state);
        io.to(`media_${data.roomId}`).emit("receive_sync_play", data.currentTime);
      });

      socket.on("sync_pause", (data) => {
        if (!data.roomId) return;
        let state = activeRoomStates.get(data.roomId) || { isPlaying: false, startedAt: 0, pausedAt: 0 };
        state.isPlaying = false;
        state.pausedAt = data.currentTime;
        activeRoomStates.set(data.roomId, state);
        
        io.to(`media_${data.roomId}`).emit("state_update", state);
        io.to(`media_${data.roomId}`).emit("receive_sync_pause", data.currentTime);
      });

      socket.on("sync_seek", (data) => {
        if (!data.roomId) return;
        let state = activeRoomStates.get(data.roomId) || { isPlaying: false, startedAt: 0, pausedAt: 0 };
        state.pausedAt = data.currentTime;
        if (state.isPlaying) {
          state.startedAt = Date.now() - (data.currentTime * 1000);
        }
        activeRoomStates.set(data.roomId, state);
        
        io.to(`media_${data.roomId}`).emit("state_update", state);
        io.to(`media_${data.roomId}`).emit("receive_sync_seek", data.currentTime);
      });

      socket.on("request_sync", (data) => {
        if (!data.roomId) return;
        const state = activeRoomStates.get(data.roomId) || { isPlaying: false, startedAt: 0, pausedAt: 0 };
        socket.emit("state_update", state);
        
        const currentTime = state.isPlaying ? (Date.now() - state.startedAt) / 1000 : state.pausedAt;
        if (state.isPlaying) {
          socket.emit("receive_sync_play", currentTime);
        } else {
          socket.emit("receive_sync_pause", currentTime);
        }
      });

      socket.on("send_room_message", (data) => {
        if (!data.roomId) return;
        socket.to(`media_${data.roomId}`).emit("receive_room_message", data.message);
      });

      socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
      });
    });

    // 5. Finally, Listen
    httpServer.listen(PORT, () => {
      console.log(`
🚀 Server is up and running!
----------------------------
📡 Port: ${PORT}
🔗 Local: http://localhost:${PORT}
----------------------------
      `);
    }).on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Please kill the existing process or use a different port.`);
        process.exit(1);
      } else {
        console.error("❌ Failed to start server:", err);
        process.exit(1);
      }
    });

  } catch (err) {
    console.error("❌ Critical failure during startup:", err);
    process.exit(1);
  }
}

startServer();