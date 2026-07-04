// ============================================================
// router.js — простой хеш‑роутер для SPA
// Делает один index.html похожим на несколько страниц:
//   #home    — главная
//   #races   — список гонок
//   #race/ID — конкретная гонка
//   #history — история завершённых гонок
//   #players — поиск игроков по нику
//   #profile/НИК — профиль игрока
//   #howto   — как подключиться
// Логика данных живёт в app.js; роутер только показывает нужную
// секцию и вызывает соответствующий загрузчик.
// ============================================================

(function () {
    var PAGES = ['home', 'races', 'race', 'history', 'players', 'profile', 'howto'];

    function showPage(name) {
        PAGES.forEach(function (p) {
            var el = document.getElementById('page-' + p);
            if (el) el.hidden = (p !== name);
        });
        // подсветка активной ссылки в навигации
        document.querySelectorAll('.nav-right a[data-nav]').forEach(function (a) {
            a.classList.toggle('nav-active', a.getAttribute('data-nav') === name);
        });
        // прокрутка наверх при смене «страницы»
        window.scrollTo(0, 0);
    }

    // Разбираем текущий хеш в { name, id }
    function parseHash() {
        var raw = (location.hash || '').replace(/^#\/?/, ''); // убираем # и возможный /
        if (!raw) return { name: 'home', id: null };

        // имя секции = всё до первого '/' или '?'
        var name = raw.split(/[\/?]/)[0];

        // поддержка #profile/НИК
        if (name === 'profile') {
            var pslash = raw.indexOf('/');
            var pid = pslash !== -1 ? decodeURIComponent(raw.slice(pslash + 1)) : null;
            return { name: 'profile', id: pid };
        }

        // поддержка #race/ID  и  #race?id=ID
        if (name === 'race') {
            var id = null;
            var slash = raw.indexOf('/');
            var q = raw.indexOf('?');
            if (slash !== -1) id = decodeURIComponent(raw.slice(slash + 1));
            else if (q !== -1) {
                var params = new URLSearchParams(raw.slice(q + 1));
                id = params.get('id');
            }
            return { name: 'race', id: id };
        }

        // старый раздел «Активные» теперь «История»
        if (name === 'active') name = 'history';

        if (PAGES.indexOf(name) === -1) name = 'home';
        return { name: name, id: null };
    }

    function route() {
        var r = parseHash();

        switch (r.name) {
            case 'races':
                showPage('races');
                if (typeof showRaceList === 'function') showRaceList();
                else if (typeof loadRaceList === 'function') loadRaceList();
                break;

            case 'race':
                if (!r.id) { location.hash = '#races'; return; }
                showPage('race');
                if (typeof showRaceScreen === 'function') showRaceScreen(r.id);
                break;

            case 'history':
                showPage('history');
                // Подгружаем историю лениво: только если мы тут впервые
                // (или после возврата). Не вызываем, если DOMContentLoaded
                // уже загрузил её ранее — но DOMContentLoaded больше не
                // делает этого сам, так что первый заход = здесь.
                if (typeof loadRaceHistory === 'function') loadRaceHistory();
                break;

            case 'players':
                showPage('players');
                // Показываем «случайных» только при первом заходе на страницу.
                // Если в инпуте уже что-то напечатано (например, вернулись
                // назад через hashchange) — отрабатываем как обычный поиск.
                if (typeof refreshPlayersPage === 'function') {
                    refreshPlayersPage();
                } else if (typeof searchPlayers === 'function') {
                    searchPlayers();
                }
                break;

            case 'profile':
                if (!r.id) { location.hash = '#players'; return; }
                showPage('profile');
                if (typeof loadPlayerProfile === 'function') loadPlayerProfile(r.id);
                break;

            case 'howto':
                showPage('howto');
                break;

            case 'home':
            default:
                showPage('home');
                // покидаем экран гонки (отписка от realtime и т.п.)
                if (typeof currentRaceId !== 'undefined' && currentRaceId && typeof showRaceList === 'function') {
                    // мягко сбрасываем активную подписку, не показывая список
                    showRaceList();
                    showPage('home');
                }
                break;
        }
    }

    // Поддержка старых ссылок вида races.html / history.html / race.html?id=…
    function migrateLegacyPath() {
        var path = location.pathname.toLowerCase();
        var map = { 'races.html': '#races', 'active.html': '#history', 'history.html': '#history', 'howto.html': '#howto' };
        for (var file in map) {
            if (path.indexOf(file) !== -1) { location.replace('index.html' + map[file]); return true; }
        }
        if (path.indexOf('race.html') !== -1) {
            var id = new URLSearchParams(location.search).get('id');
            location.replace('index.html#race/' + (id || ''));
            return true;
        }
        return false;
    }

    window.addEventListener('hashchange', route);
    document.addEventListener('DOMContentLoaded', function () {
        if (migrateLegacyPath()) return;
        route();
    });

    // экспорт на случай ручного вызова
    window.navigateTo = function (hash) { location.hash = hash; };
})();
