import "dotenv/config";
import app from "./app";
import submissionsRoutes from "./routes/submissions.routes";

import { createServer } from "http";
import { Server } from "socket.io";

const PORT = process.env.PORT || 5000;

app.use("/submissions", submissionsRoutes); // this line was strangely at the bottom after listen!

const httpServer = createServer(app);
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
    // Expected: { conversationId, message }
    socket.to(data.conversationId).emit("receive_message", data.message);
  });

  socket.on("delete_message", (data) => {
    // Expected: { conversationId, messageId }
    socket.to(data.conversationId).emit("message_deleted", data.messageId);
  });

  // --- Rooms Media Sync ---
  socket.on("room_user_join", (data) => {
    // data: { roomId, user }
    socket.join(`media_${data.roomId}`);
    socket.to(`media_${data.roomId}`).emit("room_action", { type: "JOIN", user: data.user });
  });
  
  socket.on("room_user_leave", (data) => {
    // data: { roomId, userId }
    socket.leave(`media_${data.roomId}`);
    socket.to(`media_${data.roomId}`).emit("room_action", { type: "LEAVE", userId: data.userId });
  });

  socket.on("sync_play", (data) => {
    socket.to(`media_${data.roomId}`).emit("receive_sync_play", data.currentTime);
  });

  socket.on("sync_pause", (data) => {
    socket.to(`media_${data.roomId}`).emit("receive_sync_pause", data.currentTime);
  });

  socket.on("sync_seek", (data) => {
    socket.to(`media_${data.roomId}`).emit("receive_sync_seek", data.currentTime);
  });

  socket.on("send_room_message", (data) => {
    // data: { roomId, message }
    socket.to(`media_${data.roomId}`).emit("receive_room_message", data.message);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});