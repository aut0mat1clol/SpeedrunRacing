// ============================================================
// SpeedRun Race Tracker — app.js (с системой логина)
// ============================================================

// === Ключи берутся из config.js (не попадает в Git) ===
const SUPABASE_URL      = window.SUPABASE_URL      || 'https://bijlcubwwotzbhukbabw.supabase.co';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'твой_ключ_сюда';
const HOST_PASSWORD     = window.HOST_PASSWORD     || 'speedrun2025';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// URL безопасной Edge Function, которая проверяет через Twitch API,
// кто из игроков сейчас реально стримит (Client Secret хранится только
// на сервере, в браузер он никогда не попадает).
const TWITCH_LIVE_FN_URL = `${SUPABASE_URL}/functions/v1/bright-task`;

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

function tr(key, vars) {
    return (typeof window.t === 'function') ? window.t(key, vars) : key;
}

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
    const createRaceBtn = document.getElementById('createRaceBtn');

    // Кнопка "Создать гонку" в шапке — только для залогиненных
    if (createRaceBtn) createRaceBtn.style.display = currentUser ? '' : 'none';

    if (currentUser) {
        if (userInfo) userInfo.style.display = 'flex';
        if (authBtn)  authBtn.style.display = 'none';

        const nameEl = document.getElementById('userNameDisplay');
        if (nameEl) nameEl.textContent = currentUser.username;
        window.currentUserProfileLink = '#profile/' + encodeURIComponent(currentUser.username);

        const roleBadge = document.getElementById('userRoleDisplay');

        let roleText = (typeof getCurrentLang === 'function' && getCurrentLang() === 'en') ? 'PLAYER' : 'ИГРОК';
        let roleColor = 'background:var(--primary-soft);color:var(--primary)';

        if (currentUser.role === 'master-host') {
            roleText = 'MASTER';
            roleColor = 'background:rgba(224,80,63,0.18);color:#e0503f';
        } else if (currentUser.role === 'host') {
            roleText = (typeof getCurrentLang === 'function' && getCurrentLang() === 'en') ? 'HOST' : 'ХОСТ';
            roleColor = 'background:rgba(232,168,48,0.18);color:#e8a830';
        }

        if (roleBadge) {
            roleBadge.textContent = roleText;
            roleBadge.style.cssText = `${roleColor};padding:3px 9px;border-radius:999px;font-size:0.7rem;font-weight:900;letter-spacing:.5px;`;
        }

        // Обновляем глобальную переменную
        window.isMasterHost = currentUser.role === 'master-host';
    } else {
        if (userInfo) userInfo.style.display = 'none';
        if (authBtn)  authBtn.style.display = '';
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
    
    showToast(tr('toast.loggedOut'));
}

async function loginUser() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const errorEl  = document.getElementById('loginError');

    if (!username || !password) {
        errorEl.textContent = tr('auth.err.required');
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
            errorEl.textContent = tr('auth.err.invalid');
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
        
        showToast(tr('toast.welcome', { name: currentUser.username }));

        // Обновляем список гонок / текущий экран
        if (currentRaceId) {
            document.getElementById('hostPanel').style.display = isHost ? '' : 'none';
            loadRaceData();
        } else {
            loadRaceList();
        }

    } catch (err) {
        errorEl.textContent = tr('auth.err.login');
        errorEl.style.display = 'block';
        console.error(err);
    }
}

async function registerUser() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value.trim();
    const errorEl  = document.getElementById('registerError');

    if (!username || !password) {
        errorEl.textContent = tr('auth.err.requiredRegister');
        errorEl.style.display = 'block';
        return;
    }

    if (username.length < 3) {
        errorEl.textContent = tr('auth.err.usernameShort');
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
                errorEl.textContent = tr('auth.err.userExists');
            } else {
                errorEl.textContent = tr('auth.err.registerPrefix') + error.message;
            }
            errorEl.style.display = 'block';
            return;
        }

        // Автоматический вход после регистрации
        currentUser = { id: userId, username, role: 'player' };
        saveUserToStorage(currentUser);
        updateAuthUI();
        closeAuthModal();

        showToast(tr('toast.registerSuccess'));

        // Обновляем счётчик зарегистрированных пользователей на главной.
        loadUserCount();

        if (currentRaceId) {
            document.getElementById('hostPanel').style.display = 'none';
        } else {
            loadRaceList();
        }

    } catch (err) {
        errorEl.textContent = tr('auth.err.register');
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
// TWITCH — настройки в профиле (через модалку)
// ============================================================

// Приводим ввод пользователя к чистому нику канала
function normalizeTwitchUsername(raw) {
    if (!raw) return '';
    let v = raw.trim();
    const m = v.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
    if (m) v = m[1];
    v = v.replace(/^@/, '').trim().toLowerCase();
    return v;
}

async function showTwitchSettingsModal() {
    if (!currentUser) { showAuthModal(); return; }
    const input = document.getElementById('profileTwitchUsername');
    const errEl = document.getElementById('twitchSettingsError');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    if (input) input.value = '';
    document.getElementById('twitchSettingsModal').classList.add('active');
    // подтянуть текущее значение
    try {
        const { data } = await db.from('users').select('twitch_username').eq('id', currentUser.id).maybeSingle();
        if (input && data && data.twitch_username) input.value = data.twitch_username;
        if (input) input.focus();
    } catch(e) {}
}

function closeTwitchSettingsModal() {
    document.getElementById('twitchSettingsModal').classList.remove('active');
}

async function saveTwitchSettings() {
    if (!currentUser) return;
    const input = document.getElementById('profileTwitchUsername');
    const errEl = document.getElementById('twitchSettingsError');
    const raw = input ? input.value : '';
    const twitch = normalizeTwitchUsername(raw);

    if (twitch && !/^[a-zA-Z0-9_]{2,25}$/.test(twitch)) {
        if (errEl) { errEl.textContent = tr('profileSettings.err.invalid'); errEl.style.display = 'block'; }
        else showToast(tr('profileSettings.err.invalid'));
        return;
    }
    try {
        const { error } = await db.from('users').update({ twitch_username: twitch || null }).eq('id', currentUser.id);
        if (error) throw error;
        if (currentUser.username) playerTwitchUsernameCache[currentUser.username] = twitch || null;
        closeTwitchSettingsModal();
        showToast(tr('profileSettings.saved'));
        if (currentProfileUsername) loadPlayerProfile(currentProfileUsername);
    } catch (err) {
        console.error(err);
        if (errEl) { errEl.textContent = tr('profileSettings.err.save') + (err.message || ''); errEl.style.display = 'block'; }
        else showToast(tr('profileSettings.err.save') + err.message);
    }
}

// для совместимости со старым названием, если где-то осталось
const saveProfileTwitch = saveTwitchSettings;

// ============================================================
// TWITCH — проверка live-статуса через безопасную Edge Function
// ============================================================

// Кэш последнего ответа, чтобы не спамить функцию при частых перерисовках.
let twitchLiveCache = { at: 0, live: new Set() };
const TWITCH_LIVE_CACHE_TTL = 15000; // 15 секунд, меньше чем интервал вотчера (20с)

// Возвращает Set() ников (в нижнем регистре), которые сейчас live на Twitch.
async function fetchLiveTwitchUsernames(usernames) {
    const clean = [...new Set((usernames || [])
        .filter(Boolean)
        .map(u => String(u).toLowerCase()))];

    if (clean.length === 0) return new Set();

    try {
        const resp = await fetch(TWITCH_LIVE_FN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ usernames: clean })
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        const live = new Set((data.live || []).map(u => String(u).toLowerCase()));
        twitchLiveCache = { at: Date.now(), live };
        return live;
    } catch (e) {
        console.warn('[twitch] Не удалось проверить live-статус:', e);
        // fallback на последний известный кеш
        return twitchLiveCache.live || new Set();
    }
}
function twitchWatchButtonHtml(twitchUsername, extraStyle) {
    if (!twitchUsername) return '';
    const url = `https://twitch.tv/${encodeURIComponent(twitchUsername)}`;
    return `
        <a href="${url}" target="_blank" rel="noopener noreferrer"
           onclick="event.stopPropagation();"
           class="twitch-live-badge" style="${extraStyle || ''}"
           title="${tr('twitch.watchTitle')}">
            🔴 ${tr('twitch.watch')}
        </a>`;
}

// ============================================================
// ЭКРАНЫ
// ============================================================

function showRaceList() {
    document.getElementById('raceListScreen').style.display = '';
    document.getElementById('raceScreen').style.display     = 'none';
    currentRaceId      = null;
    autoStartTriggered = false;
    if (realtimeChannel) { db.removeChannel(realtimeChannel); realtimeChannel = null; }
    stopTwitchLiveWatcher();
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
    startTwitchLiveWatcher();
}

// Периодически (независимо от realtime-обновлений players/races)
// перепроверяем, не начал ли/не закончил ли кто-то из участников стрим
// на Twitch. Список игроков берём из уже загруженной сетки на странице.
let twitchLiveWatcherInterval = null;
function startTwitchLiveWatcher() {
    stopTwitchLiveWatcher();
    twitchLiveWatcherInterval = setInterval(async () => {
        if (!currentRaceId) return;
        try {
            const { data: players } = await db.from('players').select('id, name').eq('race_id', currentRaceId);
            if (players && players.length > 0) attachTwitchInfoToPlayers(players);
        } catch (e) { /* необязательно */ }
    }, 20000);
}
function stopTwitchLiveWatcher() {
    if (twitchLiveWatcherInterval) {
        clearInterval(twitchLiveWatcherInterval);
        twitchLiveWatcherInterval = null;
    }
}

// ============================================================
// СПИСОК ГОНОК
// ============================================================

async function loadRaceList() {
    const container = document.getElementById('raceListContainer');
    container.innerHTML = `<p class="loading-text">⏳ ${tr('races.loading')}</p>`;

    try {
        const { data: races, error } = await db
            .from('races')
            .select('*')
            .neq('status', 'finished')
            .order('started_at', { ascending: false });

        if (error) throw error;

        if (!races || races.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>${tr('empty.noRaces.title')}</h3>
                    <p>${tr('empty.noRaces.text')}</p>
                </div>`;
            return;
        }

        container.innerHTML = races.map(race => `
            <div class="race-card" onclick="location.hash='#race/${race.id}'">
                <h3>${race.name || race.id} ${race.timing_method === 'GameTime' ? '<span style="font-size:0.65rem;color:#ffd93d;border:1px solid #ffd93d;border-radius:5px;padding:1px 5px;vertical-align:middle;">GT</span>' : ''}</h3>
                <div class="meta">${race.game} — ${race.category}</div>
                <span class="status ${race.status}">
                    ${statusLabel(race.status)}
                </span>
            </div>
        `).join('');

    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="empty-state"><h3>⚠️ ${tr('common.loadingError')}</h3><p>${err.message}</p></div>`;
    }
}

function statusLabel(s) {
    return { waiting: tr('status.waiting'), active: tr('status.active'), finished: tr('status.finished') }[s] || s;
}

function getStatusLabel(status) {
    return { 
        joined: tr('player.joined'), 
        ready: tr('player.ready'), 
        racing: tr('player.racing'), 
        finished: tr('player.finished') 
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
                
                // Кнопка удаления гонки — только для master-host
                const deleteBtn = document.getElementById('hostDeleteBtn');
                if (deleteBtn) deleteBtn.style.display = currentUser.role === 'master-host' ? '' : 'none';
            }
        }
    } catch (err) { console.error(err); }
}

function updateRaceUI(race) {
    document.getElementById('raceGame').textContent     = race.game     || 'Unknown Game';
    document.getElementById('raceCategory').textContent = race.category || '---';
    document.getElementById('raceName').textContent     = race.name     || race.id;

    // Бейдж метода времени + предупреждение про Compare Against → Game Time.
    const timingBadge = document.getElementById('raceTimingBadge');
    const gtWarning    = document.getElementById('raceGameTimeWarning');
    const isGameTimeRace = race.timing_method === 'GameTime';
    if (timingBadge) {
        if (isGameTimeRace) {
            timingBadge.style.display = '';
            timingBadge.innerHTML = `<span style="font-size:0.8rem;font-weight:800;color:#ffd93d;">⏱ ${tr('create.timingMethod.gameTime')}</span>`;
        } else {
            timingBadge.style.display = 'none';
            timingBadge.innerHTML = '';
        }
    }
    if (gtWarning) {
        gtWarning.style.display = isGameTimeRace ? 'flex' : 'none';
    }

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

    // Результаты: показываем для завершённой гонки (снимок) и для активной
    // (живой топ по мере финиша). showRaceResults сам решает видимость.
    if (race.status === 'finished' || race.status === 'active') {
        showRaceResults();
    } else {
        const rr = document.getElementById('raceResults');
        if (rr) rr.style.display = 'none';
    }
}

// Кэш ников Twitch участников по имени игрока, чтобы не дёргать users
// на каждое обновление гонки (сплиты приходят часто через realtime).
const playerTwitchUsernameCache = {}; // playerName -> twitchUsername|null

async function fetchPlayersTwitchUsernames(playerNames) {
    const unknown = [...new Set(playerNames)].filter(n => !(n in playerTwitchUsernameCache));
    if (unknown.length > 0) {
        try {
            const { data } = await db
                .from('users')
                .select('username, twitch_username')
                .in('username', unknown);
            unknown.forEach(n => { playerTwitchUsernameCache[n] = null; }); // отметим как проверенные
            (data || []).forEach(u => {
                playerTwitchUsernameCache[u.username] = u.twitch_username || null;
            });
        } catch (e) { /* необязательно */ }
    }
    const result = {};
    playerNames.forEach(n => { result[n] = playerTwitchUsernameCache[n] || null; });
    return result;
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

        // Twitch: узнаём привязанные ники участников и кто из них сейчас live.
        // Не блокируем основной рендер карточек — сначала рисуем без Twitch,
        // затем, когда данные придут, перерисовываем ту же сетку.
        updatePlayersGrid(players, readyMap);
        attachTwitchInfoToPlayers(players, readyMap);

        updateReadyCount(players.length, players.filter(p => readyMap[p.id]).length);
        document.getElementById('lastUpdated').textContent =
            tr('common.updated') + ' ' + new Date().toLocaleTimeString((typeof getCurrentLang === 'function' && getCurrentLang() === 'en') ? 'en-US' : 'ru-RU');

        // Живой топ: показываем по мере финиша участников.
        showRaceResults();

        // Авто-завершение: когда ВСЕ участники финишировали — фиксируем
        // снимок топа и переводим гонку в finished (делает только хост,
        // чтобы запись инициировалась один раз).
        if (canManageCurrentRace) maybeFinalizeRace(players);

        // Авто-старт: только если пользователь может управлять гонкой
        if (canManageCurrentRace) checkAutoStart(players, readyMap);
    } catch (err) { console.error(err); }
}

// Все ли активные участники добежали → авто-фиксация снимка топа.
let finalizeInProgress = false;
async function maybeFinalizeRace(players) {
    if (finalizeInProgress) return;
    if (!players || players.length === 0) return;

    // Участвующие — те, кто реально вступил в забег.
    const racers = players.filter(p => ['racing', 'finished'].includes(p.status));
    if (racers.length === 0) return;

    const allFinished = racers.every(p => p.status === 'finished');
    if (!allFinished) return;

    // Гонка ещё активна? Проверяем, чтобы не фиксировать повторно.
    const { data: race } = await db.from('races')
        .select('status').eq('id', currentRaceId).single();
    if (!race || race.status !== 'active') return;

    finalizeInProgress = true;
    try {
        await finalizeRaceResults(players);
        await db.from('races')
            .update({ status: 'finished' })
            .eq('id', currentRaceId)
            .eq('status', 'active');
        await loadRaceData();
    } catch (err) {
        console.error('Ошибка авто-завершения гонки:', err);
    } finally {
        finalizeInProgress = false;
    }
}

// Сохранить снимок итогового топа в race_results.
// players можно не передавать — тогда подгрузим сами.
async function finalizeRaceResults(players) {
    if (!currentRaceId) return;

    if (!players) {
        const { data } = await db.from('players')
            .select('*').eq('race_id', currentRaceId);
        players = data || [];
    }

    // Финишировавшие → по времени; не финишировавшие → DNF в конце.
    const finished = players
        .filter(p => p.status === 'finished' && p.total_time > 0)
        .sort((a, b) => (a.total_time || 0) - (b.total_time || 0));
    const dnf = players.filter(p =>
        !(p.status === 'finished' && p.total_time > 0));

    const rows = [];
    finished.forEach((p, i) => {
        rows.push({
            race_id:       currentRaceId,
            place:         i + 1,
            player_id:     p.id,
            player_name:   p.name,
            total_time:    p.total_time,
            is_dnf:        false,
            timing_method: p.timing_method || null
        });
    });
    dnf.forEach((p, i) => {
        rows.push({
            race_id:       currentRaceId,
            place:         finished.length + i + 1,
            player_id:     p.id,
            player_name:   p.name,
            total_time:    null,
            is_dnf:        true,
            timing_method: p.timing_method || null
        });
    });

    if (rows.length === 0) return;

    // upsert по (race_id, player_id), чтобы повторная фиксация не падала.
    const { error } = await db
        .from('race_results')
        .upsert(rows, { onConflict: 'race_id,player_id' });
    if (error) console.error('Ошибка сохранения снимка топа:', error);
}

// ============================================================
// СЕТКА ИГРОКОВ (сокращённая версия для читаемости)
// ============================================================

let liveTimerInterval = null;

// === Синхронизация с LiveSplit ===
// Для каждого игрока запоминаем "якорь": последнее присланное компонентом
// время (total_time из LiveSplit) и локальный момент, когда мы его получили.
// Живой таймер на сайте продолжает счёт ровно с этого значения, поэтому
// он совпадает с таймером LiveSplit, даже если игрок стартанул не в момент
// старта гонки. При каждом обновлении из БД якорь пере-синхронизируется.
const liveTimeAnchors = {}; // playerId -> { time, at }

function syncPlayerAnchor(p) {
    const id = p.id;
    // Привязываемся только пока игрок бежит.
    if (p.status !== 'racing') {
        delete liveTimeAnchors[id];
        return;
    }

    const isGameTime = p.timing_method === 'GameTime';
    const reported = Number(p.total_time) || 0;
    const prev = liveTimeAnchors[id];

    // Пере-синхронизируемся, если это новый якорь или пришло свежее значение
    // из LiveSplit (компонент обновил total_time). Небольшой дребезг (<150мс)
    // между «нашим» расчётом и присланным значением игнорируем, чтобы цифры
    // не «дёргались» назад на каждом апдейте.
    //
    // Для Game Time компонент шлёт total_time каждые ~250мс, поэтому между
    // апдейтами мы дорисовываем время линейно (как и для Real Time) — если
    // в LiveSplit сейчас идёт загрузка/пауза, следующий апдейт просто придёт
    // с тем же значением и якорь переустановится без скачка.
    if (!prev) {
        liveTimeAnchors[id] = { time: reported, at: Date.now() };
        return;
    }
    const ourEstimate = prev.time + (Date.now() - prev.at);
    const drift = Math.abs(ourEstimate - reported);
    const driftThreshold = isGameTime ? 400 : 150;
    if (reported !== prev.time || drift > driftThreshold) {
        liveTimeAnchors[id] = { time: reported, at: Date.now() };
    }
}

// Текущее отображаемое время игрока, синхронизированное с LiveSplit.
function getLivePlayerTime(playerId, raceStartFallback) {
    const a = liveTimeAnchors[playerId];
    if (a) return a.time + (Date.now() - a.at);
    // Запасной вариант: пока компонент не прислал total_time — считаем от
    // старта гонки (как раньше), чтобы карточка не висела пустой.
    if (raceStartFallback) return Date.now() - raceStartFallback;
    return 0;
}

// playerId -> twitch_username, только для тех, кто СЕЙЧАС стримит live.
// Заполняется отдельно (см. attachTwitchInfoToPlayers), обновляет карточки
// уже отрисованной сетки без полной перезагрузки данных гонки.
let livePlayerTwitch = {};

// Узнаём Twitch-ники участников гонки и, если они есть, спрашиваем у
// Edge Function, кто из них сейчас реально стримит. Обновляем только
// маленькие Twitch-бейджи на уже отрисованных карточках (не трогаем
// таймеры/сплиты, чтобы не мешать живому обновлению).
let twitchCheckInProgress = false;
async function attachTwitchInfoToPlayers(players) {
    if (twitchCheckInProgress) return;
    twitchCheckInProgress = true;
    try {
        const names = players.map(p => p.name).filter(Boolean);
        if (names.length === 0) { livePlayerTwitch = {}; return; }

        const twitchByName = await fetchPlayersTwitchUsernames(names);
        const twitchUsernames = Object.values(twitchByName).filter(Boolean);

        if (twitchUsernames.length === 0) {
            livePlayerTwitch = {};
            return;
        }

        const liveSet = await fetchLiveTwitchUsernames(twitchUsernames);

        const next = {};
        players.forEach(p => {
            const tw = twitchByName[p.name];
            if (tw && liveSet.has(tw.toLowerCase())) next[p.id] = tw;
        });
        livePlayerTwitch = next;

        updateTwitchBadgesInGrid();
    } catch (e) {
        console.warn('[twitch] Ошибка получения live-статуса участников:', e);
    } finally {
        twitchCheckInProgress = false;
    }
}

// Точечно обновляем/добавляем/убираем Twitch-бейдж в уже существующих
// карточках игроков, не перерисовывая всю сетку (чтобы не сбивать
// анимацию живого таймера).
function updateTwitchBadgesInGrid() {
    document.querySelectorAll('.player-card[data-player-id]').forEach(card => {
        const playerId = card.getAttribute('data-player-id');
        const existing = card.querySelector('.twitch-live-badge');
        const twitchUsername = livePlayerTwitch[playerId];

        if (twitchUsername) {
            if (!existing) {
                const header = card.querySelector('.player-header');
                if (header) header.insertAdjacentHTML('afterend', twitchWatchButtonHtml(twitchUsername));
            }
        } else if (existing) {
            existing.remove();
        }
    });
}

function updatePlayersGrid(players, readyMap) {
    const grid = document.getElementById('playersGrid');

    if (players.length === 0) {
        grid.innerHTML = `<div class="empty-state"><h3>${tr('empty.noPlayers.title')}</h3><p>${tr('empty.noPlayers.text')}</p></div>`;
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

    // Обновляем/чистим якоря синхронизации с LiveSplit для всех игроков.
    sorted.forEach(syncPlayerAnchor);

    grid.innerHTML = sorted.map(p => {
        const isMe     = p.id === currentPlayerId;
        const isLeader = p.total_time === leaderTime && leaderTime !== Infinity;
        const delta    = p.total_time && leaderTime !== Infinity && !isLeader
            ? formatDelta(p.total_time - leaderTime) : null;

        const splits     = typeof p.splits      === 'string' ? JSON.parse(p.splits)      : (p.splits      || {});
        const names      = typeof p.split_names === 'string' ? JSON.parse(p.split_names) : (p.split_names || {});
        const splitCount = p.split_count || Object.keys(splits).length || 0;

        const kickBtn = canManageCurrentRace && !isMe
            ? `<button class="btn-kick" onclick="hostKickPlayer('${p.id}', event)" title="${tr('common.kickTitle')}">✕</button>`
            : '';

        let splitsHtml = '';
        for (let i = 0; i < splitCount; i++) {
            const key       = String(i);
            let   t         = splits[key];
            const label     = names[key] || (tr('split.default') + ' ' + (i + 1));
            const isLast    = i === splitCount - 1;

            // Финальный сплит = время финиша забега. Компонент при финише
            // пишет итог в total_time, а в splits[последний] кладёт 0.
            // Поэтому для финишировавшего игрока подставляем total_time в
            // последний сплит, если там пусто/0.
            if (isLast && p.status === 'finished' &&
                (t === undefined || t === null || t <= 0) &&
                p.total_time > 0) {
                t = p.total_time;
            }

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
            if (isGameTime && !liveTimeAnchors[p.id]) {
                // Game Time, но ещё не пришло ни одного обновления от
                // компонента (например, только что стартовали) — показываем
                // последнее известное значение статично.
                timeDisplay = `
                    <div class="player-time game-time">
                        <span style="font-size:0.75rem;color:#ffd93d;">GT</span> 
                        ${formatTime(p.total_time || 0)}
                    </div>
                `;
            } else if (liveTimeAnchors[p.id] || raceStart) {
                // Живой таймер, синхронизированный с LiveSplit — работает как
                // для Real Time, так и для Game Time (компонент шлёт точное
                // total_time несколько раз в секунду, здесь только плавно
                // дорисовываем время между этими апдейтами).
                const initial = getLivePlayerTime(p.id, raceStart);
                timeDisplay = `
                    <div class="player-time racing-live" data-player-id="${p.id}">
                        ${isGameTime ? '<span style="font-size:0.75rem;color:#ffd93d;">GT</span> ' : ''}
                        <span class="live-time">${formatTime(initial)}</span>
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

        const liveTwitch = livePlayerTwitch[p.id] || null;

        return `
        <div class="player-card ${p.status || 'ready'} ${isMe ? 'current-player' : ''}" data-player-id="${p.id}">
            <div class="player-header">
                <div class="player-name">
                    ${p.name}
                    ${isMe ? `<em>${tr('common.you')}</em>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                    ${kickBtn}
                    <span class="player-status ${p.status || 'ready'}">
                        ${getStatusLabel(p.status)}
                    </span>
                </div>
            </div>

            ${twitchWatchButtonHtml(liveTwitch)}

            ${timeDisplay}

            ${splitCount > 0 ? `
                <ul class="splits-list">
                    ${splitsHtml}
                </ul>
            ` : ''}

            ${p.status === 'racing' && isMe ? `
                <div style="margin-top:0.5rem;font-size:0.8rem;color:var(--text-dim);text-align:center;">
                    ${tr('player.finishInLiveSplit')}
                </div>
            ` : ''}
        </div>`;
    }).join('');

    // Запускаем живой таймер, если есть racing игроки (Real Time или
    // Game Time — компонент шлёт точные апдейты для обоих режимов), у
    // которых уже есть якорь из LiveSplit, либо известен старт гонки.
    const hasRacing = sorted.some(p =>
        p.status === 'racing' &&
        (liveTimeAnchors[p.id] || raceStart)
    );
    if (hasRacing) {
        startLiveTimer(raceStart);
    } else {
        stopLiveTimer();
    }
}

// === Живой таймер ===
// Считаем время ПО КАЖДОМУ игроку отдельно — от его якоря синхронизации
// с LiveSplit (см. getLivePlayerTime), а не от единого старта гонки.
// Так таймер на сайте совпадает с таймером в LiveSplit у каждого игрока.
function startLiveTimer(raceStartFallback) {
    stopLiveTimer();

    liveTimerInterval = setInterval(() => {
        document.querySelectorAll('.player-time.racing-live').forEach(el => {
            const timeSpan = el.querySelector('.live-time');
            if (!timeSpan) return;
            const playerId = el.getAttribute('data-player-id');
            const elapsed = getLivePlayerTime(playerId, raceStartFallback);
            timeSpan.textContent = formatTime(elapsed);
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
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'race_results', filter: 'race_id=eq.' + currentRaceId },
            () => showRaceResults())
        .subscribe();
}

// ============================================================
// ХОСТ — СОЗДАНИЕ ГОНКИ
// ============================================================

function showCreateRace() {
    if (!currentUser) {
        alert(tr('alert.loginFirst'));
        showAuthModal();
        return;
    }
    document.getElementById('createRaceModal').classList.add('active');
    
    // Генерируем красивый ID
    generateNewRaceId();

    // Сбрасываем метод времени на Real Time по умолчанию и прячем предупреждение
    const timingSelect = document.getElementById('newRaceTimingMethod');
    if (timingSelect) timingSelect.value = 'RealTime';
    onTimingMethodChange();
    
    document.getElementById('newRaceGame').focus();
}

// Показ/скрытие предупреждения о Game Time при выборе метода времени
// в форме создания гонки.
function onTimingMethodChange() {
    const select  = document.getElementById('newRaceTimingMethod');
    const warning = document.getElementById('gameTimeWarning');
    if (!select || !warning) return;
    warning.style.display = select.value === 'GameTime' ? 'flex' : 'none';
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
    const timingSelect = document.getElementById('newRaceTimingMethod');
    if (timingSelect) timingSelect.value = 'RealTime';
    onTimingMethodChange();
}

async function createRace() {
    if (!currentUser) return;
    
    const id            = document.getElementById('newRaceId').value.trim();
    const name          = document.getElementById('newRaceName').value.trim();
    const game          = document.getElementById('newRaceGame').value.trim();
    const category      = document.getElementById('newRaceCategory').value.trim();
    const timingSelect  = document.getElementById('newRaceTimingMethod');
    const timingMethod  = timingSelect ? timingSelect.value : 'RealTime';

    if (!id || !game) { alert(tr('alert.requiredRace')); return; }

    // Если организатор выбрал Game Time — ещё раз явно предупреждаем перед
    // созданием гонки, чтобы это не потерялось.
    if (timingMethod === 'GameTime' && !confirm(tr('create.timingMethod.confirm'))) {
        return;
    }

    const { error } = await db.from('races').insert({
        id,
        name:     name || id,
        game,
        category: category || 'Any%',
        status:   'waiting',
        timing_method: timingMethod,
        created_by: currentUser.id   // ← сохраняем владельца
    });

    if (error) { alert(tr('alert.error') + error.message); return; }

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
    notice.textContent = tr('autostart.notice');
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
    if (!confirm(tr('confirm.startRace', { seconds: delaySec }))) return;

    const startAt = new Date(Date.now() + delaySec * 1000).toISOString();

    const { error } = await db.from('races')
        .update({ status: 'active', started_at: startAt })
        .eq('id', currentRaceId);

    if (error) alert(tr('alert.error') + error.message);
    else await loadRaceData();
}

async function hostFinishRace() {
    if (!currentRaceId || !canManageCurrentRace) return;
    if (!confirm(tr('confirm.finishRace'))) return;

    // Сначала фиксируем снимок топа (отстающие → DNF), затем закрываем гонку.
    await finalizeRaceResults();

    const { error } = await db.from('races')
        .update({ status: 'finished' })
        .eq('id', currentRaceId);

    if (error) alert(tr('alert.error') + error.message);
    else await loadRaceData();
}

async function hostKickPlayer(playerId, event) {
    event.stopPropagation();
    if (!canManageCurrentRace) return;
    if (!confirm(tr('confirm.kickPlayer'))) return;

    await db.from('ready').delete()
        .eq('race_id', currentRaceId).eq('player_id', playerId);
    await db.from('players').delete().eq('id', playerId);
    await loadPlayers();
}

// ═══ УДАЛЕНИЕ ГОНКИ (только master-host) ═══
async function hostDeleteRace() {
    if (!currentRaceId || currentUser?.role !== 'master-host') {
        console.warn('[hostDeleteRace] Отказ: нет прав или не выбран ID гонки', { currentRaceId, role: currentUser?.role });
        return;
    }
    if (!confirm(tr('confirm.deleteRace'))) return;

    console.log('[hostDeleteRace] Удаляем гонку:', currentRaceId);

    try {
        const { data, error } = await db.rpc('delete_race', {
            race_id_input: currentRaceId,
            user_id_input: currentUser.id
        });

        if (error) throw new Error(error.message);

        if (!data.success) {
            throw new Error(data.error || 'Неизвестная ошибка');
        }

        console.log('[hostDeleteRace] Успешно удалено');
        showToast(tr('toast.raceDeleted'));
        location.hash = '#races';
    } catch (err) {
        console.error('[hostDeleteRace] Ошибка:', err);
        alert(tr('alert.deleteError') + err.message);
    }
}

// ═══ Показать результаты гонки (live-топ + снимок) ═══
// Если у гонки есть сохранённый снимок (race_results) — показываем его.
// Иначе строим живой топ из текущих финишировавших игроков.
async function showRaceResults() {
    const container  = document.getElementById('raceResultsContainer');
    const resultsDiv = document.getElementById('raceResults');
    if (!container || !resultsDiv) return;

    try {
        // 1) Пытаемся показать сохранённый снимок завершённой гонки.
        const { data: snapshot } = await db
            .from('race_results')
            .select('*')
            .eq('race_id', currentRaceId)
            .order('place', { ascending: true });

        if (snapshot && snapshot.length > 0) {
            const rows = snapshot.map(r => ({
                name: r.player_name,
                total_time: r.total_time,
                is_dnf: r.is_dnf,
                timing_method: r.timing_method,
                place: r.place
            }));
            container.innerHTML = renderResultsHtml(rows, { finalized: true });
            resultsDiv.style.display = 'block';
            return;
        }

        // 2) Иначе — живой топ из игроков.
        const { data: players } = await db
            .from('players')
            .select('*')
            .eq('race_id', currentRaceId);

        if (!players || players.length === 0) {
            resultsDiv.style.display = 'none';
            return;
        }

        const finished = players
            .filter(p => p.status === 'finished' && p.total_time > 0)
            .sort((a, b) => (a.total_time || 0) - (b.total_time || 0))
            .map((p, i) => ({
                name: p.name,
                total_time: p.total_time,
                is_dnf: false,
                timing_method: p.timing_method,
                place: i + 1
            }));

        if (finished.length === 0) {
            resultsDiv.style.display = 'none';
            return;
        }

        container.innerHTML = renderResultsHtml(finished, {
            finalized: false,
            finishedCount: finished.length,
            totalCount: players.length
        });
        resultsDiv.style.display = 'block';

    } catch (err) {
        console.error('Ошибка загрузки результатов:', err);
    }
}

// Рендер таблицы топа (используется и для live, и для снимка).
function renderResultsHtml(rows, opts = {}) {
    const { finalized, finishedCount, totalCount } = opts;

    let header = '';
    if (finalized) {
        header = `<div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:0.6rem;">${tr('results.final')}</div>`;
    } else {
        header = `<div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:0.6rem;">
            ${tr('results.live', { finished: finishedCount, total: totalCount })}
        </div>`;
    }

    let html = header + '<div style="display:flex;flex-direction:column;gap:0.5rem;">';

    rows.forEach((p) => {
        const place = p.place;
        const medal = p.is_dnf ? 'DNF'
            : place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : `#${place}`;
        const time  = p.is_dnf ? '—' : formatTime(p.total_time);
        const gt    = p.timing_method === 'GameTime'
            ? '<span style="font-size:0.65rem;color:#ffd93d;margin-right:4px;">GT</span>' : '';

        html += `
            <div style="background:var(--surface-hover);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;${p.is_dnf ? 'opacity:0.55;' : ''}">
                <div style="display:flex;align-items:center;gap:12px;">
                    <span style="font-size:1.2rem;min-width:2.2rem;text-align:center;font-weight:700;">${medal}</span>
                    <span style="font-weight:600;font-family:JetBrains Mono,monospace;">${p.name}</span>
                </div>
                <div style="font-family:JetBrains Mono,monospace;font-size:1.1rem;color:var(--primary);font-weight:700;">
                    ${gt}${time}
                </div>
            </div>
        `;
    });

    html += '</div>';
    return html;
}

// ============================================================
// ОБНОВЛЕНИЕ ДИНАМИЧЕСКИХ ТЕКСТОВ ПРИ СМЕНЕ ЯЗЫКА
// ============================================================

window.refreshCurrentViewTranslations = function () {
    updateAuthUI();

    // Если открыта гонка — обновляем её данные/участников/топ.
    if (currentRaceId) {
        loadRaceData();
        loadPlayers();
        return;
    }

    // Иначе обновляем видимую SPA-страницу.
    if (!document.getElementById('page-races')?.hidden) loadRaceList();
    if (!document.getElementById('page-history')?.hidden) loadRaceHistory();
    if (!document.getElementById('page-players')?.hidden) searchPlayers();
    if (!document.getElementById('page-profile')?.hidden && currentProfileUsername) {
        loadPlayerProfile(currentProfileUsername);
    }
};

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================

// Количество зарегистрированных пользователей на титульном экране.
async function loadUserCount() {
    const el = document.getElementById('statUserCount');
    if (!el) return;
    try {
        const { count, error } = await db
            .from('users')
            .select('*', { count: 'exact', head: true });
        if (error) throw error;
        if (typeof count === 'number') el.textContent = count;
    } catch (err) {
        console.error('Не удалось загрузить число пользователей:', err);
        // Оставляем прежнее значение (∞), если запрос не удался.
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadUserFromStorage();
    updateAuthUI(); // гарантированно скрыть/показать кнопки в зависимости от входа

    // Загружаем все секции
    loadRaceList();
    loadRaceHistory();
    loadUserCount();
    updatePlayerSortUI();

    // Автообновление
    setInterval(() => {
        if (!currentRaceId) {
            loadRaceList();
            loadRaceHistory();
            loadUserCount();
        }
    }, 15000);
});

// Закрытие модалок по клику вне
document.getElementById('authModal').addEventListener('click', e => {
    if (e.target.id === 'authModal') closeAuthModal();
});
document.getElementById('createRaceModal').addEventListener('click', e => {
    if (e.target.id === 'createRaceModal') closeCreateRace();
});
const twitchModal = document.getElementById('twitchSettingsModal');
if (twitchModal) {
    twitchModal.addEventListener('click', e => {
        if (e.target.id === 'twitchSettingsModal') closeTwitchSettingsModal();
    });
}

// Enter для форм
document.getElementById('loginPassword').addEventListener('keypress', e => {
    if (e.key === 'Enter') loginUser();
});
document.getElementById('regPassword').addEventListener('keypress', e => {
    if (e.key === 'Enter') registerUser();
});
const twitchInput = document.getElementById('profileTwitchUsername');
if (twitchInput) twitchInput.addEventListener('keypress', e => { if (e.key === 'Enter') saveTwitchSettings(); });


// Стили для текущего игрока
const s = document.createElement('style');
s.textContent = `.current-player { border: 2px solid var(--primary) !important; box-shadow: 0 0 20px rgba(0,255,136,0.3); }`;
document.head.appendChild(s);

// === ПОИСК ИГРОКОВ ===
let playerSearchTimeout = null;

function onPlayerSearchInput() {
    clearTimeout(playerSearchTimeout);
    playerSearchTimeout = setTimeout(searchPlayers, 300); // debounce 300 мс
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Статистика для сортировки/фильтров: количество матчей (race_results) и
// количество побед (place === 1 и не DNF) для каждого ника.
// { ник: { races: число, wins: число } }
async function fetchPlayerStats(usernames) {
    const stats = {};
    if (!usernames || usernames.length === 0) return stats;
    try {
        const { data } = await db
            .from('race_results')
            .select('player_name, place, is_dnf')
            .in('player_name', usernames);
        (data || []).forEach(r => {
            if (!stats[r.player_name]) stats[r.player_name] = { races: 0, wins: 0 };
            stats[r.player_name].races += 1;
            if (!r.is_dnf && r.place === 1) stats[r.player_name].wins += 1;
        });
    } catch (e) { /* статистика необязательна */ }
    return stats;
}

// === Сортировка списка игроков по победам / матчам ===
let playerSortMode = null;   // null | 'wins' | 'races'
let playerSortDir  = 'desc'; // 'desc' | 'asc'

function setPlayerSort(mode) {
    if (mode === null) {
        playerSortMode = null;
    } else if (playerSortMode === mode) {
        // Повторный клик по той же кнопке — переключаем направление.
        playerSortDir = playerSortDir === 'desc' ? 'asc' : 'desc';
    } else {
        playerSortMode = mode;
        playerSortDir  = 'desc';
    }
    updatePlayerSortUI();
    searchPlayers();
}

function updatePlayerSortUI() {
    const winsBtn    = document.getElementById('sortByWinsBtn');
    const racesBtn   = document.getElementById('sortByRacesBtn');
    const resetBtn   = document.getElementById('sortResetBtn');
    const winsArrow  = document.getElementById('sortWinsArrow');
    const racesArrow = document.getElementById('sortRacesArrow');
    if (!winsBtn || !racesBtn) return;

    const arrow = playerSortDir === 'desc' ? ' ▼' : ' ▲';

    winsBtn.className  = playerSortMode === 'wins'  ? 'btn btn-primary' : 'btn btn-ghost';
    racesBtn.className = playerSortMode === 'races' ? 'btn btn-primary' : 'btn btn-ghost';
    if (winsArrow)  winsArrow.textContent  = playerSortMode === 'wins'  ? arrow : '';
    if (racesArrow) racesArrow.textContent = playerSortMode === 'races' ? arrow : '';
    if (resetBtn) resetBtn.style.display = playerSortMode ? '' : 'none';
}

function sortUsersByStats(users, stats) {
    if (!playerSortMode) return users;
    const key = playerSortMode === 'wins' ? 'wins' : 'races';
    const dir = playerSortDir === 'asc' ? 1 : -1;
    return [...users].sort((a, b) => {
        const va = (stats[a.username] && stats[a.username][key]) || 0;
        const vb = (stats[b.username] && stats[b.username][key]) || 0;
        if (va !== vb) return (va - vb) * dir;
        return a.username.localeCompare(b.username);
    });
}

// Отрисовка карточек игроков (общая для поиска и случайного списка)
function renderPlayerCards(users, stats, twitchByName = {}, liveSet = new Set()) {
    return '<div style="display:flex;flex-direction:column;gap:0.5rem;">' +
        users.map(u => {
            const name = escapeHtml(u.username);
            const roleBadge = u.role === 'master-host' ? ' <span style="font-size:0.65rem;color:#e0503f;font-weight:900;">MASTER</span>'
                : u.role === 'host' ? ' <span style="font-size:0.65rem;color:#e8a830;font-weight:900;">HOST</span>' : '';
            const s = stats[u.username] || { races: 0, wins: 0 };
            const tw = twitchByName[u.username] || null;
            const isLive = tw && liveSet.has(String(tw).toLowerCase());
            const twitchHtml = isLive
                ? `<div style="margin-top:4px;font-size:0.78rem;font-weight:800;color:#ff3b3b;">🔴 ${tr('twitch.live')}</div>`
                : '';
            return `
                <div class="race-card" onclick="location.hash='#profile/${encodeURIComponent(u.username)}'" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;">
                    <div style="min-width:0;flex:1;">
                        <h3 style="margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}${roleBadge}</h3>
                        ${twitchHtml}
                    </div>
                    <div style="display:flex;gap:10px;white-space:nowrap;align-items:center;">
                        <span style="font-family:JetBrains Mono,monospace;font-weight:700;color:#ffd93d;font-size:0.85rem;" title="${tr('players.winsTitle')}">🥇 ${s.wins}</span>
                        <span style="font-family:JetBrains Mono,monospace;font-weight:700;color:var(--text-dim);font-size:0.85rem;" title="${tr('players.racesTitle')}">🏁 ${s.races}</span>
                    </div>
                </div>`;
        }).join('') + '</div>';
}

// Защита от автозаполнения браузером: если в поле поиска что-то
// «само» появилось до того, как пользователь начал печатать — очищаем.
let playerSearchTouched = false;

function clearAutofilledSearch() {
    const input = document.getElementById('playerSearchInput');
    if (input && !playerSearchTouched && input.value) {
        input.value = '';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('playerSearchInput');
    if (!input) return;

    input.addEventListener('keydown', (e) => {
        // Поле поиска — однострочный textarea: Enter не должен добавлять перенос
        if (e.key === 'Enter') { e.preventDefault(); searchPlayers(); return; }
        playerSearchTouched = true;
    });
    input.addEventListener('paste', () => { playerSearchTouched = true; });

    // Если значение появилось БЕЗ участия пользователя (автозаполнение
    // или восстановление формы) — событие input придёт, когда touched=false.
    input.addEventListener('input', () => {
        // Вычищаем переносы строк на случай вставки многострочного текста
        if (input.value.includes('\n')) {
            input.value = input.value.replace(/\n+/g, ' ').trim();
        }
        if (!playerSearchTouched && input.value) {
            input.value = '';
        }
    });

    // Страховка: проверяем каждые 250 мс первые 3 секунды после загрузки.
    let checks = 0;
    const iv = setInterval(() => {
        clearAutofilledSearch();
        if (++checks >= 12) clearInterval(iv);
    }, 250);
});

// pageshow срабатывает и при обычной загрузке, и при возврате из bfcache
// (кнопка «назад»), и после перезагрузки — когда браузер уже восстановил
// значения форм. Самое надёжное место для очистки.
window.addEventListener('pageshow', () => {
    playerSearchTouched = false;
    clearAutofilledSearch();
    setTimeout(clearAutofilledSearch, 50);
    setTimeout(clearAutofilledSearch, 300);
});

// До 10 случайных игроков — чтобы страница не была пустой.
// Если активна сортировка по победам/матчам — вместо случайных игроков
// показываем полноценный лидерборд (топ игроков по выбранному показателю).
async function loadRandomPlayers() {
    const container = document.getElementById('playerSearchResults');
    if (!container) return;

    container.innerHTML = `<p class="loading-text">⏳ ${tr('players.searching')}</p>`;

    try {
        const { data: users, error } = await db
            .from('users')
            .select('username, role')
            .limit(200);

        if (error) throw error;

        if (!users || users.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>${tr('players.notFound')}</p></div>`;
            return;
        }

        // Twitch info для списка
        const twitchByName = await fetchPlayersTwitchUsernames(users.map(u => u.username));
        const liveSet = await fetchLiveTwitchUsernames(Object.values(twitchByName).filter(Boolean));

        if (playerSortMode) {
            const stats = await fetchPlayerStats(users.map(u => u.username));
            const sorted = sortUsersByStats(users, stats).slice(0, 30);
            const label = playerSortMode === 'wins' ? tr('players.leaderboardWins') : tr('players.leaderboardRaces');
            container.innerHTML =
                `<p style="color:var(--text-dim);font-weight:700;font-size:0.85rem;margin:0 0 0.75rem;">${label}</p>` +
                renderPlayerCards(sorted, stats, twitchByName, liveSet);
            return;
        }

        // Перемешиваем на клиенте (Fisher–Yates) и берём 10
        const shuffled = [...users];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const picked = shuffled.slice(0, 10);

        const stats = await fetchPlayerStats(picked.map(u => u.username));
        const pickedTwitch = {};
        picked.forEach(u => { pickedTwitch[u.username] = twitchByName[u.username] || null; });

        container.innerHTML =
            `<p style="color:var(--text-dim);font-weight:700;font-size:0.85rem;margin:0 0 0.75rem;">${tr('players.random')}</p>` +
            renderPlayerCards(picked, stats, pickedTwitch, liveSet);

    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="empty-state"><p>${tr('common.loadingError')}</p></div>`;
    }
}


async function searchPlayers() {
    const input = document.getElementById('playerSearchInput');
    const container = document.getElementById('playerSearchResults');
    if (!input || !container) return;

    // Если значение появилось не от пользователя (автозаполнение) — сбрасываем
    clearAutofilledSearch();

    const query = input.value.trim();
    if (query.length < 2) {
        loadRandomPlayers();
        return;
    }

    container.innerHTML = `<p class="loading-text">⏳ ${tr('players.searching')}</p>`;

    try {
        // Экранируем спецсимволы ilike-шаблона
        const safe = query.replace(/[%_\\]/g, '\\$&');
        const { data: users, error } = await db
            .from('users')
            .select('username, role')
            .ilike('username', `%${safe}%`)
            .order('username')
            .limit(20);

        if (error) throw error;

        if (!users || users.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>${tr('players.notFound')}</p></div>`;
            return;
        }

        const stats = await fetchPlayerStats(users.map(u => u.username));
        const sorted = sortUsersByStats(users, stats);
        const twitchByName = await fetchPlayersTwitchUsernames(sorted.map(u => u.username));
        const liveSet = await fetchLiveTwitchUsernames(Object.values(twitchByName).filter(Boolean));
        container.innerHTML = renderPlayerCards(sorted, stats, twitchByName, liveSet);

    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="empty-state"><p>${tr('common.loadingError')}</p></div>`;
    }
}

// === ПРОФИЛЬ ИГРОКА ===
let currentProfileUsername = null; // чей профиль сейчас открыт (для смены языка)

async function loadPlayerProfile(username) {
    const container = document.getElementById('profileContainer');
    if (!container) return;

    currentProfileUsername = username;

    container.innerHTML = `<p class="loading-text">⏳ ${tr('profile.loading')}</p>`;

    try {
        const { data: user, error: userErr } = await db
            .from('users')
            .select('username, role, twitch_username')
            .ilike('username', username.replace(/[%_\\]/g, '\\$&'))
            .limit(1)
            .maybeSingle();

        if (userErr) throw userErr;
        if (!user) {
            container.innerHTML = `<div class="empty-state"><h3>${tr('profile.notFound')}</h3></div>`;
            return;
        }

        const isOwnProfile = currentUser && currentUser.username &&
            currentUser.username.toLowerCase() === user.username.toLowerCase();

        let isTwitchLive = false;
        if (user.twitch_username) {
            try {
                const liveSet = await fetchLiveTwitchUsernames([user.twitch_username]);
                isTwitchLive = liveSet.has(user.twitch_username.toLowerCase());
            } catch(e) {}
        }

        const { data: results } = await db
            .from('race_results')
            .select('race_id, place, total_time, is_dnf, timing_method')
            .eq('player_name', user.username)
            .order('place', { ascending: true });

        const rows = results || [];
        let racesById = {};
        if (rows.length > 0) {
            const { data: races } = await db
                .from('races')
                .select('id, name, game, category, started_at')
                .in('id', [...new Set(rows.map(r => r.race_id))]);
            (races || []).forEach(r => { racesById[r.id] = r; });
        }

        const finished = rows.filter(r => !r.is_dnf);
        const wins     = finished.filter(r => r.place === 1).length;
        const podiums  = finished.filter(r => r.place <= 3).length;
        const dnfs     = rows.length - finished.length;

        const roleText = user.role === 'master-host' ? 'MASTER'
            : user.role === 'host' ? 'HOST' : tr('profile.rolePlayer');
        const roleColor = user.role === 'master-host' ? '#e0503f'
            : user.role === 'host' ? '#e8a830' : 'var(--primary)';

        const statCard = (value, label) => `
            <div style="background:var(--surface-hover);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 20px;text-align:center;min-width:110px;">
                <div style="font-size:1.5rem;font-weight:900;font-family:JetBrains Mono,monospace;color:var(--primary);">${value}</div>
                <div style="font-size:0.75rem;color:var(--text-dim);font-weight:700;margin-top:4px;">${label}</div>
            </div>`;

        let twitchBlockHtml = '';
        if (isOwnProfile) {
            const twitchBtnLabel = user.twitch_username ? tr('profile.twitchEdit') : tr('profile.twitchLink');
            const twitchStatus = user.twitch_username
                ? `<a href="https://twitch.tv/${encodeURIComponent(user.twitch_username)}" target="_blank" rel="noopener noreferrer" style="font-weight:800;color:#9146ff;text-decoration:none;">${isTwitchLive ? '🔴 ' + tr('twitch.live') + ' · ' : ''}twitch.tv/${escapeHtml(user.twitch_username)}</a>`
                : `<span style="color:var(--text-dim);font-weight:600;">${tr('profile.twitchUnlinked')}</span>`;
            twitchBlockHtml = `
                <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                    ${twitchStatus}
                    <button class="btn btn-ghost" style="padding:6px 12px;font-size:0.85rem;" onclick="showTwitchSettingsModal()">${twitchBtnLabel}</button>
                </div>`;
        } else if (user.twitch_username) {
            if (isTwitchLive) {
                twitchBlockHtml = `
                <p style="margin-top:10px;">
                    <a href="https://twitch.tv/${encodeURIComponent(user.twitch_username)}" target="_blank" rel="noopener noreferrer"
                       class="twitch-live-badge">
                        🔴 ${tr('twitch.live')}
                    </a>
                </p>`;
            } else {
                twitchBlockHtml = `
                <p style="margin-top:10px;">
                    <a href="https://twitch.tv/${encodeURIComponent(user.twitch_username)}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-flex;align-items:center;gap:6px;font-weight:800;color:#9146ff;text-decoration:none;background:color-mix(in srgb, #9146ff 14%, transparent);border:1px solid color-mix(in srgb, #9146ff 35%, transparent);padding:6px 14px;border-radius:999px;">
                        ${tr('twitch.profile')}
                    </a>
                </p>`;
            }
        }

        let html = `
            <div class="race-header" style="margin-bottom:1.5rem;">
                <div style="flex:1;min-width:260px;">
                    <h1 style="margin:0;">${escapeHtml(user.username)}</h1>
                    <p style="margin:6px 0 0;"><span style="color:${roleColor};font-weight:900;font-size:0.8rem;letter-spacing:.5px;">${roleText}</span></p>
                    ${twitchBlockHtml}
                </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-bottom:2rem;">
                ${statCard(rows.length, tr('profile.stat.races'))}
                ${statCard('🥇 ' + wins, tr('profile.stat.wins'))}
                ${statCard('🏆 ' + podiums, tr('profile.stat.podiums'))}
                ${statCard(dnfs, 'DNF')}
            </div>
            <div class="section-header"><h2>${tr('profile.recentRaces')}</h2></div>`;

        if (rows.length === 0) {
            html += `<div class="empty-state"><p>${tr('profile.noRaces')}</p></div>`;
        } else {
            const sorted = [...rows].sort((a, b) => {
                const da = racesById[a.race_id]?.started_at || '';
                const db_ = racesById[b.race_id]?.started_at || '';
                return db_.localeCompare(da);
            }).slice(0, 20);
            const lang = (typeof getCurrentLang === 'function' && getCurrentLang() === 'en') ? 'en-US' : 'ru-RU';
            html += '<div style="display:flex;flex-direction:column;gap:0.5rem;">' + sorted.map(r => {
                const race = racesById[r.race_id];
                const medal = r.is_dnf ? 'DNF' : r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : `#${r.place}`;
                const time = r.is_dnf ? '—' : formatTime(r.total_time);
                const raceName = race ? escapeHtml(race.name || race.id) : r.race_id;
                const raceMeta = race ? `${escapeHtml(race.game)} — ${escapeHtml(race.category)}` : '';
                const date = race?.started_at ? new Date(race.started_at).toLocaleDateString(lang) : '';
                return `
                    <div style="background:var(--surface-hover);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer;${r.is_dnf ? 'opacity:0.55;' : ''}"
                         onclick="location.hash='#race/${r.race_id}'">
                        <div style="display:flex;align-items:center;gap:12px;min-width:0;">
                            <span style="font-size:1.2rem;min-width:2.2rem;text-align:center;font-weight:700;">${medal}</span>
                            <div style="min-width:0;">
                                <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${raceName}</div>
                                <div style="font-size:0.75rem;color:var(--text-dim);">${raceMeta}${date ? ' · ' + date : ''}</div>
                            </div>
                        </div>
                        <div style="font-family:JetBrains Mono,monospace;font-size:1rem;color:var(--primary);font-weight:700;white-space:nowrap;">${time}</div>
                    </div>`;
            }).join('') + '</div>';
        }
        container.innerHTML = html;
    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="empty-state"><p>${tr('common.loadingError')}</p></div>`;
    }
}




// === ИСТОРИЯ ГОНОК ===
async function loadRaceHistory() {
    const container = document.getElementById('raceHistoryContainer');
    if (!container) return;

    try {
        // Завершённые гонки, последние — сверху.
        const { data: races, error } = await db
            .from('races')
            .select('*')
            .eq('status', 'finished')
            .order('started_at', { ascending: false })
            .limit(30);

        if (error) throw error;

        if (!races || races.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>${tr('empty.noHistory')}</p></div>`;
            return;
        }

        // Подтягиваем победителей из снимков результатов (place = 1).
        const winners = {};
        try {
            const { data: results } = await db
                .from('race_results')
                .select('race_id, player_name, total_time, is_dnf, place')
                .in('race_id', races.map(r => r.id))
                .eq('place', 1);
            (results || []).forEach(r => {
                if (!r.is_dnf) winners[r.race_id] = r;
            });
        } catch (e) { /* победители необязательны */ }

        const lang = (typeof getCurrentLang === 'function' && getCurrentLang() === 'en') ? 'en-US' : 'ru-RU';

        container.innerHTML = races.map(race => {
            const w = winners[race.id];
            const winnerHtml = w
                ? `<div class="meta">🥇 ${w.player_name} — <span style="font-family:JetBrains Mono,monospace;color:var(--primary);font-weight:700;">${formatTime(w.total_time)}</span></div>`
                : `<div class="meta">${tr('history.noWinner')}</div>`;
            const dateHtml = race.started_at
                ? `<div class="meta">📅 ${new Date(race.started_at).toLocaleString(lang)}</div>`
                : '';

            return `
                <div class="race-card" onclick="location.hash='#race/${race.id}'">
                    <h3>${race.name || race.id}</h3>
                    <div class="meta">${race.game} — ${race.category}</div>
                    ${winnerHtml}
                    ${dateHtml}
                    <span class="status ${race.status}">${statusLabel(race.status)}</span>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="empty-state"><p>${tr('common.loadingError')}</p></div>`;
    }
}