// Оборачиваем всё в IIFE (самовызывающуюся функцию), 
// чтобы переменные (const, let) не конфликтовали с глобальными 
// переменными из других файлов, например config.js.
(function() {
    const MY_SUPABASE_URL = window.SUPABASE_URL || 'https://bijlcubwwotzbhukbabw.supabase.co';
    const MY_SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'твой_ключ_сюда';

    // Если config.js уже создал клиент supabase, мы можем его использовать.
    // Иначе создаём свой.
    let mySupabase;
    if (window.db && typeof window.db.from === 'function') {
        mySupabase = window.db; // fallback
    } else {
        mySupabase = window.supabase.createClient(MY_SUPABASE_URL, MY_SUPABASE_ANON_KEY);
    }

    const params = new URLSearchParams(window.location.search);
    const raceId = params.get('raceId');
    const playerId = params.get('playerId');
    const showName = params.get('name') === '1';
    const showTimer = params.get('timer') === '1';
    const showSplit = params.get('split') === '1';
    const showMillis = params.get('ms') !== '0';
    const ct = params.get('ct') || 'ffffff';
    const cn = params.get('cn') || '6aad38';
    const cs = params.get('cs') || 'a0a0a0';
    const bg = params.get('bg') || 'transparent';
    const pos = params.get('pos') || 'tl';

    // Применяем настройки
    document.documentElement.style.setProperty('--timer-color', '#' + ct);
    document.documentElement.style.setProperty('--name-color', '#' + cn);
    document.documentElement.style.setProperty('--split-color', '#' + cs);
    if (bg !== 'transparent') {
        document.body.style.backgroundColor = '#' + bg;
    }

    const alignments = {
        'tl': { j: 'flex-start', a: 'flex-start', t: 'left', dir: 'column' },
        'tc': { j: 'flex-start', a: 'center', t: 'center', dir: 'column' },
        'tr': { j: 'flex-start', a: 'flex-end', t: 'right', dir: 'column' },
        'bl': { j: 'flex-end', a: 'flex-start', t: 'left', dir: 'column-reverse' },
        'bc': { j: 'flex-end', a: 'center', t: 'center', dir: 'column-reverse' },
        'br': { j: 'flex-end', a: 'flex-end', t: 'right', dir: 'column-reverse' }
    };
    const st = alignments[pos] || alignments['tl'];
    document.body.style.justifyContent = st.j;
    document.body.style.alignItems = st.a;
    const container = document.getElementById('overlay-container');
    container.style.alignItems = st.a;
    container.style.textAlign = st.t;
    container.style.flexDirection = st.dir;

    const nameEl = document.getElementById('player-name');
    const timerEl = document.getElementById('timer');
    const splitEl = document.getElementById('current-split');
    timerEl.textContent = formatTime(0);

    if (showName) nameEl.classList.remove('hidden');
    if (showTimer) timerEl.classList.remove('hidden');
    if (showSplit) splitEl.classList.remove('hidden');

    let raceStartTime = null;
    let currentParticipant = null;

    // Логика интерполяции времени как в app.js
    let anchor = null;
    const LIVE_FREEZE_AFTER = { realTime: 650, gameTime: 650 };
    let liveTimerInterval = null;

    function formatTime(ms) {
        if (ms < 0) ms = 0;
        const hrs = Math.floor(ms / 3600000);
        const mins = Math.floor((ms % 3600000) / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        
        if (!showMillis) {
            return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        
        const cs = Math.floor((ms % 1000) / 10);
        let s = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
        if (hrs > 0) s = `${hrs.toString().padStart(2, '0')}:` + s;
        return s;
    }

    function syncAnchor(p) {
        if (p.status !== 'racing') {
            anchor = null;
            return;
        }

        const timingMethod = p.timing_method === 'GameTime' ? 'gameTime' : 'realTime';
        const reported = Number(p.total_time) || 0;
        const now = Date.now();

        if (!anchor) {
            anchor = {
                time: reported,
                at: now,
                lastSeenAt: now,
                lastReported: reported,
                timingMethod,
                isPaused: false
            };
            return;
        }

        if (timingMethod !== anchor.timingMethod) {
            const freezeAfter = LIVE_FREEZE_AFTER[anchor.timingMethod] || 650;
            const wasFrozen = (now - anchor.lastSeenAt) > freezeAfter || anchor.isPaused;
            anchor.timingMethod = timingMethod;
            anchor.time = reported;
            anchor.lastReported = reported;
            if (wasFrozen) {
                anchor.isPaused = true;
                anchor.lastSeenAt = 0;
            } else {
                anchor.at = now;
                anchor.lastSeenAt = now;
            }
            return;
        }

        // Компонент отправляет PATCH параллельно; более старый запрос иногда
        // приходит после нового. Во время racing время монотонно, поэтому такой
        // пакет игнорируем вместо визуального отката OBS-таймера.
        if (reported < anchor.lastReported) return;

        if (reported !== anchor.lastReported) {
            const freezeAfter = LIVE_FREEZE_AFTER[timingMethod] || 650;
            const wasFrozen = (now - anchor.lastSeenAt) > freezeAfter || anchor.isPaused;
            anchor.lastSeenAt = now;
            anchor.lastReported = reported;
            anchor.isPaused = false;

            const currentDisplay = anchor.time + (now - anchor.at);
            const drift = Math.abs(currentDisplay - reported);

            if (wasFrozen || drift > 350) {
                anchor.time = reported;
                anchor.at = now;
            } else {
                anchor.time = currentDisplay + (reported - currentDisplay) * 0.15;
                anchor.at = now;
            }
        }
    }

    function getLiveTime() {
        if (anchor) {
            const freezeAfter = LIVE_FREEZE_AFTER[anchor.timingMethod] || LIVE_FREEZE_AFTER.realTime;
            const sinceUpdate = Date.now() - anchor.lastSeenAt;
            if (anchor.isPaused || sinceUpdate > freezeAfter) {
                return anchor.lastReported;
            }
            return anchor.time + (Date.now() - anchor.at);
        }
        if (raceStartTime) return Date.now() - raceStartTime;
        return 0;
    }

    function updateUI() {
        if (!currentParticipant) return;

        if (showName) {
            nameEl.textContent = currentParticipant.name || currentParticipant.id;
        }

        if (showSplit) {
            const splits = typeof currentParticipant.splits === 'string' ? JSON.parse(currentParticipant.splits || '{}') : (currentParticipant.splits || {});
            const names = typeof currentParticipant.split_names === 'string' ? JSON.parse(currentParticipant.split_names || '{}') : (currentParticipant.split_names || {});
            let splitText = '';
            if (currentParticipant.status === 'finished') {
                splitText = 'Finished';
            } else if (currentParticipant.status === 'racing') {
                const idx = currentParticipant.current_split || 0;
                splitText = names[idx] || `Split ${idx + 1}`;
            } else {
                splitText = currentParticipant.status;
            }
            splitEl.textContent = splitText;
        }

        if (showTimer && currentParticipant.status !== 'racing') {
            if (currentParticipant.total_time) {
                timerEl.textContent = formatTime(currentParticipant.total_time);
            } else {
                timerEl.textContent = formatTime(0);
            }
        }
    }

    function startLiveTimer() {
        if (liveTimerInterval) clearInterval(liveTimerInterval);
        liveTimerInterval = setInterval(() => {
            if (!currentParticipant || currentParticipant.status !== 'racing' || !showTimer) return;
            timerEl.textContent = formatTime(getLiveTime());
        }, 33);
    }

    async function loadData() {
        try {
            if (!raceId || !playerId) {
                nameEl.textContent = "Error: Missing raceId or playerId in URL";
                nameEl.classList.remove('hidden');
                return;
            }

            const { data: raceData, error: raceErr } = await mySupabase.from('races').select('started_at').eq('id', raceId).single();
            if (raceErr) {
                console.error('Race fetch error:', raceErr);
            } else if (raceData && raceData.started_at) {
                raceStartTime = new Date(raceData.started_at).getTime();
            }

            const { data: partData, error: partErr } = await mySupabase.from('players').select('*').eq('race_id', raceId).eq('id', playerId).single();
            if (partErr) {
                console.error('Player fetch error:', partErr);
                nameEl.textContent = "Error loading player: " + partErr.message;
                nameEl.classList.remove('hidden');
                return;
            }

            if (partData) {
                currentParticipant = partData;
                syncAnchor(currentParticipant);
                updateUI();
            } else {
                nameEl.textContent = "Player not found";
                nameEl.classList.remove('hidden');
                return;
            }

            startLiveTimer();

            mySupabase.channel(`obs_updates_${playerId}`)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `race_id=eq.${raceId}` }, payload => {
                    if (payload.new && payload.new.id === playerId) {
                        currentParticipant = payload.new;
                        syncAnchor(currentParticipant);
                        updateUI();
                    }
                })
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'races', filter: `id=eq.${raceId}` }, payload => {
                    if (payload.new && payload.new.started_at) {
                        raceStartTime = new Date(payload.new.started_at).getTime();
                    }
                })
                .subscribe();

        } catch (err) {
            console.error('loadData Exception:', err);
            nameEl.textContent = "Script Error: " + err.message;
            nameEl.classList.remove('hidden');
        }
    }

    // Запуск только после того, как DOM и конфигурация загрузились
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadData);
    } else {
        loadData();
    }
})();
