const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { connectDB, User } = require("./server db.js");

connectDB();

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// In-memory storage for active rooms only
let rooms = {};

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
      
      // All modes now use countdown for the phase timer (Pomodoro style)
      room.timer--;
      room.totalTimer--;
      
      if (room.timer <= 0) {
          // Phase Transition Logic
          if (room.phase === 'Work') {
              room.phase = room.sessionCount % 4 === 0 ? 'Long Break' : 'Short Break';
              room.timer = room.phase === 'Long Break' ? 900 : 300;
              io.to(roomId).emit("alert", "Phase Complete: Time for a break.");
          } else {
              room.phase = 'Work';
              room.timer = 1500;
              room.sessionCount++;
              io.to(roomId).emit("alert", "Phase Complete: Back to work!");
          }
      }

      io.to(roomId).emit("timer_update", {
          phaseTimer: room.timer,
          totalTimer: room.totalTimer,
          phaseName: room.phase,
          session: room.sessionCount
      });
      
      // Points distribution (keep existing logic)
      const todayDate = new Date().toISOString().split('T')[0];
      room.users.forEach(async (user) => {
        if (user.status === "active") {
          // Increment global stats
          await User.findOneAndUpdate(
              { username: user.username }, 
              { $inc: { points: 1, totalFocusTime: 1 } }
          );

          // Update daily stats: Upsert an object for today's date if it doesn't exist
          await User.findOneAndUpdate(
              { username: user.username, "dailyStats.date": todayDate },
              { $inc: { "dailyStats.$.points": 1, "dailyStats.$.focusTime": 1 } },
              { new: true }
          ).then(async (updatedUser) => {
              if (!updatedUser) {
                  // Today doesn't exist yet, push new object
                  await User.findOneAndUpdate(
                      { username: user.username },
                      { $push: { dailyStats: { date: todayDate, points: 1, focusTime: 1 } } }
                  );
              }
              
              // Emit live stats update to THIS SPEFICIC user
              const todayData = updatedUser ? (updatedUser.dailyStats.find(s => s.date === todayDate) || { focusTime: 0, points: 0 }) : { focusTime: 1, points: 1 };
              io.to(user.id).emit("user_stats_update", {
                  totalPoints: (updatedUser ? updatedUser.points : 1),
                  totalFocusTime: (updatedUser ? updatedUser.totalFocusTime : 1),
                  todayPoints: todayData.points,
                  todayFocusTime: todayData.focusTime
              });
          });
        }
      });

      if (room.totalTimer <= 0) {
          io.to(roomId).emit("timer_ended");
          room.isRunning = false;
      }
    }
  }
  
  if (leaderboardChanged) {
      getLeaderboard().then(lb => io.emit("leaderboard_update", lb));
  }
}, 1000);

// Heartbeat broadcast for public rooms every 10 seconds
setInterval(() => {
    const publicRooms = Object.keys(rooms)
        .filter(rId => rooms[rId].isPublic)
        .map(rId => ({
            id: rId,
            roomName: rooms[rId].roomName,
            roomCode: rooms[rId].roomCode,
            userCount: rooms[rId].users.length
        }));
    if (publicRooms.length > 0) {
        console.log(`[HEARTBEAT] Broadcasting ${publicRooms.length} public rooms to all.`);
        io.emit("public_rooms_list", publicRooms);
    }
}, 10000);

async function getLeaderboard() {
  try {
      return await User.find().sort({ points: -1 }).limit(10);
  } catch(e) {
      return [];
  }
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
        roomName: rooms[roomId].roomName,
        roomCode: rooms[roomId].roomCode,
        userCount: rooms[roomId].userCount || rooms[roomId].users.length
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
  socket.on("join_room", (data) => {
    const { roomId, username, name, isPublic = false, roomCode, startTime, roomMode = 'commitment', duration = 1500 } = data;
    console.log(`[JOIN_ROOM] Session ${roomId} joining by ${username} with name: ${name}`);
    socket.join(roomId);

    if (!rooms[roomId]) {
      console.log(`[JOIN_ROOM] Creating new room session: ${roomId} with title: ${name}`);
      rooms[roomId] = {
        users: [],
        roomName: name || 'Focus Room', // Store the room name
        roomMode: roomMode, // 'commitment' | 'survival'
        timer: 1500, // 25 min default phase
        totalTimer: duration, // Total room duration (from user input)
        phase: 'Work',
        sessionCount: 1,
        startTime: startTime || Date.now(), 
        isRunning: false,
        isPublic: isPublic,
        roomCode: isPublic ? roomCode : null, 
        peakUsers: 0
      };
    }

    // Check if user is already in the room via socket id
    const existingUser = rooms[roomId].users.find(u => u.id === socket.id);
    if (!existingUser) {
        rooms[roomId].users.push({
            id: socket.id,
            username: username,
            name: name || firstName || username,
            status: "active",
            isVideoOn: true,
            isAudioOn: true
        });

        if (rooms[roomId].users.length > rooms[roomId].peakUsers) {
            rooms[roomId].peakUsers = rooms[roomId].users.length;
        }

    } else {
        existingUser.status = "active";
    }

    // Send room metadata to the joining socket (use roomTitle key for clarity)
    console.log(`[JOIN_ROOM] Initializing meta for ${socket.id} - Title: ${rooms[roomId].roomName}`);
    socket.emit("room_init", {
        roomTitle: rooms[roomId].roomName,
        mode: rooms[roomId].roomMode,
        duration: rooms[roomId].totalTimer,
        isPublic: rooms[roomId].isPublic
    });

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



  // Relay WebRTC signals for P2P video
  socket.on("signal", ({ to, signal, from }) => {
    io.to(to).emit("signal", { signal, from: socket.id });
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
  socket.on("get_leaderboard", async () => {
    socket.emit("leaderboard_update", await getLeaderboard());
  });

  // User Authentication via Sockets (Synchronized Flow)
    socket.on("register_user", async ({ firstName, lastName, username, phone, email, password }) => {
        try {
            const user = new User({ firstName, lastName, username, phone, email, password });
            await user.save();
            socket.emit("auth_success", { username: user.username, firstName: user.firstName });
            console.log("Registered new user:", user.username);
        } catch (err) {
            socket.emit("auth_error", "Username or email already exists.");
        }
    });

    socket.on("login_user", async ({ username, password }) => {
        try {
            const user = await User.findOne({ username, password });
            if (user) {
                socket.emit("auth_success", { username: user.username, firstName: user.firstName });
                console.log("Logged in user:", user.username);
            } else {
                socket.emit("auth_error", "Invalid username or password.");
            }
        } catch (err) {
            socket.emit("auth_error", "A database error occurred.");
        }
    });


  // User Stats Fetch
  socket.on("get_user_stats", async ({ username }) => {
    try {
        const todayDate = new Date().toISOString().split('T')[0];
        const user = await User.findOne({ username });
        if (user) {
            const todayData = user.dailyStats.find(s => s.date === todayDate) || { focusTime: 0, points: 0 };
            socket.emit("user_stats_update", {
                totalPoints: user.points,
                totalFocusTime: user.totalFocusTime,
                todayPoints: todayData.points,
                todayFocusTime: todayData.focusTime
            });
        }
    } catch(e) {}
  });

  // Disconnect
  socket.on("disconnect", async () => {
    for (let roomId in rooms) {
      if (rooms[roomId]) {
        // Find if user was in this room
        let userInRoom = rooms[roomId].users.find(u => u.id === socket.id);
        if (userInRoom) {
            
            // --- Commitment Penalty ---
            if (rooms[roomId].roomMode === 'commitment' && rooms[roomId].timer > 0) {
                // Penalty equals the number of seconds they failed to commit to
                await User.findOneAndUpdate({ username: userInRoom.username }, { $inc: { points: -rooms[roomId].timer } });
            }

            rooms[roomId].users = rooms[roomId].users.filter((user) => user.id !== socket.id);
            
            // --- Survival Bonus ---
            if (rooms[roomId].roomMode === 'survival' && rooms[roomId].peakUsers > 1 && rooms[roomId].users.length === 1) {
                let lastUser = rooms[roomId].users[0];
                await User.findOneAndUpdate({ username: lastUser.username }, { $inc: { points: 500 } });
                io.to(roomId).emit("survival_bonus_awarded", { name: lastUser.name, bonus: 500 });
            }

            // If room is empty, delete it
            if (rooms[roomId].users.length === 0) {
                delete rooms[roomId];
                broadcastPublicRooms(io);
            } else {
                io.to(roomId).emit("update_users", rooms[roomId].users);
                io.to(roomId).emit("user_disconnected", socket.id);
                // Also update the public list with the new count
                if (rooms[roomId].isPublic) {
                    broadcastPublicRooms(io);
                }
            }
        }
      }
    }
  });

  function broadcastPublicRooms(targetOrIo) {
    const publicRooms = Object.keys(rooms)
        .filter(rId => rooms[rId].isPublic)
        .map(rId => ({
            id: rId,
            roomName: rooms[rId].roomName,
            roomCode: rooms[rId].roomCode,
            userCount: rooms[rId].users.length
        }));
    console.log(`Broadcasting ${publicRooms.length} public rooms to ${targetOrIo === io ? "all sockets" : "target socket"}:`, JSON.stringify(publicRooms));
    targetOrIo.emit("public_rooms_list", publicRooms);
  }
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});
