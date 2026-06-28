// ============================================================
// SpeedRun Race Tracker — app.js (с системой логина)
// ============================================================

// === Ключи из Vercel Environment Variables ===
const SUPABASE_URL      = (window.ENV && window.ENV.SUPABASE_URL)      || 'https://bijlcubwwotzbhukbabw.supabase.co';
const SUPABASE_ANON_KEY = (window.ENV && window.ENV.SUPABASE_ANON_KEY) || 'твой_ключ_сюда';
const HOST_PASSWORD     = (window.ENV && window.ENV.HOST_PASSWORD)     || 'speedrun2025';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Состояние ────────────────────────────────────────────────
let currentRaceId     = null;
let currentPlayerId   = null;
let currentPlayerName = null;
let raceStartTime     = null;
let timerInterval     = null;
let isReady           = false;
let realtimeChannel   = null;

// НОВЫЕ ПЕРЕМЕННЫЕ ДЛЯ АВТОРИЗАЦИИ
let currentUser = null;     // { id, username, role }
let canManageCurrentRace = false; // может ли текущий пользователь управлять этой гонкой

// ============================================================
// УТИЛИТЫ
// ============================================================

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
        background:var(--surface);border:1px solid var(--primary);
        padding:12px 24px;border-radius:8px;color:var(--text);
        font-family:JetBrains Mono,monospace;font-size:0.9rem;
        box-shadow:0 10px 30px rgba(0,0,0,0.3);z-index:9999;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
}

// ============================================================
// АВТОРИЗАЦИЯ (ЛОГИН / РЕГИСТРАЦИЯ)
// ============================================================

function updateAuthUI() {
    const userInfo = document.getElementById('userInfo');
    const authBtn  = document.getElementById('authBtn');

    if (currentUser) {
        userInfo.style.display = 'flex';
        authBtn.style.display = 'none';

        document.getElementById('userNameDisplay').textContent = currentUser.username;
        
        const roleBadge = document.getElementById('userRoleDisplay');
        
        let roleText = 'ИГРОК';
        let roleColor = 'rgba(0,255,136,0.2);color:#00ff88';
        
        if (currentUser.role === 'master-host') {
            roleText = 'MASTER';
            roleColor = 'rgba(255,71,87,0.25);color:#ff4757';
        } else if (currentUser.role === 'host') {
            roleText = 'ХОСТ';
            roleColor = 'rgba(255,217,61,0.2);color:#ffd93d';
        }
        
        roleBadge.textContent = roleText;
        roleBadge.style.cssText = `background:${roleColor};padding:2px 8px;border-radius:4px;font-size:0.75rem;margin-left:6px;`;

        // Обновляем глобальную переменную
        window.isMasterHost = currentUser.role === 'master-host';
    } else {
        userInfo.style.display = 'none';
        authBtn.style.display = '';
        window.isMasterHost = false;
    }
}

function saveUserToStorage(user) {
    localStorage.setItem('speedrun_user', JSON.stringify(user));
}

function loadUserFromStorage() {
    const saved = localStorage.getItem('speedrun_user');
    if (saved) {
        try {
            currentUser = JSON.parse(saved);
            updateAuthUI();
            return true;
        } catch(e) {}
    }
    return false;
}

function logoutUser() {
    currentUser = null;
    localStorage.removeItem('speedrun_user');
    isHost = false;
    updateAuthUI();
    
    // Сбрасываем текущую сессию
    currentPlayerId = null;
    currentPlayerName = null;
    
    // Возвращаемся на список гонок
    if (currentRaceId) {
        showRaceList();
    }
    
    showToast('Вы вышли из аккаунта');
}

async function loginUser() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const errorEl  = document.getElementById('loginError');

    if (!username || !password) {
        errorEl.textContent = 'Введите имя и пароль';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const { data, error } = await db
            .from('users')
            .select('*')
            .eq('username', username)
            .eq('password', password)
            .single();

        if (error || !data) {
            errorEl.textContent = 'Неверное имя или пароль';
            errorEl.style.display = 'block';
            return;
        }

        currentUser = {
            id: data.id,
            username: data.username,
            role: data.role || 'player'
        };

        saveUserToStorage(currentUser);
        updateAuthUI();
        closeAuthModal();
        
        showToast(`Добро пожаловать, ${currentUser.username}!`);

        // Обновляем список гонок / текущий экран
        if (currentRaceId) {
            document.getElementById('hostPanel').style.display = isHost ? '' : 'none';
            loadRaceData();
        } else {
            loadRaceList();
        }

    } catch (err) {
        errorEl.textContent = 'Ошибка входа';
        errorEl.style.display = 'block';
        console.error(err);
    }
}

async function registerUser() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value.trim();
    const errorEl  = document.getElementById('registerError');

    if (!username || !password) {
        errorEl.textContent = 'Имя и пароль обязательны';
        errorEl.style.display = 'block';
        return;
    }

    if (username.length < 3) {
        errorEl.textContent = 'Имя должно быть минимум 3 символа';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const userId = username.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now().toString(36);

        // Всегда регистрируем как player
        const { error } = await db.from('users').insert({
            id: userId,
            username,
            password,
            role: 'player'
        });

        if (error) {
            if (error.code === '23505') { // unique constraint
                errorEl.textContent = 'Пользователь с таким именем уже существует';
            } else {
                errorEl.textContent = 'Ошибка регистрации: ' + error.message;
            }
            errorEl.style.display = 'block';
            return;
        }

        // Автоматический вход после регистрации
        currentUser = { id: userId, username, role: 'player' };
        saveUserToStorage(currentUser);
        updateAuthUI();
        closeAuthModal();

        showToast('Регистрация успешна!');

        if (currentRaceId) {
            document.getElementById('hostPanel').style.display = 'none';
        } else {
            loadRaceList();
        }

    } catch (err) {
        errorEl.textContent = 'Ошибка регистрации';
        errorEl.style.display = 'block';
        console.error(err);
    }
}

function showAuthModal() {
    document.getElementById('authModal').classList.add('active');
    switchAuthTab('login');
    
    // Очистка полей
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('regUsername').value = '';
    document.getElementById('regPassword').value = '';
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('registerError').style.display = 'none';
}

function closeAuthModal() {
    document.getElementById('authModal').classList.remove('active');
}

function switchAuthTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');

    if (tab === 'login') {
        loginForm.style.display = '';
        registerForm.style.display = 'none';
        loginTab.className = 'btn btn-primary';
        registerTab.className = 'btn btn-secondary';
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = '';
        loginTab.className = 'btn btn-secondary';
        registerTab.className = 'btn btn-primary';
    }
}

// ============================================================
// ЭКРАНЫ
// ============================================================

function showRaceList() {
    document.getElementById('raceListScreen').style.display = '';
    document.getElementById('raceScreen').style.display     = 'none';
    currentRaceId      = null;
    autoStartTriggered = false;
    stopTimer();
    stopCountdown();
    if (realtimeChannel) { db.removeChannel(realtimeChannel); realtimeChannel = null; }
    loadRaceList();
}

function showRaceScreen(raceId) {
    currentRaceId      = raceId;
    autoStartTriggered = false;
    document.getElementById('raceListScreen').style.display = 'none';
    document.getElementById('raceScreen').style.display     = '';
    
    canManageCurrentRace = false;
    if (currentUser) {
        if (currentUser.role === 'master-host') {
            canManageCurrentRace = true;
        }
    }
    
    document.getElementById('hostPanel').style.display = 'none';
    
    // Принудительно загружаем данные (включая started_at)
    loadRaceData();
    setupRealtimeListeners();
}

// ============================================================
// СПИСОК ГОНОК
// ============================================================

async function loadRaceList() {
    const container = document.getElementById('raceListContainer');
    container.innerHTML = '<p class="loading-text">⏳ Загрузка гонок...</p>';

    try {
        const { data: races, error } = await db
            .from('races')
            .select('*')
            .neq('status', 'finished')
            .order('started_at', { ascending: false });

        if (error) throw error;

        // Кнопка "Создать гонку" видна всем авторизованным пользователям
        const createBtn = currentUser
            ? `<button class="btn btn-primary" onclick="showCreateRace()" style="margin-bottom:1.5rem">
                 + Создать гонку
               </button>`
            : '';

        if (!races || races.length === 0) {
            container.innerHTML = createBtn + `
                <div class="empty-state">
                    <h3>🏁 Нет активных гонок</h3>
                    <p>Ожидайте, пока организатор создаст гонку</p>
                </div>`;
            return;
        }

        container.innerHTML = createBtn + races.map(race => `
            <div class="race-list-card" onclick="showRaceScreen('${race.id}')">
                <div class="race-list-info">
                    <span class="race-list-game">${race.game || 'Unknown Game'}</span>
                    <span class="race-list-category">${race.category || '---'}</span>
                    <span class="race-list-name">${race.name || race.id}</span>
                </div>
                <div class="race-list-right">
                    <span class="status-badge ${race.status}">
                        <span class="status-dot"></span>
                        <span>${statusLabel(race.status)}</span>
                    </span>
                    <span class="race-list-arrow">→</span>
                </div>
            </div>
        `).join('');

    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="empty-state"><h3>⚠️ Ошибка подключения</h3><p>${err.message}</p></div>`;
    }
}

function statusLabel(s) {
    return { waiting: 'Ожидание', active: 'Идёт гонка', finished: 'Завершена' }[s] || s;
}

function getStatusLabel(status) {
    return { 
        joined: '⏳ Присоединился', 
        ready: '✓ Готов', 
        racing: '🏃 В гонке', 
        finished: '🏁 Финиш' 
    }[status] || (status || '—');
}

// ============================================================
// ДАННЫЕ ГОНКИ
// ============================================================

async function loadRaceData() {
    if (!currentRaceId) return;
    try {
        const { data: race, error } = await db
            .from('races').select('*').eq('id', currentRaceId).single();
        if (error) throw error;
        if (race) { 
            // Сначала обновляем UI (и устанавливаем raceStartTime)
            updateRaceUI(race); 
            
            // Затем загружаем игроков (живой таймер будет работать)
            await loadPlayers(); 
            
            // Проверяем права на управление
            if (currentUser) {
                const isOwner = race.created_by === currentUser.id;
                const isMaster = currentUser.role === 'master-host';
                canManageCurrentRace = isOwner || isMaster;
                
                // Показываем панель только если есть права
                document.getElementById('hostPanel').style.display = canManageCurrentRace ? '' : 'none';
            }
        }
    } catch (err) { console.error(err); }
}

function updateRaceUI(race) {
    document.getElementById('raceGame').textContent     = race.game     || 'Unknown Game';
    document.getElementById('raceCategory').textContent = race.category || '---';
    document.getElementById('raceName').textContent     = race.name     || race.id;

    const raceNameEl = document.getElementById('raceName');
    if (raceNameEl) {
        raceNameEl.innerHTML = `${race.name || race.id} <span style="font-size:0.7em;color:#666;">(${race.id})</span>`;
    }

    const badge = document.getElementById('raceStatus');
    badge.className = 'status-badge ' + (race.status || 'waiting');
    document.getElementById('statusText').textContent = statusLabel(race.status);

    if (canManageCurrentRace) {
        const startBtn  = document.querySelector('.btn-host-start');
        const finishBtn = document.querySelector('.btn-host-finish');
        if (startBtn)  startBtn.disabled  = race.status !== 'waiting';
        if (finishBtn) finishBtn.disabled = race.status !== 'active';
    }

    // === ГЛАВНОЕ ИСПРАВЛЕНИЕ: всегда обновляем raceStartTime ===
    if (race.status === 'active' && race.started_at) {
        const newStart = new Date(race.started_at).getTime();
        if (raceStartTime !== newStart) {
            raceStartTime = newStart;
            console.log('[LiveTimer] Установлено время старта гонки:', new Date(raceStartTime));
        }
    } else {
        raceStartTime = null;
    }

    if (race.status === 'finished') {
        showRaceResults();
    } else {
        document.getElementById('raceResults').style.display = 'none';
    }
}

async function loadPlayers() {
    if (!currentRaceId) return;
    try {
        const [playersRes, readyRes] = await Promise.all([
            db.from('players').select('*').eq('race_id', currentRaceId),
            db.from('ready').select('*').eq('race_id', currentRaceId)
        ]);
        const players  = playersRes.data || [];
        const readyMap = {};
        (readyRes.data || []).forEach(r => { readyMap[r.player_id] = r.ready; });

        updatePlayersGrid(players, readyMap);
        updateReadyCount(players.length, players.filter(p => readyMap[p.id]).length);
        document.getElementById('lastUpdated').textContent =
            'Обновлено: ' + new Date().toLocaleTimeString('ru-RU');

        // Авто-старт: только если пользователь может управлять гонкой
        if (canManageCurrentRace) checkAutoStart(players, readyMap);
    } catch (err) { console.error(err); }
}

// ============================================================
// СЕТКА ИГРОКОВ (сокращённая версия для читаемости)
// ============================================================

let liveTimerInterval = null;

function updatePlayersGrid(players, readyMap) {
    const grid = document.getElementById('playersGrid');

    if (players.length === 0) {
        grid.innerHTML = '<div class="empty-state"><h3>👥 Нет участников</h3><p>Присоединяйтесь первым!</p></div>';
        stopLiveTimer();
        return;
    }

    const sorted = [...players].sort((a, b) => {
        const order = { finished: 0, racing: 1, ready: 2, joined: 3 };
        const oa = order[a.status] !== undefined ? order[a.status] : 4;
        const ob = order[b.status] !== undefined ? order[b.status] : 4;
        if (oa !== ob) return oa - ob;
        if (a.status === 'finished') return (a.total_time || 0) - (b.total_time || 0);
        return 0;
    });

    const leaderTime = sorted.reduce((min, p) =>
        p.status === 'finished' && p.total_time > 0 && p.total_time < min ? p.total_time : min,
        Infinity);

    // Получаем время старта гонки (если есть)
    const raceStart = raceStartTime || null;
    console.log('[LiveTimer] updatePlayersGrid | raceStartTime =', raceStart, '| racing players =', sorted.filter(p => p.status === 'racing').length);

    grid.innerHTML = sorted.map(p => {
        const isMe     = p.id === currentPlayerId;
        const isLeader = p.total_time === leaderTime && leaderTime !== Infinity;
        const delta    = p.total_time && leaderTime !== Infinity && !isLeader
            ? formatDelta(p.total_time - leaderTime) : null;

        const splits     = typeof p.splits      === 'string' ? JSON.parse(p.splits)      : (p.splits      || {});
        const names      = typeof p.split_names === 'string' ? JSON.parse(p.split_names) : (p.split_names || {});
        const splitCount = p.split_count || Object.keys(splits).length || 0;

        const kickBtn = canManageCurrentRace && !isMe
            ? `<button class="btn-kick" onclick="hostKickPlayer('${p.id}', event)" title="Удалить игрока">✕</button>`
            : '';

        let splitsHtml = '';
        for (let i = 0; i < splitCount; i++) {
            const key       = String(i);
            const t         = splits[key];
            const label     = names[key] || ('Split ' + (i + 1));
            const done      = t !== undefined && t !== null && t > 0;
            const isCurrent = p.current_split === i && p.status === 'racing';
            splitsHtml += `
                <li class="split-item ${isCurrent ? 'current' : ''} ${done ? 'completed' : 'pending'}">
                    <span>${label}</span>
                    <span class="split-delta ${done ? 'completed' : ''}">${done ? formatTime(t) : '---'}</span>
                </li>`;
        }

        // === ТАЙМЕР ИГРОКА ===
        let timeDisplay = '';
        const isGameTime = p.timing_method === 'GameTime';

        if (p.status === 'racing') {
            if (isGameTime) {
                // Game Time — показываем последнее известное время (статично)
                timeDisplay = `
                    <div class="player-time game-time">
                        <span style="font-size:0.75rem;color:#ffd93d;">GT</span> 
                        ${formatTime(p.total_time || 0)}
                    </div>
                `;
            } else if (raceStart) {
                // Real Time — показываем живой таймер
                timeDisplay = `
                    <div class="player-time racing-live" data-player-id="${p.id}">
                        <span class="live-time">--:--.--</span>
                    </div>
                `;
            }
        } else if (p.status === 'finished') {
            timeDisplay = `
                <div class="player-time ${isLeader ? 'leader' : (delta ? 'behind' : '')}">
                    ${isGameTime ? '<span style="font-size:0.7rem;color:#ffd93d;">GT</span> ' : ''}
                    ${formatTime(p.total_time)}
                    ${delta ? `<div style="font-size:0.75rem;color:var(--danger);margin-top:-4px;">+${delta}</div>` : ''}
                </div>
            `;
        } else {
            timeDisplay = `<div class="player-time">—</div>`;
        }

        return `
        <div class="player-card ${p.status || 'ready'} ${isMe ? 'current-player' : ''}">
            <div class="player-header">
                <div class="player-name">
                    ${p.name}
                    ${isMe ? '<em>(вы)</em>' : ''}
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                    ${kickBtn}
                    <span class="player-status ${p.status || 'ready'}">
                        ${getStatusLabel(p.status)}
                    </span>
                </div>
            </div>

            ${timeDisplay}

            ${splitCount > 0 ? `
                <ul class="splits-list">
                    ${splitsHtml}
                </ul>
            ` : ''}

            ${p.status === 'racing' && isMe ? `
                <div style="margin-top:0.5rem;font-size:0.8rem;color:var(--text-dim);text-align:center;">
                    Финиш фиксируется в LiveSplit
                </div>
            ` : ''}
        </div>`;
    }).join('');

    // Запускаем живой таймер, если есть racing игроки
    const hasRacing = sorted.some(p => p.status === 'racing' && raceStart);
    if (hasRacing) {
        startLiveTimer(raceStart);
    } else {
        stopLiveTimer();
    }
}

// === Живой таймер ===
function startLiveTimer(raceStartTimeMs) {
    stopLiveTimer();

    liveTimerInterval = setInterval(() => {
        const now = Date.now();
        const elapsed = now - raceStartTimeMs;

        document.querySelectorAll('.player-time.racing-live').forEach(el => {
            const timeSpan = el.querySelector('.live-time');
            if (timeSpan) {
                timeSpan.textContent = formatTime(elapsed);
            }
        });
    }, 80); // обновляем ~12 раз в секунду
}

function stopLiveTimer() {
    if (liveTimerInterval) {
        clearInterval(liveTimerInterval);
        liveTimerInterval = null;
    }
}

function updateReadyCount(total, ready) {
    document.getElementById('totalPlayers').textContent = total;
    document.getElementById('readyCount').textContent   = ready;
    const fill = document.getElementById('readyBarFill');
    fill.style.width = total > 0 ? `${Math.round((ready / total) * 100)}%` : '0%';
}

function formatTime(ms) {
    if (!ms) return '00:00.00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const centiseconds = Math.floor((ms % 1000) / 10);
    return `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}.${centiseconds.toString().padStart(2,'0')}`;
}

function formatDelta(ms) {
    if (!ms) return '';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const centiseconds = Math.floor((ms % 1000) / 10);
    return `${minutes}:${seconds.toString().padStart(2,'0')}.${centiseconds.toString().padStart(2,'0')}`;
}

// ============================================================
// ТАЙМЕРЫ
// ============================================================

// Таймер убран по просьбе пользователя (оставляем функции для совместимости)
function startTimer() {}
function stopTimer() {}

// Обратный отсчёт убран по просьбе пользователя
function startCountdown() {}
function stopCountdown() {}

// ============================================================
// ПРИСОЕДИНЕНИЕ К ГОНКЕ
// ============================================================

function showJoinModal() {
    if (!currentUser) {
        showAuthModal();
        return;
    }
    
    document.getElementById('joinModal').classList.add('active');
    document.getElementById('joinAsUser').textContent = currentUser.username;
}

function closeJoinModal() {
    document.getElementById('joinModal').classList.remove('active');
}

async function joinRace() {
    if (!currentUser) {
        alert('Сначала войдите в аккаунт');
        return;
    }
    if (!currentRaceId) { alert('Сначала выберите гонку'); return; }

    currentPlayerId   = currentUser.id;
    currentPlayerName = currentUser.username;

        const { error } = await db.from('players').upsert({
        id: currentPlayerId, 
        race_id: currentRaceId,
        name: currentPlayerName, 
        status: 'joined',
        current_split: 0, 
        total_time: 0,
        splits: {}, 
        split_names: {}, 
        split_count: 0
    }, { onConflict: 'id' });

    // Создаём запись в ready со значением false
    if (error) { 
        alert('Ошибка: ' + error.message); 
        return; 
    }

    await db.from('ready').upsert(
        { race_id: currentRaceId, player_id: currentPlayerId, ready: false },
        { onConflict: 'race_id,player_id' }
    );

    isReady = true;
    closeJoinModal();
    await loadPlayers();
    
    showToast('Вы присоединились к гонке!');
}

// ============================================================
// ГОТОВНОСТЬ
// ============================================================

async function toggleReady() {
    if (!currentPlayerId) { 
        showJoinModal(); 
        return; 
    }
    isReady = !isReady;
    
    // Обновляем таблицу ready
    await db.from('ready').upsert(
        { race_id: currentRaceId, player_id: currentPlayerId, ready: isReady },
        { onConflict: 'race_id,player_id' }
    );
    
    // Обновляем статус в players
    await db.from('players').update({
        status: isReady ? 'ready' : 'joined'
    }).eq('id', currentPlayerId);
    
    await loadPlayers();
}

// ============================================================
// REALTIME
// ============================================================

function setupRealtimeListeners() {
    if (realtimeChannel) db.removeChannel(realtimeChannel);
    realtimeChannel = db
        .channel('race-' + currentRaceId)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'races',   filter: 'id=eq.'      + currentRaceId },
            payload => { if (payload.new) updateRaceUI(payload.new); })
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'players', filter: 'race_id=eq.' + currentRaceId },
            () => loadPlayers())
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'ready',   filter: 'race_id=eq.' + currentRaceId },
            () => loadPlayers())
        .subscribe();
}

// ============================================================
// ХОСТ — СОЗДАНИЕ ГОНКИ
// ============================================================

function showCreateRace() {
    if (!currentUser) {
        alert('Сначала войдите в аккаунт');
        showAuthModal();
        return;
    }
    document.getElementById('createRaceModal').classList.add('active');
    
    // Генерируем красивый ID
    generateNewRaceId();
    
    document.getElementById('newRaceGame').focus();
}

function generateNewRaceId() {
    const idInput = document.getElementById('newRaceId');
    
    // Генерируем красивый ID: race_ + 6 символов
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newId = `race_${randomPart}`;
    
    idInput.value = newId;
}

function closeCreateRace() {
    document.getElementById('createRaceModal').classList.remove('active');
    ['newRaceId','newRaceName','newRaceGame','newRaceCategory'].forEach(id => {
        document.getElementById(id).value = '';
    });
}

async function submitCreateRace() {
    if (!currentUser) return;
    
    const id       = document.getElementById('newRaceId').value.trim();
    const name     = document.getElementById('newRaceName').value.trim();
    const game     = document.getElementById('newRaceGame').value.trim();
    const category = document.getElementById('newRaceCategory').value.trim();

    if (!id || !game) { alert('ID гонки и название игры обязательны'); return; }

    const { error } = await db.from('races').insert({
        id,
        name:     name || id,
        game,
        category: category || 'Any%',
        status:   'waiting',
        created_by: currentUser.id   // ← сохраняем владельца
    });

    if (error) { alert('Ошибка: ' + error.message); return; }

    closeCreateRace();
    loadRaceList();
}

// ============================================================
// АВТО-СТАРТ
// ============================================================

let autoStartTriggered = false;

async function checkAutoStart(players, readyMap) {
    const { data: race } = await db.from('races').select('status').eq('id', currentRaceId).single();
    if (!race || race.status !== 'waiting') {
        autoStartTriggered = false;
        return;
    }

    if (autoStartTriggered) return;

    const total    = players.length;
    const ready    = players.filter(p => readyMap[p.id]).length;
    const allReady = total >= 2 && ready === total;

    if (!allReady) return;

    autoStartTriggered = true;
    showAutoStartNotice();

    setTimeout(async () => {
        const startAt = new Date(Date.now() + 5000).toISOString();
        const { error } = await db.from('races')
            .update({ status: 'active', started_at: startAt })
            .eq('id', currentRaceId)
            .eq('status', 'waiting');

        if (error) {
            autoStartTriggered = false;
            console.error('Авто-старт ошибка:', error);
        } else {
            await loadRaceData();
        }
    }, 1000);
}

function showAutoStartNotice() {
    const panel = document.getElementById('hostPanel');
    if (!panel) return;
    const notice = document.createElement('span');
    notice.textContent = '🟢 Все готовы — авто-старт через 5 сек!';
    notice.style.cssText = 'color:var(--primary);font-family:JetBrains Mono,monospace;font-size:0.85rem;font-weight:600;';
    notice.id = 'autoStartNotice';
    const old = document.getElementById('autoStartNotice');
    if (old) old.remove();
    panel.appendChild(notice);
    setTimeout(() => notice.remove(), 7000);
}

// ============================================================
// ХОСТ — УПРАВЛЕНИЕ ГОНКОЙ
// ============================================================

async function hostStartRace() {
    if (!currentRaceId || !canManageCurrentRace) return;

    const delaySec = parseInt(document.getElementById('countdownSelect').value) || 10;
    if (!confirm('Запустить гонку? Отсчёт: ' + delaySec + ' сек.')) return;

    const startAt = new Date(Date.now() + delaySec * 1000).toISOString();

    const { error } = await db.from('races')
        .update({ status: 'active', started_at: startAt })
        .eq('id', currentRaceId);

    if (error) alert('Ошибка: ' + error.message);
    else await loadRaceData();
}

async function hostFinishRace() {
    if (!currentRaceId || !canManageCurrentRace) return;
    if (!confirm('Завершить гонку? Она исчезнет из списка активных.')) return;

    const { error } = await db.from('races')
        .update({ status: 'finished' })
        .eq('id', currentRaceId);

    if (error) alert('Ошибка: ' + error.message);
    else await loadRaceData();
}

async function hostKickPlayer(playerId, event) {
    event.stopPropagation();
    if (!canManageCurrentRace) return;
    if (!confirm('Удалить игрока из гонки?')) return;

    await db.from('ready').delete()
        .eq('race_id', currentRaceId).eq('player_id', playerId);
    await db.from('players').delete().eq('id', playerId);
    await loadPlayers();
}

// ═══ НОВАЯ ФУНКЦИЯ: Показать результаты гонки ═══
async function showRaceResults() {
    const container = document.getElementById('raceResultsContainer');
    const resultsDiv = document.getElementById('raceResults');

    try {
        const { data: finishedPlayers } = await db
            .from('players')
            .select('*')
            .eq('race_id', currentRaceId)
            .eq('status', 'finished')
            .order('total_time', { ascending: true });

        if (!finishedPlayers || finishedPlayers.length === 0) {
            resultsDiv.style.display = 'none';
            return;
        }

        let html = '<div style="display:flex;flex-direction:column;gap:0.5rem;">';

        finishedPlayers.forEach((p, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
            const time = formatTime(p.total_time);

            html += `
                <div style="background:var(--surface-hover);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <span style="font-size:1.4rem;">${medal}</span>
                        <span style="font-weight:600;font-family:JetBrains Mono,monospace;">${p.name}</span>
                    </div>
                    <div style="font-family:JetBrains Mono,monospace;font-size:1.1rem;color:var(--primary);font-weight:700;">
                        ${time}
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
        resultsDiv.style.display = 'block';

    } catch (err) {
        console.error('Ошибка загрузки результатов:', err);
    }
}

// ═══ Функция финиша (оставляем для совместимости) ═══
function finishMyRun() {
    alert('Финиш можно зафиксировать только через LiveSplit компонент');
}

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    // Загружаем пользователя из localStorage
    loadUserFromStorage();
    
    showRaceList();
    
    setInterval(() => {
        if (!currentRaceId) loadRaceList();
        else loadRaceData();
    }, 5000);
});

// Закрытие модалок по клику вне
document.getElementById('joinModal').addEventListener('click', e => {
    if (e.target.id === 'joinModal') closeJoinModal();
});
document.getElementById('authModal').addEventListener('click', e => {
    if (e.target.id === 'authModal') closeAuthModal();
});
document.getElementById('createRaceModal').addEventListener('click', e => {
    if (e.target.id === 'createRaceModal') closeCreateRace();
});

// Enter для форм
document.getElementById('loginPassword').addEventListener('keypress', e => {
    if (e.key === 'Enter') loginUser();
});
document.getElementById('regPassword').addEventListener('keypress', e => {
    if (e.key === 'Enter') registerUser();
});

// Стили для текущего игрока
const s = document.createElement('style');
s.textContent = `.current-player { border: 2px solid var(--primary) !important; box-shadow: 0 0 20px rgba(0,255,136,0.3); }`;
document.head.appendChild(s);