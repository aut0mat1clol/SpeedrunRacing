// ============================================================
// SpeedRun Race Tracker — app.js (с системой логина)
// ============================================================

// === Ключи берутся из config.js (не попадает в Git) ===
const SUPABASE_URL      = window.SUPABASE_URL      || 'https://bijlcubwwotzbhukbabw.supabase.co';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'твой_ключ_сюда';
const HOST_PASSWORD     = window.HOST_PASSWORD     || 'speedrun2025';

// supabase-js грузится с defer — ждём готовности перед createClient.
// db — Proxy, который лениво создаёт реальный supabase-клиент при первом обращении.
// Так все существующие вызовы `await db.from(...).select(...)` продолжают работать
// без переписывания, а загрузка supabase-js с defer не ломает порядок.
let __realDb = null;
function _realDb() {
    if (__realDb) return __realDb;
    if (!window.supabase || !window.supabase.createClient) return null;
    __realDb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return __realDb;
}
const db = new Proxy({}, {
    get(_t, prop) {
        const r = _realDb();
        if (!r) {
            // supabase-js ещё не подгрузился (defer). Для большинства методов
            // это асинхронная операция, и к моменту её await всё будет готово.
            // Но для синхронных геттеров (например, db.removeChannel) — вернём
            // no-op, чтобы не уронить страницу.
            if (prop === 'removeChannel') return () => {};
            return undefined;
        }
        const v = r[prop];
        return typeof v === 'function' ? v.bind(r) : v;
    }
});

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

// ============================================================
// АВТОРИЗАЦИЯ (Supabase Auth)
// ============================================================
// Email — теневой, юзер его не видит: username@users.speedrun.local
// Пароль НИКОГДА не попадает в наш код и в public.users. Он
// хешируется в auth.users (bcrypt) и проверяется через
// signInWithPassword. Анонимный SELECT из public.users с паролем
// полностью убран — фронт больше не может прочитать чужие креды.
//
// Доп. RPC register_user() нужен, потому что signUp() создаёт
// auth.users, но не нашу public.user_profile — а фронт ждёт
// username/role/twitch_username. Также username нельзя хранить
// в email (там email), поэтому достаём из user_metadata.

function shadowEmail(username) {
    return username.toLowerCase().trim() + '@users.speedrun.local';
}

async function loadCurrentProfile() {
    // Подтянуть username/role/twitch_username/avatar_url из user_profile по auth.uid().
    if (!currentUser) return;
    const { data, error } = await db
        .from('user_profile')
        .select('username, role, twitch_username, avatar_url')
        .eq('id', currentUser.id)
        .maybeSingle();
    if (error) {
        console.warn('loadCurrentProfile error:', error);
        return;
    }
    if (data) {
        currentUser.username = data.username;
        currentUser.role = data.role || 'player';
        currentUser.twitch_username = data.twitch_username || null;
        currentUser.avatar_url = data.avatar_url || null;
        if (data.username) playerAvatarCache[data.username] = data.avatar_url || null;
    }
}

async function loadUserFromStorage() {
    // Восстанавливаем сессию из Supabase Auth (JWT в localStorage
    // supabase сам управляет — мы просто проверяем, что она валидна).
    try {
        const { data, error } = await db.auth.getSession();
        if (error) throw error;
        if (data?.session?.user) {
            currentUser = { id: data.session.user.id };
            await loadCurrentProfile();
            updateAuthUI();
            return true;
        }
    } catch (e) {
        console.warn('loadUserFromStorage:', e);
    }
    return false;
}

async function logoutUser() {
    try {
        await db.auth.signOut();
    } catch (e) {
        console.warn('signOut error:', e);
    }
    currentUser = null;
    isHost = false;
    updateAuthUI();
    currentPlayerId = null;
    currentPlayerName = null;
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
        const { data, error } = await db.auth.signInWithPassword({
            email: shadowEmail(username),
            password
        });
        if (error || !data?.user) {
            errorEl.textContent = tr('auth.err.invalid');
            errorEl.style.display = 'block';
            return;
        }
        currentUser = { id: data.user.id };
        await loadCurrentProfile();
        updateAuthUI();
        closeAuthModal();
        showToast(tr('toast.welcome', { name: currentUser.username }));

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
        // Сначала проверим, что username свободен (через RPC, чтобы
        // не зависеть от RLS на user_profile).
        const { data: existsData } = await db.rpc('username_exists', {
            check_username: username
        });
        if (existsData === true) {
            errorEl.textContent = tr('auth.err.userExists');
            errorEl.style.display = 'block';
            return;
        }

        // Создаём пользователя через RPC (атомарно: auth.users + identity
        // + user_profile). RPC работает от лица service role, поэтому
        // может писать в auth.users.
        const { data: rpcRes, error: rpcErr } = await db.rpc('register_user', {
            new_username: username,
            new_password: password
        });
        if (rpcErr) throw rpcErr;
        if (!rpcRes || !rpcRes.success) {
            const errKey = rpcRes?.error || 'register_failed';
            const msg = ({
                username_too_short: tr('auth.err.usernameShort'),
                password_too_short: tr('auth.err.passwordShort') || 'Пароль слишком короткий (мин. 6 символов)',
                user_exists: tr('auth.err.userExists')
            })[errKey] || (tr('auth.err.registerPrefix') + (rpcRes?.error || ''));
            errorEl.textContent = msg;
            errorEl.style.display = 'block';
            return;
        }

        // Теперь логинимся через Supabase Auth — RPC создал запись,
        // но сессии у нас ещё нет.
        const { data: signIn, error: signInErr } = await db.auth.signInWithPassword({
            email: shadowEmail(username),
            password
        });
        if (signInErr || !signIn?.user) throw signInErr || new Error('signIn failed');

        currentUser = { id: signIn.user.id };
        await loadCurrentProfile();
        updateAuthUI();
        closeAuthModal();
        showToast(tr('toast.registerSuccess'));
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
        const { data } = await db.from('user_profile').select('twitch_username').eq('id', currentUser.id).maybeSingle();
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
        const { error } = await db.from('user_profile').update({ twitch_username: twitch || null }).eq('id', currentUser.id);
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
// Дедупликация: пока запрос в полёте, все ожидающие получают тот же Promise.
let __twitchLiveInflight = null;
async function fetchLiveTwitchUsernames(usernames) {
    const clean = [...new Set((usernames || [])
        .filter(Boolean)
        .map(u => String(u).toLowerCase()))];

    if (clean.length === 0) return new Set();

    // Свежий кеш — не дёргаем сеть вообще.
    if (twitchLiveCache.live && Date.now() - twitchLiveCache.at < TWITCH_LIVE_CACHE_TTL) {
        return twitchLiveCache.live;
    }
    if (__twitchLiveInflight) return __twitchLiveInflight;

    __twitchLiveInflight = (async () => {
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
            return twitchLiveCache.live || new Set();
        } finally {
            __twitchLiveInflight = null;
        }
    })();
    return __twitchLiveInflight;
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
                
                // Показываем панель только если есть права И гонка не завершена
                const isFinished = race.status === 'finished';
                document.getElementById('hostPanel').style.display = (canManageCurrentRace && !isFinished) ? '' : 'none';
                
                // Кнопка удаления гонки — только для master-host
                const deleteBtn = document.getElementById('hostDeleteBtn');
                if (deleteBtn) deleteBtn.style.display = currentUser.role === 'master-host' ? '' : 'none';

                // Кнопка «Сохранить в историю» — для активных гонок
                const saveBtn = document.getElementById('hostSaveBtn');
                if (saveBtn) saveBtn.style.display = (canManageCurrentRace && race.status === 'active') ? '' : 'none';
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

    // Если у гонки есть сохранённые результаты (снимок в истории) — скрываем
    // интерактивные элементы: панель хоста, готовность, сетку игроков.
    checkHistoryMode();
}

// Проверяет, есть ли у текущей гонки сохранённый снимок в race_results,
// и если да — переключает страницу в «режим истории» (только результаты).
async function checkHistoryMode() {
    if (!currentRaceId) return;
    try {
        const { data: snapshot } = await db
            .from('race_results')
            .select('race_id')
            .eq('race_id', currentRaceId)
            .limit(1);
        const hasSavedResults = snapshot && snapshot.length > 0;

        const hostPanel = document.getElementById('hostPanel');
        const readyCount = document.querySelector('.ready-count');
        const playersGrid = document.getElementById('playersGrid');
        const playersHeader = playersGrid ? playersGrid.previousElementSibling : null;
        const lastUpdated = document.getElementById('lastUpdated');

        if (hasSavedResults) {
            // Режим истории: скрываем всё кроме результатов
            if (hostPanel) hostPanel.style.display = 'none';
            if (readyCount) readyCount.style.display = 'none';
            if (playersHeader && playersHeader.classList.contains('section-header')) playersHeader.style.display = 'none';
            if (playersGrid) playersGrid.style.display = 'none';
            if (lastUpdated) lastUpdated.style.display = 'none';
            stopLiveTimer();
        } else {
            // Обычный режим: показываем всё обратно
            if (readyCount) readyCount.style.display = '';
            if (playersHeader && playersHeader.classList.contains('section-header')) playersHeader.style.display = '';
            if (playersGrid) playersGrid.style.display = '';
            if (lastUpdated) lastUpdated.style.display = '';
        }
    } catch (e) { /* необязательно */ }
}

// Кэш ников Twitch участников по имени игрока, чтобы не дёргать users
// на каждое обновление гонки (сплиты приходят часто через realtime).
const playerTwitchUsernameCache = {}; // playerName -> twitchUsername|null

async function fetchPlayersTwitchUsernames(playerNames) {
    const unknown = [...new Set(playerNames)].filter(n => !(n in playerTwitchUsernameCache));
    if (unknown.length > 0) {
        try {
            // Запрос: сразу с twitch_username, чтобы не делать второй round-trip
            const { data } = await db
                .from('user_profile')
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

let loadPlayersReqId = 0;
async function loadPlayers() {
    if (!currentRaceId) return;
    const reqId = ++loadPlayersReqId;
    try {
        const [playersRes, readyRes] = await Promise.all([
            db.from('players').select('*').eq('race_id', currentRaceId),
            db.from('ready').select('*').eq('race_id', currentRaceId)
        ]);
        if (reqId !== loadPlayersReqId) return;
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
//
// ВАЖНО: во время паузы/загрузки уровня (особенно в Game Time) компонент
// может НЕ присылать total_time, пока таймер стоит. Если мы продолжим
// «дорисовывать» время линейно между апдейтами — на сайте таймер пойдёт
// вперёд, а потом резко откатится, когда придёт новое значение. Это и
// был баг «идёт → откатывается → идёт → откатывается».
//
// Решение: якорь хранит ещё и `lastSeenAt` — момент последнего обновления
// из БД. getLivePlayerTime() «замораживает» таймер на `prev.time`, если
// с `lastSeenAt` прошло больше порога (апдейтов не было — таймер стоит).
// Для Game Time линейная дорисовка ВООБЩЕ отключена (Game Time идёт
// только по игровому таймеру, в LiveSplit он не «тикает» каждую мс).
const liveTimeAnchors = {}; // playerId -> { time, at, lastSeenAt, lastReported, timingMethod, isPaused }

const LIVE_FREEZE_AFTER = {
    realTime: 650,   // Единый порог заморозки при отсутствии пакетов
    gameTime: 650
};

function syncPlayerAnchor(p) {
    const id = p.id;
    if (p.status !== 'racing') {
        delete liveTimeAnchors[id];
        return;
    }

    const timingMethod = p.timing_method === 'GameTime' ? 'gameTime' : 'realTime';
    const reported = Number(p.total_time) || 0;
    const now = Date.now();
    const prev = liveTimeAnchors[id];

    if (!prev) {
        liveTimeAnchors[id] = {
            time: reported,
            at: now,
            lastSeenAt: now,
            lastReported: reported,
            timingMethod,
            isPaused: false
        };
        return;
    }

    // Если игрок переключил метод таймера (RealTime <-> GameTime) в LiveSplit
    if (timingMethod !== prev.timingMethod) {
        const freezeAfter = LIVE_FREEZE_AFTER[prev.timingMethod] || 650;
        const wasFrozen = (now - prev.lastSeenAt) > freezeAfter || prev.isPaused;

        prev.timingMethod = timingMethod;
        prev.time = reported;
        prev.lastReported = reported;

        if (wasFrozen) {
            // Если таймер стоял на паузе или был остановлен, при смене режима он гарантированно остаётся стоять!
            prev.isPaused = true;
            prev.lastSeenAt = 0;
        } else {
            prev.at = now;
            prev.lastSeenAt = now;
        }
        return;
    }

    prev.timingMethod = timingMethod;

    if (reported !== prev.lastReported) {
        const freezeAfter = LIVE_FREEZE_AFTER[timingMethod] || 650;
        const wasFrozen = (now - prev.lastSeenAt) > freezeAfter || prev.isPaused;

        prev.lastSeenAt = now;
        prev.lastReported = reported;
        prev.isPaused = false;

        const currentDisplay = prev.time + (now - prev.at);
        const drift = Math.abs(currentDisplay - reported);

        if (wasFrozen || drift > 350) {
            prev.time = reported;
            prev.at = now;
        } else {
            prev.time = currentDisplay + (reported - currentDisplay) * 0.15;
            prev.at = now;
        }
    } else {
        // Одинаковое значение при повторном опросе
    }
}

function getLivePlayerTime(playerId, raceStartFallback) {
    const a = liveTimeAnchors[playerId];
    if (a) {
        const freezeAfter = LIVE_FREEZE_AFTER[a.timingMethod] || LIVE_FREEZE_AFTER.realTime;
        const sinceUpdate = Date.now() - a.lastSeenAt;
        if (a.isPaused || sinceUpdate > freezeAfter) {
            return a.lastReported;
        }
        return a.time + (Date.now() - a.at);
    }
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

    // Вычисляем структурный хеш сетки.
    // Если структура не изменилась (игрок просто бежит по уровню), мы НЕ пересоздаем DOM grid.innerHTML!
    // Это предотвращает разрушение DOM-элементов и полностью убирает мерцание/разрывы таймера.
    const gridHash = sorted.map(p => {
        const isLd = p.total_time === leaderTime && leaderTime !== Infinity;
        const tw = livePlayerTwitch[p.id] || null;
        return `${p.id}|${p.status}|${p.timing_method}|${p.current_split}|${JSON.stringify(p.splits)}|${isLd}|${tw}|${canManageCurrentRace}`;
    }).join('||');

    if (grid.getAttribute('data-grid-hash') === gridHash) {
        // DOM уже актуален, якоря обновлены в памяти. Живой таймер startLiveTimer продолжит счёт.
        const hasR = sorted.some(p => p.status === 'racing' && (liveTimeAnchors[p.id] || raceStart));
        if (hasR) startLiveTimer(raceStart); else stopLiveTimer();
        return;
    }
    grid.setAttribute('data-grid-hash', gridHash);

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
    }, 33); // обновляем ~30 раз в секунду для плавного отображения сотых
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
    if (!ms || ms <= 0) return '00:00.00';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const centiseconds = Math.floor((ms % 1000) / 10);
    const secStr = seconds.toString().padStart(2, '0');
    const csStr = centiseconds.toString().padStart(2, '0');
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secStr}.${csStr}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secStr}.${csStr}`;
}

function formatDelta(ms) {
    if (!ms || ms <= 0) return '';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const centiseconds = Math.floor((ms % 1000) / 10);
    const secStr = seconds.toString().padStart(2, '0');
    const csStr = centiseconds.toString().padStart(2, '0');
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secStr}.${csStr}`;
    }
    return `${minutes}:${secStr}.${csStr}`;
}

// ============================================================
// REALTIME
// ============================================================

let fallbackPollInterval = null;

function setupRealtimeListeners() {
    if (realtimeChannel) db.removeChannel(realtimeChannel);
    if (fallbackPollInterval) { clearInterval(fallbackPollInterval); fallbackPollInterval = null; }

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
        .subscribe((status) => {
            console.log('[Realtime] Subscription status:', status);
            if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                setTimeout(() => {
                    if (currentRaceId) setupRealtimeListeners();
                }, 2000);
            }
        });

    fallbackPollInterval = setInterval(() => {
        if (currentRaceId && document.hidden === false) {
            loadPlayers();
        }
    }, 3000);
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

// ═══ СОХРАНИТЬ В ИСТОРИЮ (без завершения гонки) ═══
async function saveRaceToHistory() {
    if (!currentRaceId || !canManageCurrentRace) return;
    if (!confirm(tr('confirm.saveToHistory'))) return;

    await finalizeRaceResults();
    showToast(tr('toast.savedToHistory'));
    // Перезагружаем — теперь showRaceResults() покажет сохранённый снимок
    await loadRaceData();
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

    // При смене языка НЕ дёргаем БД повторно — только пересобираем
    // строки в DOM. Узлы с [data-i18n] уже обновлены через applyI18n().
    // Динамические блоки (карточки игроков, топа, профиля) были
    // отрендерены с tr(), но их шаблонные строки статичны — нам нужно
    // только перевести заголовки/лейблы и обновить текст в счётчиках.
    if (currentRaceId) {
        // В гонке: обновляем UI по уже загруженным данным (без сетевых запросов)
        if (typeof updateReadyCount === 'function' && typeof currentPlayersCache !== 'undefined') {
            // — данные есть, но updateReadyCount принимает числа. Не пересчитываем.
        }
        // Гонка: достаточно перевести кнопки/лейблы
        return;
    }
    if (!document.getElementById('page-profile')?.hidden && currentProfileUsername) {
        // Только если у нас уже есть распарсенные данные, чтобы не делать
        // повторный запрос. Иначе — пользователь сам зайдёт ещё раз.
    }
};

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================

// Количество зарегистрированных пользователей на титульном экране.
// Красивая анимация счётчика
let userCountAnimFrame = null;
function animateCount(el, from, to, duration = 900) {
    if (userCountAnimFrame) cancelAnimationFrame(userCountAnimFrame);
    const start = performance.now();
    const diff = to - from;
    if (diff === 0) return;
    function tick(now) {
        const p = Math.min((now - start) / duration, 1);
        // easeOutCubic
        const eased = 1 - Math.pow(1 - p, 3);
        const val = Math.round(from + diff * eased);
        el.textContent = val.toLocaleString('ru-RU');
        if (p < 1) {
            userCountAnimFrame = requestAnimationFrame(tick);
        } else {
            el.textContent = to.toLocaleString('ru-RU');
            // лёгкий pop
            el.style.transform = 'scale(1.15)';
            el.style.transition = 'transform 180ms cubic-bezier(.34,1.56,.64,1)';
            setTimeout(() => { el.style.transform = ''; }, 180);
        }
    }
    userCountAnimFrame = requestAnimationFrame(tick);
}

async function loadUserCount() {
    const el = document.getElementById('statUserCount');
    if (!el) return;
    try {
        const { count, error } = await db
            .from('user_profile')
            .select('*', { count: 'exact', head: true });
        if (error) throw error;
        if (typeof count === 'number') {
            const current = parseInt(String(el.textContent).replace(/[^0-9]/g, '')) || 0;
            // если это первый раз (∞ или 0) – анимируем с 0
            const from = isFinite(current) ? current : 0;
            if (from === count) {
                el.textContent = count.toLocaleString('ru-RU');
                return;
            }
            animateCount(el, from, count, 1000);
        }
    } catch (err) {
        console.error('Не удалось загрузить число пользователей:', err);
        // Оставляем прежнее значение (∞), если запрос не удался.
    }
}

// «Отпечаток» live-набора игроков на странице «Игроки» (для live-poll ниже).
// null = базовая точка ещё не снята (после ручного ререндера снимается заново).
let lastPlayersLiveKey = null;

document.addEventListener('DOMContentLoaded', () => {
    loadUserFromStorage();
    updateAuthUI(); // гарантированно скрыть/показать кнопки в зависимости от входа

    // Загружаем только то, что нужно на текущей странице (роутер
    // уже мог переключиться на другую секцию — повторные вызовы там лишние).
    const onHome = !document.getElementById('page-home')?.hidden;
    if (onHome) {
        loadRaceList();
        loadUserCount();
    }
    // Раздел «История» подгрузится лениво, когда пользователь туда зайдёт.
    // Раздел «Игроки» — тоже (см. refreshPlayersPage).
    updatePlayerSortUI();

    // Автообновление (как раньше — каждые 15с, включая страницу игроков).
    // Но список игроков обновляется «тихо»: данные перезапрашиваются,
    // а DOM перерисовывается ТОЛЬКО если у кого-то изменился live-статус
    // (появился/пропал стрим). Иначе визуально ничего не дёргается.
    setInterval(() => {
        if (!currentRaceId) {
            loadRaceList();
            if (!document.getElementById('page-history')?.hidden) loadRaceHistory();
            if (!document.getElementById('page-players')?.hidden) refreshPlayersPage(true); // silent
            if (onHome) loadUserCount();
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

// ============================================================
// АВАТАРКИ
// ============================================================
// avatar_url хранится в user_profile. Файлы лежат в публичном
// bucket "avatars" в Supabase Storage: {auth.uid()}/avatar.<ext>.
// Если аватарки нет — рисуем цветной круг с первой буквой ника.

// Детерминированный цвет из ника (чтобы у каждого игрока был свой)
function avatarColor(name) {
    let h = 0;
    const s = String(name || '?');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360}, 45%, 42%)`;
}

// HTML аватарки: size = 'sm' | 'lg'
function avatarHtml(username, avatarUrl, size = 'sm') {
    const cls = `avatar avatar-${size}`;
    if (avatarUrl) {
        return `<span class="${cls}"><img src="${escapeHtml(avatarUrl)}" alt="" loading="lazy"
            onerror="this.parentElement.textContent='${escapeHtml(String(username||'?').charAt(0))}';this.parentElement.style.background='${avatarColor(username)}';"></span>`;
    }
    const letter = escapeHtml(String(username || '?').charAt(0));
    return `<span class="${cls}" style="background:${avatarColor(username)};">${letter}</span>`;
}

// Кэш ссылок на аватарки по нику (по аналогии с playerTwitchUsernameCache)
const playerAvatarCache = {}; // username -> avatar_url|null

// Загрузка выбранного файла в Storage + запись ссылки в user_profile
async function uploadAvatar(file) {
    if (!currentUser || !currentUser.id) { showToast(tr('avatar.err.noAuth'), 'error'); return; }
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
        showToast(tr('avatar.err.type'), 'error');
        return;
    }
    if (file.size > 2 * 1024 * 1024) { // 2 МБ
        showToast(tr('avatar.err.size'), 'error');
        return;
    }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${currentUser.id}/avatar.${ext}`;
    try {
        const { error: upErr } = await db.storage
            .from('avatars')
            .upload(path, file, { upsert: true, cacheControl: '3600', contentType: file.type });
        if (upErr) throw upErr;

        // Публичная ссылка + cache-buster, иначе браузер покажет старую картинку
        const { data: pub } = db.storage.from('avatars').getPublicUrl(path);
        const url = pub.publicUrl + '?t=' + Date.now();

        const { error: dbErr } = await db.from('user_profile')
            .update({ avatar_url: url })
            .eq('id', currentUser.id);
        if (dbErr) throw dbErr;

        currentUser.avatar_url = url;
        if (currentUser.username) playerAvatarCache[currentUser.username] = url;
        showToast(tr('avatar.saved'));
        // Перерисовать открытый профиль, если это наш
        if (currentProfileUsername && currentUser.username &&
            currentProfileUsername.toLowerCase() === currentUser.username.toLowerCase()) {
            loadPlayerProfile(currentProfileUsername);
        }
    } catch (err) {
        console.error('uploadAvatar error:', err);
        showToast(tr('avatar.err.upload') + (err.message || ''), 'error');
    }
}

// Удалить аватарку (вернуться к букве)
async function removeAvatar() {
    if (!currentUser || !currentUser.id) return;
    try {
        const { error } = await db.from('user_profile')
            .update({ avatar_url: null })
            .eq('id', currentUser.id);
        if (error) throw error;
        currentUser.avatar_url = null;
        if (currentUser.username) playerAvatarCache[currentUser.username] = null;
        showToast(tr('avatar.removed'));
        if (currentProfileUsername && currentUser.username &&
            currentProfileUsername.toLowerCase() === currentUser.username.toLowerCase()) {
            loadPlayerProfile(currentProfileUsername);
        }
    } catch (err) {
        console.error('removeAvatar error:', err);
        showToast(tr('avatar.err.upload') + (err.message || ''), 'error');
    }
}

// Обработчик скрытого <input type="file"> (см. index.html)
function onAvatarFileChosen(input) {
    const file = input.files && input.files[0];
    input.value = ''; // чтобы повторный выбор того же файла тоже сработал
    if (file) uploadAvatar(file);
}

// === Шестерёнка настроек профиля (выпадающее меню) ===
function toggleProfileSettingsMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('profileSettingsMenu');
    if (menu) menu.classList.toggle('open');
}
function closeProfileSettingsMenu() {
    const menu = document.getElementById('profileSettingsMenu');
    if (menu) menu.classList.remove('open');
}
// Клик мимо меню — закрыть
document.addEventListener('click', (e) => {
    const wrap = document.getElementById('profileSettingsWrap');
    if (wrap && !wrap.contains(e.target)) closeProfileSettingsMenu();
});

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

// Поднимает игроков, которые сейчас live на Twitch, в начало списка.
// Вызывается ПОСЛЕ sortUsersByStats, чтобы сортировка по победам/матчам
// работала ВНУТРИ групп (live отдельно от не-live).
function sortLiveFirst(users, twitchByName, liveSet) {
    if (!liveSet || liveSet.size === 0) return users;
    const isLive = u => {
        const tw = twitchByName[u.username];
        return tw && liveSet.has(String(tw).toLowerCase());
    };
    const live = users.filter(isLive);
    const rest = users.filter(u => !isLive(u));
    return [...live, ...rest];
}

// Отрисовка карточек игроков (общая для поиска и случайного списка)
// `liveSet` — Set() Twitch-ников (в нижнем регистре), которые сейчас live.
function renderPlayerCards(users, stats, twitchByName = {}, liveSet = new Set()) {
    return '<div style="display:flex;flex-direction:column;gap:0.5rem;">' +
        users.map(u => {
            const name = escapeHtml(u.username);
            const avatar = avatarHtml(u.username, u.avatar_url || playerAvatarCache[u.username] || null, 'sm');
            const roleBadge = u.role === 'master-host' ? ' <span style="font-size:0.65rem;color:#e0503f;font-weight:900;">MASTER</span>'
                : u.role === 'host' ? ' <span style="font-size:0.65rem;color:#e8a830;font-weight:900;">HOST</span>' : '';
            const s = stats[u.username] || { races: 0, wins: 0 };
            const tw = twitchByName[u.username] || null;
            const isLive = tw && liveSet.has(String(tw).toLowerCase());

            // Кликабельный бейдж-ссылка, как в гонке. Ссылка отдельная от
            // onclick карточки (event.stopPropagation), чтобы клик по
            // бейджу НЕ открывал профиль игрока.
            const twitchBadge = isLive
                ? `<a href="https://twitch.tv/${encodeURIComponent(tw)}" target="_blank" rel="noopener noreferrer"
                       onclick="event.stopPropagation();"
                       class="player-live-badge"
                       title="${tr('twitch.watchTitle')}">
                       <span class="player-live-dot"></span>${tr('twitch.live')}
                   </a>`
                : '';

            return `
                <div class="race-card ${isLive ? 'player-live' : ''}" data-player="${name}" onclick="location.hash='#profile/${encodeURIComponent(u.username)}'" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;">
                    <div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1;">
                        ${avatar}
                        <div style="min-width:0;flex:1;">
                            <h3 style="margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}${roleBadge}</h3>
                            ${twitchBadge}
                        </div>
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
//
// Оптимизации:
//  1. Twitch live — НЕ блокирует отрисовку: карточки рисуем сразу, бейджи
//     «live» догружаются и точечно вставляются в уже отрисованные карточки.
//  2. users + twitch_username идут одним запросом (joined select), а не двумя.
//  3. stats (race_results) — отдельным запросом, но параллельно с users.
async function loadRandomPlayers() {
    const container = document.getElementById('playerSearchResults');
    if (!container) return;

    lastPlayersLiveKey = null; // список меняется — live-poll снимет новую базовую точку
    container.innerHTML = `<p class="loading-text">⏳ ${tr('players.searching')}</p>`;

    try {
        // Параллельно: список пользователей (с Twitch-ником) + статистика по всем.
        const [usersRes] = await Promise.all([
            db.from('user_profile').select('username, role, twitch_username, avatar_url').limit(200),
            // stats начнёт грузиться только когда узнаем usernames (см. ниже)
        ]);
        const { data: users, error } = usersRes;
        if (error) throw error;

        if (!users || users.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>${tr('players.notFound')}</p></div>`;
            return;
        }

        // Сразу достаём Twitch-ники из результата (без второго запроса)
        const twitchByName = {};
        users.forEach(u => { twitchByName[u.username] = u.twitch_username || null; });
        // Помечаем в глобальный кеш, чтобы не дёргать повторно
        users.forEach(u => {
            playerTwitchUsernameCache[u.username] = u.twitch_username || null;
            playerAvatarCache[u.username] = u.avatar_url || null;
        });

        if (playerSortMode) {
            const stats = await fetchPlayerStats(users.map(u => u.username));
            // Параллельно с stats тянем Twitch live, чтобы сразу отсортировать
            // и отрендерить с бейджами (а не через фоновое DOM-вмешательство).
            const liveSet = await fetchLiveTwitchUsernames(
                Object.values(twitchByName).filter(Boolean)
            );
            const sorted = sortUsersByStats(users, stats).slice(0, 30);
            const ordered = sortLiveFirst(sorted, twitchByName, liveSet);
            const label = playerSortMode === 'wins' ? tr('players.leaderboardWins') : tr('players.leaderboardRaces');
            container.innerHTML =
                `<p style="color:var(--text-dim);font-weight:700;font-size:0.85rem;margin:0 0 0.75rem;">${label}</p>` +
                renderPlayerCards(ordered, stats, twitchByName, liveSet);
            // Базовая точка для «тихого» автообновления — по ВСЕМ юзерам
            // (silent-проверка сравнивает именно с полным набором).
            lastPlayersLiveKey = playersLiveKey(Object.values(twitchByName).filter(Boolean), liveSet);
            return;
        }

        // Перемешиваем на клиенте (Fisher–Yates) и берём 10
        const shuffled = [...users];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const picked = shuffled.slice(0, 10);

        const pickedTwitch = {};
        picked.forEach(u => { pickedTwitch[u.username] = twitchByName[u.username] || null; });

        // Параллельно: stats + проверка live на Twitch. Live проверяем по ВСЕМ
        // юзерам (не только показанным 10) — этот же набор служит базовой
        // точкой для «тихого» автообновления. Карточки рисуем один раз
        // уже с бейджами, без отдельного фонового прохода.
        const [stats, liveSet] = await Promise.all([
            fetchPlayerStats(picked.map(u => u.username)),
            fetchLiveTwitchUsernames(Object.values(twitchByName).filter(Boolean))
        ]);
        const ordered = sortLiveFirst(picked, pickedTwitch, liveSet);

        container.innerHTML =
            `<p style="color:var(--text-dim);font-weight:700;font-size:0.85rem;margin:0 0 0.75rem;">${tr('players.random')}</p>` +
            renderPlayerCards(ordered, stats, pickedTwitch, liveSet);
        // Базовая точка для «тихого» автообновления — по ВСЕМ юзерам,
        // а не только по показанным 10 (silent-проверка смотрит на всех).
        lastPlayersLiveKey = playersLiveKey(Object.values(twitchByName).filter(Boolean), liveSet);

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

    lastPlayersLiveKey = null; // список меняется — live-poll снимет новую базовую точку
    container.innerHTML = `<p class="loading-text">⏳ ${tr('players.searching')}</p>`;

    try {
        // Экранируем спецсимволы ilike-шаблона
        const safe = query.replace(/[%_\\]/g, '\\$&');
        // Один запрос вместо двух: users + twitch_username
        const { data: users, error } = await db
            .from('user_profile')
            .select('username, role, twitch_username, avatar_url')
            .ilike('username', `%${safe}%`)
            .order('username')
            .limit(20);

        if (error) throw error;

        if (!users || users.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>${tr('players.notFound')}</p></div>`;
            return;
        }

        // Помечаем кеш + собираем Twitch-ники и аватарки сразу из результата запроса.
        users.forEach(u => {
            playerTwitchUsernameCache[u.username] = u.twitch_username || null;
            playerAvatarCache[u.username] = u.avatar_url || null;
        });
        const twitchByName = {};
        users.forEach(u => { twitchByName[u.username] = u.twitch_username || null; });
        const twitchUsers = users.map(u => u.twitch_username).filter(Boolean);

        // Параллельно: stats + проверка live на Twitch. Карточки рисуем
        // сразу с бейджами и уже отсортированные (live в начале).
        const [stats, liveSet] = await Promise.all([
            fetchPlayerStats(users.map(u => u.username)),
            fetchLiveTwitchUsernames(twitchUsers)
        ]);
        const sorted = sortUsersByStats(users, stats);
        const ordered = sortLiveFirst(sorted, twitchByName, liveSet);

        container.innerHTML = renderPlayerCards(ordered, stats, twitchByName, liveSet);
        // Базовая точка для «тихого» автообновления
        lastPlayersLiveKey = playersLiveKey(twitchUsers, liveSet);

    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="empty-state"><p>${tr('common.loadingError')}</p></div>`;
    }
}

// Запрашивает у Edge Function список live-стримеров и ТОЧЕЧНО обновляет
// уже отрисованные карточки: добавляет/убирает класс .player-live и бейдж.
// Используется, когда live-статус меняется, пока пользователь сидит
// на странице (например, кто-то пошёл в эфир). Не пересортировывает —
// для подъёма live в начало нужно перерендерить (это делают
// loadRandomPlayers / searchPlayers при следующем вызове).
//
// Дедупликация: пока запрос в полёте, все ожидающие получают тот же Promise.
let __twitchEnrichInFlight = null;
async function enrichPlayersWithTwitchLive(twitchUsernames, container, playerUsernames) {
    if (!twitchUsernames || twitchUsernames.length === 0) return;
    if (__twitchEnrichInFlight) return __twitchEnrichInFlight;
    __twitchEnrichInFlight = (async () => {
        try {
            const liveSet = await fetchLiveTwitchUsernames(twitchUsernames);
            if (!container || !container.isConnected) return;
            const usernameToTwitch = {};
            twitchUsernames.forEach(t => { usernameToTwitch[t.toLowerCase()] = t; });
            container.querySelectorAll('.race-card[data-player]').forEach(card => {
                const name = card.getAttribute('data-player');
                const tw = usernameToTwitch[String(name).toLowerCase()];
                const isLive = tw && liveSet.has(String(tw).toLowerCase());
                const hadBadge = !!card.querySelector('.player-live-badge');
                if (isLive && !hadBadge) {
                    // Добавляем бейдж и класс
                    const h3 = card.querySelector('h3');
                    if (h3 && h3.parentElement) {
                        const badge = document.createElement('a');
                        badge.href = `https://twitch.tv/${encodeURIComponent(tw)}`;
                        badge.target = '_blank';
                        badge.rel = 'noopener noreferrer';
                        badge.onclick = (e) => e.stopPropagation();
                        badge.className = 'player-live-badge';
                        badge.title = tr('twitch.watchTitle');
                        badge.innerHTML = `<span class="player-live-dot"></span>${tr('twitch.live')}`;
                        h3.parentElement.appendChild(badge);
                    }
                    card.classList.add('player-live');
                } else if (!isLive && hadBadge) {
                    card.classList.remove('player-live');
                    const badge = card.querySelector('.player-live-badge');
                    if (badge) badge.remove();
                } else if (isLive) {
                    card.classList.add('player-live');
                }
            });
        } finally {
            __twitchEnrichInFlight = null;
        }
    })();
    return __twitchEnrichInFlight;
}

// «Отпечаток» live-набора: отсортированные ники тех, кто сейчас в эфире.
// Сравниваем два отпечатка, чтобы понять, изменилось ли что-то визуально значимое.
function playersLiveKey(twitches, liveSet) {
    return (twitches || [])
        .map(t => String(t).toLowerCase())
        .filter(t => liveSet.has(t))
        .sort()
        .join(',');
}

// Унифицированный «обновить то, что на странице игроков»: либо поиск, либо рандом.
//
// silent = true (автообновление раз в 15с): НЕ перерисовываем DOM просто так.
// Тихо перезапрашиваем ТОТ ЖЕ набор данных, что и полный рендер (все юзеры
// либо результаты поиска), проверяем live-статус и перерисовываем ТОЛЬКО
// если у кого-то появился/пропал стрим. Важно: проверяем всех, а не только
// отрисованные карточки — вышедший в эфир игрок может быть не среди
// показанных случайных 10, но при ререндере он поднимется наверх.
async function refreshPlayersPage(silent = false) {
    const input = document.getElementById('playerSearchInput');
    if (!input) return;
    const query = input.value.trim();
    const doFull = () => {
        if (query.length >= 2) searchPlayers();
        else loadRandomPlayers();
    };
    if (!silent) { doFull(); return; }

    try {
        // Тот же источник данных, что и у полного рендера
        let twitches = [];
        if (query.length >= 2) {
            const safe = query.replace(/[%_\\]/g, '\\$&');
            const { data } = await db.from('user_profile')
                .select('username, twitch_username')
                .ilike('username', `%${safe}%`)
                .order('username')
                .limit(20);
            twitches = (data || []).map(u => u.twitch_username).filter(Boolean);
        } else {
            const { data } = await db.from('user_profile')
                .select('username, twitch_username')
                .limit(200);
            twitches = (data || []).map(u => u.twitch_username).filter(Boolean);
        }
        if (twitches.length === 0) return;

        const liveSet = await fetchLiveTwitchUsernames(twitches);
        const key = playersLiveKey(twitches, liveSet);
        if (lastPlayersLiveKey === null) {
            // Базовая точка ещё не снята — запоминаем, без перерисовки.
            lastPlayersLiveKey = key;
            return;
        }
        if (key !== lastPlayersLiveKey) {
            lastPlayersLiveKey = key;
            doFull(); // кто-то вышел в эфир / закончил стрим — перерисовываем
        }
    } catch (e) { /* сеть могла моргнуть — попробуем в следующий тик */ }
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
            .from('user_profile')
            .select('username, role, twitch_username, avatar_url')
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

        // ШАГ 1. Параллельно: история гонок + (если есть Twitch) проверка live.
        // Карточки со статистикой покажем только после этого, но заголовок
        // профиля можно отрисовать уже сейчас, чтобы экран не висел пустым.
        const raceResultsPromise = db
            .from('race_results')
            .select('race_id, place, total_time, is_dnf, timing_method')
            .eq('player_name', user.username)
            .order('place', { ascending: true });
        const livePromise = user.twitch_username
            ? fetchLiveTwitchUsernames([user.twitch_username]).then(s => s.has(user.twitch_username.toLowerCase()))
            : Promise.resolve(false);

        const [resultsRes, isTwitchLive] = await Promise.all([raceResultsPromise, livePromise]);

        const rows = resultsRes.data || [];
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
            const twitchStatus = user.twitch_username
                ? `<a href="https://twitch.tv/${encodeURIComponent(user.twitch_username)}" target="_blank" rel="noopener noreferrer" style="font-weight:800;color:#9146ff;text-decoration:none;">${isTwitchLive ? '🔴 ' + tr('twitch.live') + ' · ' : ''}twitch.tv/${escapeHtml(user.twitch_username)}</a>`
                : `<span style="color:var(--text-dim);font-weight:600;">${tr('profile.twitchUnlinked')}</span>`;
            twitchBlockHtml = `
                <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                    ${twitchStatus}
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

        playerAvatarCache[user.username] = user.avatar_url || null;

        // Свой профиль: шестерёнка справа с выпадающим меню настроек
        // (аватар + Twitch), чтобы кнопки не занимали основное пространство.
        let settingsGearHtml = '';
        if (isOwnProfile) {
            const twitchBtnLabel = user.twitch_username ? tr('profile.twitchEdit') + ' Twitch' : tr('profile.twitchLink');
            settingsGearHtml = `
                <div class="profile-settings" id="profileSettingsWrap">
                    <button class="profile-gear-btn" onclick="toggleProfileSettingsMenu(event)" title="${tr('profile.settingsTitle')}" aria-label="${tr('profile.settingsTitle')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    </button>
                    <div class="profile-settings-menu" id="profileSettingsMenu">
                        <button onclick="closeProfileSettingsMenu();document.getElementById('avatarFileInput').click()">${user.avatar_url ? tr('avatar.change') : tr('avatar.upload')}</button>
                        ${user.avatar_url ? `<button onclick="closeProfileSettingsMenu();removeAvatar()">${tr('avatar.remove')}</button>` : ''}
                        <button onclick="closeProfileSettingsMenu();showTwitchSettingsModal()">${twitchBtnLabel}</button>
                    </div>
                </div>`;
        }

        let html = `
            <div class="race-header" style="margin-bottom:1.5rem;">
                <div style="flex:1;min-width:260px;display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">
                    ${avatarHtml(user.username, user.avatar_url, 'lg')}
                    <div style="min-width:200px;flex:1;">
                        <h1 style="margin:0;">${escapeHtml(user.username)}</h1>
                        <p style="margin:6px 0 0;"><span style="color:${roleColor};font-weight:900;font-size:0.8rem;letter-spacing:.5px;">${roleText}</span></p>
                        ${twitchBlockHtml}
                    </div>
                    ${settingsGearHtml}
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
        // Все гонки, у которых есть записи в race_results (сохранённые или завершённые).
        const { data: resultRaces, error: rrErr } = await db
            .from('race_results')
            .select('race_id')
            .order('race_id');

        if (rrErr) throw rrErr;

        const raceIds = [...new Set((resultRaces || []).map(r => r.race_id))];

        if (raceIds.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>${tr('empty.noHistory')}</p></div>`;
            return;
        }

        // Загружаем данные гонок
        const { data: races, error } = await db
            .from('races')
            .select('*')
            .in('id', raceIds)
            .order('started_at', { ascending: false })
            .limit(30);

        if (error) throw error;

        if (!races || races.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>${tr('empty.noHistory')}</p></div>`;
            return;
        }

        // Подтягиваем ВСЕ результаты (не только победителей)
        const allResults = {};
        try {
            const { data: results } = await db
                .from('race_results')
                .select('*')
                .in('race_id', races.map(r => r.id))
                .order('place', { ascending: true });
            (results || []).forEach(r => {
                if (!allResults[r.race_id]) allResults[r.race_id] = [];
                allResults[r.race_id].push(r);
            });
        } catch (e) { /* необязательно */ }

        const lang = (typeof getCurrentLang === 'function' && getCurrentLang() === 'en') ? 'en-US' : 'ru-RU';

        container.innerHTML = races.map(race => {
            const results = allResults[race.id] || [];
            const dateHtml = race.started_at
                ? `<div class="meta" style="margin-bottom:0.6rem;">📅 ${new Date(race.started_at).toLocaleString(lang)}</div>`
                : '';

            // Рендерим таблицу результатов
            let resultsHtml = '';
            if (results.length > 0) {
                // Разделяем на финишировавших и DNF
                const finishedRows = results.filter(r => !r.is_dnf);
                const dnfRows = results.filter(r => r.is_dnf);
                const allRows = [...finishedRows, ...dnfRows];

                resultsHtml = '<div style="display:flex;flex-direction:column;gap:0.35rem;margin:0.5rem 0;">' +
                    allRows.map(r => {
                        const medal = r.is_dnf ? 'DNF'
                            : r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : `#${r.place}`;
                        const time = r.is_dnf ? '—' : formatTime(r.total_time);
                        const gt = r.timing_method === 'GameTime'
                            ? '<span style="font-size:0.65rem;color:#ffd93d;margin-right:3px;">GT</span>' : '';
                        return `
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;${r.is_dnf ? 'opacity:0.5;' : ''}">
                                <span style="display:flex;align-items:center;gap:8px;">
                                    <span style="font-size:0.95rem;min-width:1.8rem;text-align:center;font-weight:700;">${medal}</span>
                                    <span style="font-weight:600;font-family:JetBrains Mono,monospace;font-size:0.85rem;">${escapeHtml(r.player_name)}</span>
                                </span>
                                <span style="font-family:JetBrains Mono,monospace;font-size:0.85rem;color:var(--primary);font-weight:700;">${gt}${time}</span>
                            </div>`;
                    }).join('') + '</div>';
            } else {
                resultsHtml = `<div class="meta">${tr('history.noWinner')}</div>`;
            }

            return `
                <div class="race-card" onclick="location.hash='#race/${race.id}'" style="cursor:pointer;">
                    <h3>${race.name || race.id} ${race.timing_method === 'GameTime' ? '<span style="font-size:0.65rem;color:#ffd93d;border:1px solid #ffd93d;border-radius:5px;padding:1px 5px;vertical-align:middle;">GT</span>' : ''}</h3>
                    <div class="meta">${race.game} — ${race.category}</div>
                    ${resultsHtml}
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