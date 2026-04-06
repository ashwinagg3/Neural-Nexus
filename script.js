const state = {
    username: "Guest_" + Math.floor(Math.random() * 1000),
    currentRoomId: null,
    isFocused: true,
    users: [],
    totalRoomSeconds: 10800, // 3 hours
    elapsedRoomSeconds: 0,
    timerInterval: null,
    media: { micOn: true, vidOn: true }
};

// Mock Server State for Demo Purposes
let mockRooms = [
    { id: '101', name: 'Deep Work Session', mode: 'Survival', participants: 12, durationHours: 2 },
    { id: '102', name: 'Study Group', mode: 'Commitment', participants: 5, durationHours: 4 },
    { id: '103', name: 'Coding Sprints', mode: 'Survival', participants: 8, durationHours: 1.5 },
];

let mockUsers = [
    { id: 'u1', name: 'Alice', status: 'active', points: 120 },
    { id: 'u2', name: 'Bob', status: 'warning', points: 95 },
    { id: 'u3', name: 'Charlie', status: 'unfocused', points: 40 },
    { id: 'u4', name: 'Dave', status: 'left', points: 10 },
];

// Add current user to mock users
mockUsers.push({ id: 'me', name: state.username, status: 'active', points: 0 });

// ====== DOM ELEMENTS ======
const views = {
    home: document.getElementById('home-page'),
    create: document.getElementById('create-room-page'),
    leaderboard: document.getElementById('global-leaderboard-page'),
    room: document.getElementById('room-page')
};

const dom = {
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
    userList: document.getElementById('user-list'),
    leaderboard: document.getElementById('leaderboard'),

    alertContainer: document.getElementById('alert-container')
};


// ====== SOCKET INITIALIZATION ======
// We initialize standard socket.io-client, treating this strictly as frontend integration code.
// The URL is empty to prevent real connection errors, and we mock the dispatch of events locally.
const socket = window.io ? window.io() : {
    emit: (event, data) => console.log(`Socket Emitted: ${event}`, data),
    on: (event, callback) => console.log(`Socket Listening for: ${event}`)
};


// ====== VIEW CONTROLLERS ======
function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
}

function renderHomeRooms() {
    dom.roomList.innerHTML = '';
    mockRooms.forEach(room => {
        const div = document.createElement('div');
        div.className = 'room-card';
        div.innerHTML = `
            <div>
                <h3>${room.name}</h3>
                <div class="room-meta">
                    <span>${room.mode}</span>
                    <span>👤 ${room.participants}</span>
                    <span>⏱ ${room.durationHours || 3}h</span>
                </div>
            </div>
            <button class="btn secondary 3d-btn" onclick="joinRoom('${room.id}', '${room.name}', '${room.mode}', ${room.durationHours || 3})"><span class="btn-content">Join Room</span></button>
        `;
        dom.roomList.appendChild(div);
    });
}

function renderRoomUsers(users) {
    if (!dom.videoGrid) return; // Prevent crashes when navigating
    dom.videoGrid.innerHTML = '';

    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'video-card float-anim';
        div.style.animationDelay = `${Math.random() * 0.5}s`;
        div.setAttribute('data-status', user.status);

        let isMe = user.id === 'me';
        let micIcon = isMe ? (state.media.micOn ? '🎤' : '🔇') : (user.status === 'left' ? '🔇' : '🎤');
        let vidIcon = isMe ? (state.media.vidOn ? '📷' : '🚫') : (user.status === 'left' ? '🚫' : '📷');

        div.innerHTML = `
            <div class="video-placeholder">👤</div>
            <div class="video-info">
                <span>${user.name} ${isMe ? '(You)' : ''}</span>
                <div class="media-status">${micIcon} ${vidIcon}</div>
            </div>
            ${(user.status !== 'active' && user.status !== 'left') ? `<div style="position: absolute; top:0; left:0; width:100%; text-align:center; background:rgba(239, 68, 68, 0.8); font-size:0.7rem; padding:4px;">${user.status.toUpperCase()}</div>` : ''}
            ${user.status === 'left' ? `<div style="position: absolute; top:0; left:0; width:100%; text-align:center; background:rgba(71, 85, 105, 0.8); font-size:0.7rem; padding:4px;">LEFT</div>` : ''}
        `;
        dom.videoGrid.appendChild(div);
    });

    if (dom.participantCount) dom.participantCount.innerText = users.length;
}

function renderLeaderboard(users) {
    dom.leaderboard.innerHTML = '';

    const sorted = [...users].sort((a, b) => b.points - a.points).slice(0, 5); // top 5

    sorted.forEach((user, index) => {
        const div = document.createElement('div');
        div.className = 'leaderboard-item';
        div.innerHTML = `
            <div class="leaderboard-rank">${index + 1}</div>
            <div class="leaderboard-details">
                <div class="leaderboard-name">${user.name}</div>
            </div>
            <div class="user-points">${user.points} pts</div>
        `;
        dom.leaderboard.appendChild(div);
    });
}

function updateTimerDisplay() {
    const totalRemaining = state.totalRoomSeconds - state.elapsedRoomSeconds;

    // Total Time Formatter
    const trHours = Math.floor(totalRemaining / 3600);
    const trMins = Math.floor((totalRemaining % 3600) / 60);
    const trSecs = totalRemaining % 60;
    let trString = '';
    if (trHours > 0) trString += trHours + 'h ';
    trString += trMins.toString().padStart(2, '0') + 'm ' + trSecs.toString().padStart(2, '0') + 's';
    dom.totalRoomTime.innerText = `Total Time Left: ${trString}`;

    // Pomodoro Logic (30 min cycle: 25 work, 5 break)
    const cycleLength = 30 * 60; // 1800s
    const currentCyclePassed = state.elapsedRoomSeconds % cycleLength;
    const sessionNum = Math.floor(state.elapsedRoomSeconds / cycleLength) + 1;

    const isWork = currentCyclePassed < (25 * 60);
    let phaseRemaining;

    if (isWork) {
        phaseRemaining = (25 * 60) - currentCyclePassed;
        dom.sessionNumber.innerText = `Session ${sessionNum}`;
        dom.timerPhaseLabel.innerText = "Focus Time Remaining";
        dom.timerDisplay.classList.remove('glow-timer-break');
    } else {
        phaseRemaining = (30 * 60) - currentCyclePassed;
        dom.sessionNumber.innerText = `Session ${sessionNum} - BREAK`;
        dom.timerPhaseLabel.innerText = "Break Time Remaining";
        dom.timerDisplay.classList.add('glow-timer-break');
    }

    // Cap phase remaining if total time runs out before the phase does
    phaseRemaining = Math.max(0, Math.min(phaseRemaining, totalRemaining));

    const pmMins = Math.floor(phaseRemaining / 60);
    const pmSecs = phaseRemaining % 60;
    dom.timerDisplay.innerText = `${pmMins.toString().padStart(2, '0')}:${pmSecs.toString().padStart(2, '0')}`;
}

function startTimer() {
    clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
        if (state.elapsedRoomSeconds < state.totalRoomSeconds) {
            state.elapsedRoomSeconds++;
            updateTimerDisplay();
        } else {
            clearInterval(state.timerInterval);
            dom.timerDisplay.innerText = "00:00";
            dom.totalRoomTime.innerText = "Room Expired";
        }
    }, 1000);
}


// ====== ACTIONS ======
window.joinRoom = function (id, name, mode, durationHours) {
    state.currentRoomId = id;
    dom.roomTitle.innerText = name || `Room ${id}`;
    dom.roomCodeDisplay.innerText = `#${id}`;
    dom.roomMode.innerText = mode || 'Survival';

    if (durationHours) {
        state.totalRoomSeconds = Math.floor(durationHours * 3600);
        state.elapsedRoomSeconds = 0;
    }

    // Reset my state
    const me = mockUsers.find(u => u.id === 'me');
    if (me) me.status = 'active';

    // Socket emit
    socket.emit('join_room', { roomId: id, username: state.username });

    // Initial render
    state.users = mockUsers; // Load mock data for UI demo
    renderRoomUsers(state.users);
    renderLeaderboard(state.users);

    updateTimerDisplay();
    startTimer();
    startFocusDetection();

    showView('room');
};

function leaveRoom() {
    state.currentRoomId = null;
    socket.emit('leave_room', {});
    clearInterval(state.timerInterval);
    stopFocusDetection();
    showView('home');
    renderHomeRooms();
}

function showAlert(message) {
    const alertEl = document.createElement('div');
    alertEl.className = 'alert';
    alertEl.innerHTML = `⚠️ ${message}`;

    dom.alertContainer.appendChild(alertEl);

    setTimeout(() => {
        alertEl.style.opacity = '0';
        alertEl.style.transform = 'translateX(100%)';
        setTimeout(() => alertEl.remove(), 300);
    }, 3000);
}


// ====== FOCUS DETECTION ======
let inactivityTimeout;

function handleFocusLost() {
    if (!state.isFocused) return;
    state.isFocused = false;

    socket.emit('focus_lost', { username: state.username });

    // Simulate UI update locally for demo
    const me = state.users.find(u => u.id === 'me');
    if (me && me.status !== 'left') {
        me.status = 'unfocused';
        renderRoomUsers(state.users);
        showAlert(`${state.username} lost focus!`);
    }
}

function handleFocusRestored() {
    if (state.isFocused) return;
    state.isFocused = true;

    socket.emit('focus_restored', { username: state.username });

    // Simulate UI update locally for demo
    const me = state.users.find(u => u.id === 'me');
    if (me && me.status !== 'left') {
        me.status = 'active';
        renderRoomUsers(state.users);
    }
}

function resetInactivityTimer() {
    if (!state.isFocused) {
        handleFocusRestored();
    }

    clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(() => {
        handleFocusLost();
    }, 10000); // 10 seconds of inactivity
}

function handleVisibilityChange() {
    if (document.hidden) {
        handleFocusLost();
    } else {
        handleFocusRestored();
        resetInactivityTimer();
    }
}

function startFocusDetection() {
    state.isFocused = true;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("mousemove", resetInactivityTimer);
    window.addEventListener("keydown", resetInactivityTimer);
    resetInactivityTimer();
}

function stopFocusDetection() {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("mousemove", resetInactivityTimer);
    window.removeEventListener("keydown", resetInactivityTimer);
    clearTimeout(inactivityTimeout);
}

// ====== BIND EVENTS ======
dom.btnToggleMic.addEventListener('click', () => {
    state.media.micOn = !state.media.micOn;
    dom.btnToggleMic.innerText = state.media.micOn ? '🎤 Mic On' : '🔇 Mic Off';
    dom.btnToggleMic.style.color = state.media.micOn ? '' : 'var(--status-unfocused)';
    renderRoomUsers(state.users);
});

dom.btnToggleVid.addEventListener('click', () => {
    state.media.vidOn = !state.media.vidOn;
    dom.btnToggleVid.innerText = state.media.vidOn ? '📷 Vid On' : '🚫 Vid Off';
    dom.btnToggleVid.style.color = state.media.vidOn ? '' : 'var(--status-unfocused)';
    renderRoomUsers(state.users);
});

dom.btnGlobalLeaderboard.addEventListener('click', () => {
    renderGlobalLeaderboard();
    showView('leaderboard');
});

dom.btnBackHomeLb.addEventListener('click', () => {
    showView('home');
});

dom.btnCreateRoom.addEventListener('click', () => {
    showView('create');
});

dom.btnBackHome.addEventListener('click', () => {
    showView('home');
});

dom.btnSubmitCreate.addEventListener('click', () => {
    const name = dom.inputCreateName.value.trim() || 'My Custom Room';
    const mode = dom.selectCreateMode.value;
    const privacy = dom.selectCreatePrivacy.value;
    let timeHours = parseFloat(dom.inputCreateTime.value);

    if (isNaN(timeHours) || timeHours <= 0) timeHours = 3;
    state.totalRoomSeconds = Math.floor(timeHours * 3600);
    state.elapsedRoomSeconds = 0;

    const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();

    if (privacy === 'Public') {
        mockRooms.unshift({ id: newRoomId, name: name, mode: mode, participants: 1, durationHours: timeHours });
        renderHomeRooms();
    }

    // Reset inputs
    dom.inputCreateName.value = '';
    dom.inputCreateTime.value = '3';
    dom.selectCreatePrivacy.value = 'Public';

    joinRoom(newRoomId, name, mode, timeHours);
});

dom.btnJoinRoom.addEventListener('click', () => {
    const code = dom.inputRoomCode.value.trim();
    if (code) {
        const room = mockRooms.find(r => r.id === code);
        const durationHours = room ? (room.durationHours || 3) : 3;
        state.totalRoomSeconds = Math.floor(durationHours * 3600); 
        state.elapsedRoomSeconds = 0;
        joinRoom(code, room ? room.name : 'Room ' + code, room ? room.mode : 'Survival', durationHours);
    }
});

dom.btnLeaveRoom.addEventListener('click', leaveRoom);


// ====== MOCK SOCKET EVENTS ======
// In a real app, these would come from the server
setInterval(() => {
    if (state.currentRoomId) {
        // Randomly simulate an opponent losing focus
        const opponents = state.users.filter(u => u.id !== 'me' && u.status !== 'left');
        if (opponents.length > 0 && Math.random() > 0.8) {
            const randomUser = opponents[Math.floor(Math.random() * opponents.length)];
            randomUser.status = 'unfocused';
            showAlert(`${randomUser.name} lost focus!`);
            renderRoomUsers(state.users);

            // restore after 3s
            setTimeout(() => {
                if (randomUser.status !== 'left') {
                    randomUser.status = 'active';
                    renderRoomUsers(state.users);
                }
            }, 3000);
        }
    }
}, 5000);

// ====== INITIALIZE ======
function renderGlobalLeaderboard() {
    dom.globalLeaderboardList.innerHTML = '';

    const globalMocks = [
        ...mockUsers.filter(u => u.id !== 'me'),
        { id: 'g1', name: 'NinjaCoder', points: 450, status: 'active' },
        { id: 'g2', name: 'DeepFocusNinja', points: 390, status: 'active' },
        { id: 'g3', name: 'StudyMachine', points: 280, status: 'active' },
        { id: 'g4', name: 'ProductivityKing', points: 190, status: 'active' },
        { id: 'me', name: state.username, points: 15, status: 'active' }
    ].sort((a, b) => b.points - a.points);

    globalMocks.forEach((user, index) => {
        const div = document.createElement('div');
        div.className = 'leaderboard-item';
        div.innerHTML = `
            <div class="leaderboard-rank">${index + 1}</div>
            <div class="leaderboard-details">
                <div class="leaderboard-name">${user.name} ${user.id === 'me' ? '(You)' : ''}</div>
            </div>
            <div class="user-points">${user.points} pts</div>
        `;
        dom.globalLeaderboardList.appendChild(div);
    });
}

dom.homeGreeting.innerText = `Welcome, ${state.username}`;
dom.homeSubtitle.innerText = `Ready to crush your goals? Dive into a deep work cycle.`;

renderHomeRooms();
