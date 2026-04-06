const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// In-memory storage
let rooms = {};
let usersGlobal = {}; // For leaderboard: socket.id -> { name, points }

// Global points calculator & timer
setInterval(() => {
  let leaderboardChanged = false;
  const now = Date.now();

  for (let roomId in rooms) {
    let room = rooms[roomId];
    
    // Ongoing condition based on mode
    const hasStarted = room.startTime && now >= room.startTime;
    const isOngoing = room.roomMode === 'survival' ? true : room.timer > 0;

    if (hasStarted && isOngoing) {
      room.isRunning = true;
      
      // Countdown or Count up depending on mode
      if (room.roomMode === 'survival') {
          room.timer++;
      } else {
          room.timer--;
      }
      io.to(roomId).emit("timer_update", room.timer);
      
      // Points distribution
      room.users.forEach((user) => {
        if (user.status === "active") {
          if (!usersGlobal[user.id]) {
            usersGlobal[user.id] = { name: user.name, points: 0 };
          }
          usersGlobal[user.id].points += 1;
          leaderboardChanged = true;
        }
      });
      
      // Timer finished condition (only applies to commitment)
      if (room.roomMode === 'commitment' && room.timer <= 0) {
          io.to(roomId).emit("timer_ended");
          room.isRunning = false;
      }
    }
  }
  
  if (leaderboardChanged) {
    io.emit("leaderboard_update", getLeaderboard());
  }
}, 1000);

function getLeaderboard() {
  return Object.values(usersGlobal)
    .sort((a, b) => b.points - a.points)
    .slice(0, 10); // Top 10
}

app.get("/", (req, res) => {
  res.send("Backend running");
});

// Endpoint to fetch public rooms
app.get("/public-rooms", (req, res) => {
  const publicRooms = Object.keys(rooms)
    .filter(roomId => rooms[roomId].isPublic)
    .map(roomId => ({
        id: roomId,
        roomCode: rooms[roomId].roomCode,
        userCount: rooms[roomId].users.length
    }));
  res.json({ rooms: publicRooms });
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Return public rooms to requesting clients
  socket.on("get_public_rooms", () => {
    broadcastPublicRooms(socket);
  });

  // Join Room
  socket.on("join_room", ({ roomId, username, isPublic = false, roomCode, startTime, roomMode = 'commitment', duration = 1500 }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: [],
        roomMode: roomMode, // 'commitment' | 'survival'
        timer: roomMode === 'survival' ? 0 : duration, // Custom starting time or duration
        startTime: startTime || Date.now(), // Auto-start immediately if not provided
        isRunning: false,
        isPublic: isPublic,
        roomCode: isPublic ? roomCode : null, // Explicitly wipe code if it's a private room (no passwords!)
        peakUsers: 0 // Track the maximum number of people who have ever joined
      };
    }

    // Add user to global tracking if not exists
    if (!usersGlobal[socket.id]) {
        usersGlobal[socket.id] = { name: username, points: 0 };
    } else {
        // Update name in case they joined with a different name
        usersGlobal[socket.id].name = username;
    }

    // Check if user is already in the room
    const existingUser = rooms[roomId].users.find(u => u.id === socket.id);
    if (!existingUser) {
        rooms[roomId].users.push({
            id: socket.id,
            name: username,
            status: "active", // active (focused), unfocused
            isVideoOn: true,
            isAudioOn: true
        });

        // Update tracking to ensure we know if this was a multi-person room
        if (rooms[roomId].users.length > rooms[roomId].peakUsers) {
            rooms[roomId].peakUsers = rooms[roomId].users.length;
        }

    } else {
        existingUser.status = "active";
    }

    // Notify others in room
    socket.to(roomId).emit("user_joined", { id: socket.id, name: username });
    io.to(roomId).emit("update_users", rooms[roomId].users);
    
    // Send updated public rooms to everyone if it's a public room
    if (rooms[roomId].isPublic) {
        broadcastPublicRooms(io);
    }
  });

  // Focus Tracking
  socket.on("window_unfocused", (roomId) => {
    if (rooms[roomId]) {
        let user = rooms[roomId].users.find(u => u.id === socket.id);
        if (user) {
            user.status = "unfocused";
            io.to(roomId).emit("update_users", rooms[roomId].users);
        }
    }
  });

  socket.on("window_focused", (roomId) => {
    if (rooms[roomId]) {
        let user = rooms[roomId].users.find(u => u.id === socket.id);
        if (user) {
            user.status = "active";
            io.to(roomId).emit("update_users", rooms[roomId].users);
        }
    }
  });



  // Toggle Video
  socket.on("toggle_video", ({ roomId, isVideoOn }) => {
    if (rooms[roomId]) {
        let user = rooms[roomId].users.find(u => u.id === socket.id);
        if (user) {
            user.isVideoOn = isVideoOn;
            io.to(roomId).emit("update_users", rooms[roomId].users);
        }
    }
  });

  // Toggle Audio
  socket.on("toggle_audio", ({ roomId, isAudioOn }) => {
    if (rooms[roomId]) {
        let user = rooms[roomId].users.find(u => u.id === socket.id);
        if (user) {
            user.isAudioOn = isAudioOn;
            io.to(roomId).emit("update_users", rooms[roomId].users);
        }
    }
  });

  // Initial Leaderboard fetch
  socket.on("get_leaderboard", () => {
    socket.emit("leaderboard_update", getLeaderboard());
  });



  // Disconnect
  socket.on("disconnect", () => {
    for (let roomId in rooms) {
      if (rooms[roomId]) {
        // Find if user was in this room
        let userInRoom = rooms[roomId].users.find(u => u.id === socket.id);
        if (userInRoom) {
            
            // --- Commitment Penalty ---
            if (rooms[roomId].roomMode === 'commitment' && rooms[roomId].timer > 0) {
                if (usersGlobal[socket.id]) {
                    // Penalty equals the number of seconds they failed to commit to
                    usersGlobal[socket.id].points -= rooms[roomId].timer;
                }
            }

            rooms[roomId].users = rooms[roomId].users.filter((user) => user.id !== socket.id);
            
            // --- Survival Bonus ---
            // If they left and there is exactly 1 person remaining (and this room had multiple people at some point)
            if (rooms[roomId].roomMode === 'survival' && rooms[roomId].peakUsers > 1 && rooms[roomId].users.length === 1) {
                let lastUserId = rooms[roomId].users[0].id;
                if (usersGlobal[lastUserId]) {
                    usersGlobal[lastUserId].points += 500; // Flat bonus of +500 points to the last survivor
                    io.to(roomId).emit("survival_bonus_awarded", { userId: lastUserId, bonus: 500 });
                }
            }

            // If room is empty, delete it
            if (rooms[roomId].users.length === 0) {
                delete rooms[roomId];
                broadcastPublicRooms(io);
            } else {
                io.to(roomId).emit("update_users", rooms[roomId].users);
                io.to(roomId).emit("user_disconnected", socket.id);
            }
        }
      }
    }
    // We keep points in usersGlobal so they don't immediately disappear from leaderboard during short drops
  });

  function broadcastPublicRooms(targetOrIo) {
    const publicRooms = Object.keys(rooms)
        .filter(rId => rooms[rId].isPublic)
        .map(rId => ({
            id: rId,
            roomCode: rooms[rId].roomCode,
            userCount: rooms[rId].users.length
        }));
    targetOrIo.emit("public_rooms_list", publicRooms);
  }
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});