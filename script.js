const socket = io();

const state = {
    username: localStorage.getItem('focus_user') || null,
    currentRoomId: null,
    isFocused: true,
    users: [],
    timerLimit: 0,
    timerCurrent: 0,
    firstName: localStorage.getItem('focus_fname') || '',
    media: { micOn: true, vidOn: true },
    localStream: null,
    peers: {}, // socketId -> { peer, stream }
    whitelist: [],
    researchModeTimeout: null
};

// ====== DOM ELEMENTS ======
const views = {
    welcome: document.getElementById('welcome-page'),
    login: document.getElementById('login-page'),
    register: document.getElementById('register-page'),
    home: document.getElementById('home-page'),
    create: document.getElementById('create-room-page'),
    leaderboard: document.getElementById('global-leaderboard-page'),
    room: document.getElementById('room-page')
};

const dom = {
    // Auth elements
    btnToLogin: document.getElementById('btn-to-login'),
    btnToRegister: document.getElementById('btn-to-register'),
    btnBackToWelcome1: document.getElementById('btn-back-to-welcome-1'),
    btnBackToWelcome2: document.getElementById('btn-back-to-welcome-2'),
    btnLoginSubmit: document.getElementById('btn-login-submit'),
    btnRegisterSubmit: document.getElementById('btn-register-submit'),

    loginUsername: document.getElementById('login-username'),
    loginPassword: document.getElementById('login-password'),

    regFirstname: document.getElementById('reg-firstname'),
    regLastname: document.getElementById('reg-lastname'),
    regUsername: document.getElementById('reg-username'),
    regPhone: document.getElementById('reg-phone'),
    regEmail: document.getElementById('reg-email'),
    regPassword: document.getElementById('reg-password'),

    // App elements
    homeGreeting: document.getElementById('home-greeting'),
    homeSubtitle: document.getElementById('home-subtitle'),
    btnGlobalLeaderboard: document.getElementById('btn-global-leaderboard'),
    btnBackHomeLb: document.getElementById('btn-back-home-lb'),
    globalLeaderboardList: document.getElementById('global-leaderboard-list'),

    videoGrid: document.getElementById('video-grid'),
    btnToggleMic: document.getElementById('btn-toggle-mic'),
    btnToggleVid: document.getElementById('btn-toggle-vid'),

    roomList: document.getElementById('room-list'),
    btnCreateRoom: document.getElementById('btn-create-room'),
    btnJoinRoom: document.getElementById('btn-join-room'),
    inputRoomCode: document.getElementById('input-room-code'),

    btnBackHome: document.getElementById('btn-back-home'),
    btnSubmitCreate: document.getElementById('btn-submit-create'),
    inputCreateName: document.getElementById('input-create-name'),
    selectCreateMode: document.getElementById('select-create-mode'),
    selectCreatePrivacy: document.getElementById('select-create-privacy'),
    inputCreateTime: document.getElementById('input-create-time'),

    btnLeaveRoom: document.getElementById('btn-leave-room'),
    roomTitle: document.getElementById('room-title'),
    roomCodeDisplay: document.getElementById('room-code-display'),
    roomMode: document.getElementById('room-mode'),

    totalRoomTime: document.getElementById('total-room-time'),
    sessionNumber: document.getElementById('session-number'),
    timerDisplay: document.getElementById('countdown-timer'),
    timerPhaseLabel: document.getElementById('timer-phase-label'),
    participantCount: document.getElementById('participant-count'),
    leaderboard: document.getElementById('leaderboard'),

    alertContainer: document.getElementById('alert-container')
};


// ====== WEBRTC PEER MANAGEMENT ======
function createPeer(userToSignal, callerId, stream) {
    const peer = new SimplePeer({
        initiator: true,
        trickle: false,
        stream,
    });

    peer.on("signal", signal => {
        socket.emit("signal", { to: userToSignal, from: callerId, signal });
    });

    return peer;
}

function addPeer(incomingSignal, callerId, stream) {
    const peer = new SimplePeer({
        initiator: false,
        trickle: false,
        stream,
    });

    peer.on("signal", signal => {
        socket.emit("signal", { to: callerId, signal });
    });

    peer.signal(incomingSignal);
    return peer;
}


// ====== SOCKET LISTENERS ======
socket.on("connect", () => {
    console.log("Connected to server");
    const syncMsg = document.getElementById('sync-status-msg');
    if (syncMsg) {
        syncMsg.style.color = 'var(--status-active)';
        syncMsg.innerHTML = '<span style="width: 6px; height: 6px; border-radius: 50%; background: var(--status-active); box-shadow: 0 0 8px var(--status-active);"></span> CONNECTED TO GLOBAL SERVER • SYNCHRONIZATION ACTIVE';
    }
    socket.emit("get_public_rooms");
    socket.emit("get_leaderboard");
});

socket.on("disconnect", () => {
    console.log("Disconnected from server");
    const syncMsg = document.getElementById('sync-status-msg');
    if (syncMsg) {
        syncMsg.style.color = 'var(--status-error)';
        syncMsg.innerHTML = '<span style="width: 6px; height: 6px; border-radius: 50%; background: var(--status-error); box-shadow: 0 0 8px var(--status-error);"></span> DISCONNECTED FROM SERVER • RECONNECTING...';
    }
});

socket.on("public_rooms_list", (rooms) => {
    renderHomeRooms(rooms);
});

socket.on("update_users", (users) => {
    state.users = users;
    renderRoomUsers(users);
});

socket.on("timer_update", (timerData) => {
    state.timerCurrent = timerData.phaseTimer;
    state.totalTimerRemaining = timerData.totalTimer;
    state.currentPhase = timerData.phaseName;
    state.sessionCount = timerData.session;
    updateTimerDisplay();
});

socket.on("leaderboard_update", (leaderboard) => {
    renderLeaderboard(leaderboard);
});

socket.on("timer_ended", () => {
    showAlert("The session has ended. Excellent work!");
});

socket.on("survival_bonus_awarded", ({ userId, bonus }) => {
    const user = state.users.find(u => u.id === userId);
    if (user) {
        showAlert(`${user.name} is the last survivor! +${bonus} points awarded!`);
    }
});

socket.on("signal", data => {
    const { from, signal } = data;
    if (state.peers[from]) {
        state.peers[from].peer.signal(signal);
    } else {
        const peer = addPeer(signal, from, state.localStream);
        state.peers[from] = { peer };
        
        peer.on("stream", stream => {
            state.peers[from].stream = stream;
            renderRoomUsers(state.users);
        });

        peer.on("error", err => {
            console.error("Peer error:", err);
            delete state.peers[from];
        });
    }
});

socket.on("user_joined", ({ id, name }) => {
    showAlert(`${name} joined the Room.`);
    if (id !== socket.id && state.localStream) {
        // I initiate connection to the new user if I have my stream
        const peer = createPeer(id, socket.id, state.localStream);
        state.peers[id] = { peer };
        
        peer.on("stream", stream => {
            state.peers[id].stream = stream;
            renderRoomUsers(state.users);
        });

        peer.on("error", err => {
            console.error("Peer error:", err);
            delete state.peers[id];
        });
    }
});

socket.on("user_disconnected", (userId) => {
    if (state.peers[userId]) {
        state.peers[userId].peer.destroy();
        delete state.peers[userId];
    }
    renderRoomUsers(state.users);
});


socket.on("user_stats_update", (stats) => {
    const dailyMins = Math.floor(stats.todayFocusTime / 60);
    const dailyHours = Math.floor(dailyMins / 60);
    const remMins = dailyMins % 60;
    
    const timeStr = dailyHours > 0 ? `${dailyHours}h ${remMins}m` : `${remMins}m`;

    if (document.getElementById('stat-daily-time')) {
        document.getElementById('stat-daily-time').innerText = timeStr;
        document.getElementById('stat-daily-points').innerText = `${Math.floor(stats.todayPoints)} pts`;
        document.getElementById('stat-total-points').innerText = `${Math.floor(stats.totalPoints)} pts`;
        
        // Strength (Streak) Logic
        const streakEl = document.getElementById("stat-streak");
        const restoreContainer = document.getElementById("streak-restore-container");
        
        if (stats.isStreakBroken && stats.canRestore) {
            streakEl.innerText = "BROKEN";
            streakEl.style.color = "#ff5252"; 
            restoreContainer.classList.remove("hidden");
        } else {
            streakEl.innerText = `${stats.currentStreak || 0} Days`;
            streakEl.style.color = "#f4511e";
            restoreContainer.classList.add("hidden");
        }
    }
});

// Streak Restoration Listener
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'btn-restore-streak') {
        e.preventDefault();
        if (confirm("Redeem 500 points to restore your laboratory streak?")) {
            socket.emit("restore_streak", { username: state.username });
        }
    }
});

// ====== VIEW CONTROLLERS ======
function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');

    // Reset title if not in session room
    if (viewName !== 'room') {
        document.title = "FocusRoom | Elite-Tier Productivity";
    }
}

function renderHomeRooms(rooms) {
    console.log("Rendering home rooms:", rooms.length);
    dom.roomList.innerHTML = '';
    if (rooms.length === 0) {
        dom.roomList.innerHTML = '<p style="color: var(--text-muted); grid-column: 1/-1; text-align: center;">No public rooms currently active.</p>';
        return;
    }
    rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = 'room-card glass-panel';
        div.innerHTML = `
            <div style="flex: 1;">
                <div class="mantra-label">PUBLIC ROOM</div>
                <h3 style="margin-bottom: 0.25rem;">${room.roomName || 'Focus Room'}</h3>
                <div class="room-meta" style="margin-bottom: 0;">
                    <span>#${room.roomCode} • 👤 ${room.userCount} Participants</span>
                </div>
            </div>
            <button class="btn primary" onclick="joinRoom('${room.id}', '${room.roomName || 'Public Room'}', 'Survival', 1, true)">Join Session</button>
        `;
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '1.5rem';
        dom.roomList.appendChild(div);
    });
}

function renderRoomUsers(users) {
    if (!dom.videoGrid) return;
    dom.videoGrid.innerHTML = '';

    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'video-card float-anim';
        div.style.animationDelay = `${Math.random() * 0.5}s`;
        div.setAttribute('data-status', user.status);

        let isMe = user.username === state.username || user.id === socket.id;
        let micIcon = user.isAudioOn ? '🎤' : '🔇';
        let vidIcon = user.isVideoOn ? '📷' : '🚫';

        div.innerHTML = `
            <video class="user-video ${isMe ? 'local-video' : ''}" autoplay playsinline ${isMe ? 'muted' : ''}></video>
            <div class="video-placeholder ${user.isVideoOn ? 'hidden' : ''}">
                <div class="avatar-circle">${user.name[0].toUpperCase()}</div>
                <div class="avatar-name">${user.name}</div>
            </div>
            <div class="video-info">
                <span>${user.name} ${isMe ? '(You)' : ''}</span>
                <div class="media-status">${micIcon} ${vidIcon}</div>
            </div>
            ${(user.status !== 'active') ? `<div class="status-overlay">${user.status.toUpperCase()}</div>` : ''}
        `;
        dom.videoGrid.appendChild(div);

        if (isMe && state.localStream && user.isVideoOn) {
            const videoEl = div.querySelector('video');
            videoEl.srcObject = state.localStream;
        } else if (!isMe && state.peers[user.id] && state.peers[user.id].stream && user.isVideoOn) {
            const videoEl = div.querySelector('video');
            videoEl.srcObject = state.peers[user.id].stream;
        }
    });

    if (dom.participantCount) dom.participantCount.innerText = users.length;
}

function renderLeaderboard(leaderboard) {
    dom.leaderboard.innerHTML = '';
    leaderboard.slice(0, 5).forEach((user, index) => {
        const div = document.createElement('div');
        div.className = 'leaderboard-item';
        div.innerHTML = `
            <div class="leaderboard-rank">${index + 1}</div>
            <div class="leaderboard-details">
                <div class="leaderboard-name">${user.username}</div>
            </div>
            <div class="user-points">${Math.floor(user.points)} pts</div>
        `;
        dom.leaderboard.appendChild(div);
    });

    // Also update global leaderboard page if it's visible
    if (!views.leaderboard.classList.contains('hidden')) {
        renderGlobalLeaderboardPage(leaderboard);
    }
}

function updateTimerDisplay() {
    const totalRemaining = state.timerCurrent;
    const isSurvival = dom.roomMode.innerText.toLowerCase() === 'survival';

    // Countdown or Countup logic
    const trMins = Math.floor(totalRemaining / 60);
    const trSecs = totalRemaining % 60;
    const timeStr = `${trMins.toString().padStart(2, '0')}:${trSecs.toString().padStart(2, '0')}`;

    // Total Room Time (Left Panel)
    const overallTotal = state.totalTimerRemaining || 0;
    const oh = Math.floor(overallTotal / 3600);
    const om = Math.floor((overallTotal % 3600) / 60);
    const os = overallTotal % 60;

    dom.totalRoomTime.innerText = `${oh}h ${om}m ${os}s`;
    dom.sessionNumber.innerText = state.sessionCount || 1;
    dom.timerDisplay.innerText = timeStr;
    dom.timerPhaseLabel.innerText = state.currentPhase || "Focusing...";

    // Tab-Bar Dynamic Synchronization
    const phase = state.currentPhase || "Work";
    document.title = `[${phase}] ${timeStr} | FocusRoom`;
}

async function requestMediaPermissions() {
    try {
        state.localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        console.log("Media permissions granted");
        renderRoomUsers(state.users);
    } catch (err) {
        showAlert("Camera/Mic access denied. Using avatar instead.");
    }
}


socket.on("room_init", (data) => {
    console.log("[ROOM_INIT] Received:", data);
    dom.roomTitle.innerText = data.roomTitle || "Focus Room";
    dom.roomMode.innerText = data.mode ? data.mode.charAt(0).toUpperCase() + data.mode.slice(1) : "Survival";
    
    // --- Research Whitelist Integration ---
    state.whitelist = data.whitelist || [];
    renderResearchList();
});

function renderResearchList() {
    const list = document.getElementById("room-research-list");
    if (!list) return;

    list.innerHTML = "";
    if (state.whitelist.length === 0) {
        list.innerHTML = `<span style="font-size: 0.65rem; color: var(--text-muted);">No whitelisted resources for this session.</span>`;
        return;
    }

    state.whitelist.forEach(site => {
        const link = document.createElement("button");
        link.className = "btn-pill";
        link.style.width = "100%";
        link.style.justifyContent = "flex-start";
        link.style.fontSize = "0.7rem";
        link.style.background = "rgba(0, 229, 255, 0.05)";
        link.style.border = "1px solid rgba(0, 229, 255, 0.1)";
        link.innerHTML = `<span style="font-size: 0.8rem; margin-right: 0.5rem;">🚀</span> Launch ${site}`;
        link.onclick = () => launchResearchSite(site);
        list.appendChild(link);
    });
}

// ====== ACTIONS ======
window.joinRoom = async function (id, name, mode, durationHours, isPublic = true, whitelist = "") {
    state.currentRoomId = id;
    dom.roomTitle.innerText = name || `Focus Session`;
    dom.roomCodeDisplay.innerText = `#${id.slice(0, 4)}`;
    dom.roomMode.innerText = mode || 'Survival';

    // Wait for media before joining logic
    await requestMediaPermissions();

    // Socket Join
    socket.emit('join_room', {
        roomId: id,
        username: state.username,
        name: name,
        roomCode: id, 
        roomMode: mode.toLowerCase(),
        duration: Math.floor(durationHours * 3600),
        isPublic: isPublic,
        whitelist: whitelist
    });

    startFocusDetection();
    showView('room');
};

function leaveRoom() {
    window.location.reload(); // Hard reset for clean disconnect and re-init
}

window.appendWhitelist = function(domain) {
    const input = document.getElementById("input-create-whitelist");
    if (!input) return;

    let current = input.value.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
    if (!current.includes(domain)) {
        current.push(domain);
        input.value = current.join(', ');
        // Visual feedback
        const btn = Array.from(document.querySelectorAll('.whitelist-suggestions button'))
                         .find(b => b.innerText.toLowerCase().includes(domain.split('.')[0]));
        if (btn) {
            btn.style.borderColor = 'var(--status-active)';
            btn.style.color = 'var(--status-active)';
        }
    }
}

function showAlert(message, type = 'error') {
    const icon = type === 'error' ? '⚡' : '✨';
    const title = type === 'error' ? 'System Warning' : 'Update Success';
    
    const alertEl = document.createElement('div');
    alertEl.className = `alert ${type}`;
    alertEl.innerHTML = `
        <div class="alert-icon">${icon}</div>
        <div class="alert-content">
            <div class="alert-title">${title}</div>
            <div class="alert-message">${message}</div>
        </div>
    `;

    dom.alertContainer.appendChild(alertEl);

    setTimeout(() => {
        alertEl.style.opacity = '0';
        alertEl.style.transform = 'translateY(-20px)';
        setTimeout(() => alertEl.remove(), 400);
    }, 4500);
}


// ====== FOCUS DETECTION ======
let inactivityTimeout;

function handleFocusLost() {
    if (!state.isFocused) return;
    state.isFocused = false;
    socket.emit('window_unfocused', state.currentRoomId);
    showAlert(`Focus Lost! Warnings recorded.`);
}

function handleFocusRestored() {
    if (state.isFocused) return;
    state.isFocused = true;
    socket.emit('window_focused', state.currentRoomId);
}

function resetInactivityTimer() {
    if (!state.isFocused) handleFocusRestored();
    clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(() => {
        handleFocusLost();
    }, 15000); // 15 seconds
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // --- Research Mode Bypassing ---
      if (state.researchModeTimeout) {
          console.log("[LAB_TRUST] Focus lost but researcher is in an active Research Mode. Silencing alert.");
          return; // Skip alert
      }

      socket.emit("focus_lost", {
        username: state.username,
        userId: socket.id
      });
    }
  });

// Launch a whitelisted site in a new tab and activate 'Research Mode' (60s grace)
function launchResearchSite(url) {
    if (state.researchModeTimeout) clearTimeout(state.researchModeTimeout);
    
    // Standard Laboratory Protocol: Activate Trust Bridge for 60 seconds
    state.researchModeTimeout = setTimeout(() => {
        state.researchModeTimeout = null;
        console.log("[LAB_TRUST] Research mode expired. Focus enforcement resumed.");
    }, 60000); // 60s grace

    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    window.open(fullUrl, '_blank');
}

function startFocusDetection() {
    state.isFocused = true;
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) handleFocusLost(); else handleFocusRestored();
    });
    window.addEventListener("mousemove", resetInactivityTimer);
    window.addEventListener("keydown", resetInactivityTimer);
    resetInactivityTimer();
}


// ====== BIND EVENTS ======
dom.btnToggleMic.addEventListener('click', () => {
    state.media.micOn = !state.media.micOn;
    dom.btnToggleMic.innerText = state.media.micOn ? '🎤 Audio' : '🔇 Muted';
    dom.btnToggleMic.style.color = state.media.micOn ? '' : '#ff4d4d';
    
    // Toggle track
    if (state.localStream) {
        state.localStream.getAudioTracks().forEach(t => t.enabled = state.media.micOn);
    }
    
    socket.emit('toggle_audio', { roomId: state.currentRoomId, isAudioOn: state.media.micOn });
});

dom.btnToggleVid.addEventListener('click', () => {
    state.media.vidOn = !state.media.vidOn;
    dom.btnToggleVid.innerText = state.media.vidOn ? '📷 Video' : '🚫 Hidden';
    dom.btnToggleVid.style.color = state.media.vidOn ? '' : '#ff4d4d';
    
    // Toggle track
    if (state.localStream) {
        state.localStream.getVideoTracks().forEach(t => t.enabled = state.media.vidOn);
    }
    
    socket.emit('toggle_video', { roomId: state.currentRoomId, isVideoOn: state.media.vidOn });
});

dom.btnGlobalLeaderboard.addEventListener('click', () => {
    socket.emit("get_leaderboard");
    showView('leaderboard');
});

dom.btnBackHomeLb.addEventListener('click', () => showView('home'));
dom.btnCreateRoom.addEventListener('click', () => showView('create'));
dom.btnBackHome.addEventListener('click', () => showView('home'));

dom.btnSubmitCreate.addEventListener('click', () => {
    const name = dom.inputCreateName.value.trim() || 'My Focus Room';
    const mode = dom.selectCreateMode.value;
    const privacy = dom.selectCreatePrivacy.value;
    const whitelist = document.getElementById("input-create-whitelist").value.trim();
    let timeHours = parseFloat(dom.inputCreateTime.value) || 1;

    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Reset inputs
    dom.inputCreateName.value = '';
    dom.inputCreateTime.value = '1';
    document.getElementById("input-create-whitelist").value = '';

    // Use our new joinRoom function!
    joinRoom(newRoomId, name, mode, timeHours, privacy === 'Public', whitelist);
});

dom.btnJoinRoom.addEventListener('click', () => {
    const code = dom.inputRoomCode.value.trim();
    if (code) {
        joinRoom(code, 'Custom Room', 'Survival', 1);
    }
});

dom.btnLeaveRoom.addEventListener('click', leaveRoom);

function renderGlobalLeaderboardPage(leaderboard) {
    dom.globalLeaderboardList.innerHTML = '';
    leaderboard.forEach((user, index) => {
        const div = document.createElement('div');
        div.className = 'leaderboard-item';
        div.innerHTML = `
            <div class="leaderboard-rank">${index + 1}</div>
            <div class="leaderboard-details">
                <div class="leaderboard-name">${user.username}</div>
            </div>
            <div class="user-points">${Math.floor(user.points)} pts</div>
        `;
        dom.globalLeaderboardList.appendChild(div);
    });
}

// ====== DOM ELEMENTS EXTENSIONS ======
dom.btnCopyCode = document.getElementById('btn-copy-code');
dom.statScore = document.getElementById('stat-score');

// ====== ENHANCED SOCKET LISTENERS ======

// ====== ENHANCED ACTIONS ======
function copyRoomCode() {
    const code = dom.roomCodeDisplay.innerText.replace('#', '');
    navigator.clipboard.writeText(code).then(() => {
        showAlert("Room ID copied to clipboard!");
        dom.btnCopyCode.style.color = 'var(--status-active)';
        setTimeout(() => dom.btnCopyCode.style.color = '', 2000);
    });
}

function updateProductivityScore() {
    if (!state.currentRoomId) return;
    
    // Simple simulation: active = 100%, unfocused = 20%
    const base = state.isFocused ? 100 : 20;
    const jitter = Math.floor(Math.random() * 10);
    const score = Math.max(0, Math.min(100, base - jitter));
    
    dom.statScore.innerText = `${score}%`;
    dom.statScore.style.color = score > 70 ? 'var(--status-active)' : (score > 40 ? 'var(--status-warning)' : 'var(--status-error)');
}

// ====== KEYBOARD SHORTCUTS ======
window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;
    
    if (e.key.toLowerCase() === 'm') dom.btnToggleMic.click();
    if (e.key.toLowerCase() === 'v') dom.btnToggleVid.click();
    if (e.key.toLowerCase() === 'c') copyRoomCode();
});

dom.btnCopyCode.addEventListener('click', copyRoomCode);

// Productivity Score Tick
setInterval(updateProductivityScore, 5000);

// ====== AUTHENTICATION BINDINGS ======
dom.btnToLogin.addEventListener('click', () => showView('login'));
dom.btnToRegister.addEventListener('click', () => showView('register'));
dom.btnBackToWelcome1.addEventListener('click', () => showView('welcome'));
dom.btnBackToWelcome2.addEventListener('click', () => showView('welcome'));
document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('focus_user');
    window.location.reload();
});

dom.btnRegisterSubmit.addEventListener('click', () => {
    const data = {
        firstName: dom.regFirstname.value.trim(),
        lastName: dom.regLastname.value.trim(),
        username: dom.regUsername.value.trim(),
        phone: dom.regPhone.value.trim(),
        email: dom.regEmail.value.trim(),
        password: dom.regPassword.value
    };

    if (!data.username || !data.password || !data.email) {
        showAlert("Please fill in all required fields.");
        return;
    }

    socket.emit("register_user", data);
});

dom.btnLoginSubmit.addEventListener('click', () => {
    const username = dom.loginUsername.value.trim();
    const password = dom.loginPassword.value;

    // Admin override for demo
    if (username === 'admin' && password === 'admin') {
        localStorage.setItem('focus_user', 'admin');
        localStorage.setItem('focus_fname', 'System');
        state.username = 'admin';
        state.firstName = 'System';
        initUserSession();
        return;
    }

    socket.emit("login_user", { username, password });
});

socket.on("auth_success", ({ username, firstName }) => {
    localStorage.setItem('focus_user', username);
    localStorage.setItem('focus_fname', firstName);
    state.username = username;
    state.firstName = firstName;
    showAlert(`Welcome back, ${firstName}!`, 'success');
    initUserSession();
});

socket.on("auth_error", (error) => {
    showAlert(error);
});

function initUserSession() {
    console.log("Initializing user session for:", state.firstName || state.username);
    dom.homeGreeting.innerText = `Welcome, ${state.firstName || state.username}`;
    dom.homeSubtitle.innerText = `Synchronization active. Ready to focus?`;
    socket.emit("get_public_rooms");
    socket.emit("get_leaderboard");
    socket.emit("get_user_stats", { username: state.username });
    showView('home');
}


// Global Refresh Binding
document.getElementById('btn-refresh-rooms').addEventListener('click', () => {
    socket.emit("get_public_rooms");
    showAlert("Updating room list...");
});

// Fallback Sync
setTimeout(() => {
    if (state.username) socket.emit("get_public_rooms");
}, 1500);

// ====== INITIALIZE ======
if (state.username) {
    initUserSession();
} else {
    showView('welcome');
}
