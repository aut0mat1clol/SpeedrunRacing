// ============================================================
// i18n.js — переключение языка RU / EN
// ============================================================

(function () {
    const STORAGE_KEY = 'srt-lang';
    const DEFAULT_LANG = 'ru';

    const dict = {
        ru: {
            'nav.races': 'Гонки',
            'nav.active': 'Активные',
            'nav.howto': 'Как подключиться',
            'nav.login': 'Войти',
            'nav.logout': 'Выйти',
            'theme.title': 'Сменить тему',
            'lang.title': 'Switch language',

            'home.subtitle': 'Соревновательные гонки в реальном времени',
            'home.stat.timer': 'Live‑таймер',
            'home.stat.splits': 'Сплиты',
            'home.stat.players': 'Игроков',
            'home.cta': 'Посмотреть гонки →',
            'home.welcome': 'Добро пожаловать!',
            'home.text': 'Здесь ты можешь создавать и участвовать в соревновательных гонках по спидрану.<br>Всё происходит в реальном времени через LiveSplit.',

            'races.title': 'Все гонки',
            'races.create': '+ Создать гонку',
            'races.loading': 'Загрузка гонок…',

            'race.back': '← Назад к гонкам',
            'race.hostPanel': 'Панель организатора',
            'race.start': '▶ Старт гонки',
            'race.finish': '🏁 Завершить',
            'race.countdown': 'Обратный отсчёт:',
            'race.seconds': 'сек',
            'race.countdown.5': '5 сек',
            'race.countdown.10': '10 сек',
            'race.countdown.15': '15 сек',
            'race.countdown.30': '30 сек',
            'race.delete': '🗑️ Удалить гонку',
            'race.readyTitle': 'Готовность участников',
            'race.readyText': 'Готовы:',
            'race.results': 'Результаты',
            'race.players': 'Участники',
            'race.playersLoading': 'Загрузка участников…',
            'race.updatedDash': 'Обновлено: —',

            'active.title': 'Активные игроки',
            'active.loading': 'Загрузка игроков…',

            'howto.title': 'Как подключиться к гонке',
            'howto.install.title': 'Установи компонент',
            'howto.install.text': 'Добавь SpeedRun Race Tracker в LiveSplit',
            'howto.download': 'Скачать .dll',
            'howto.register.title': 'Зарегистрируйся',
            'howto.register.text': 'Создай аккаунт на этом сайте',
            'howto.auth.title': 'Авторизуйся в LiveSplit',
            'howto.auth.text': 'Введи логин и пароль в настройках компонента',
            'howto.join.title': 'Подключись к гонке',
            'howto.join.text': 'Введи ID гонки и нажми «Подключиться»',

            'auth.title': 'Авторизация',
            'auth.loginTab': 'Вход',
            'auth.registerTab': 'Регистрация',
            'auth.username': 'Логин',
            'auth.password': 'Пароль',
            'auth.loginPlaceholder': 'Введите логин',
            'auth.passwordPlaceholder': 'Введите пароль',
            'auth.regUsernamePlaceholder': 'Придумайте логин',
            'auth.regPasswordPlaceholder': 'Придумайте пароль',
            'auth.cancel': 'Отмена',
            'auth.login': 'Войти',
            'auth.createAccount': 'Создать аккаунт',

            'create.title': 'Создать гонку',
            'create.id': 'ID гонки',
            'create.name': 'Название',
            'create.game': 'Игра',
            'create.category': 'Категория',
            'create.idPlaceholder': 'например: any-percent-1',
            'create.namePlaceholder': 'Название гонки',
            'create.gamePlaceholder': 'Название игры',
            'create.categoryPlaceholder': 'например: Any%',
            'create.submit': 'Создать',

            // Dynamic app.js strings
            'status.waiting': 'Ожидание',
            'status.active': 'Идёт гонка',
            'status.finished': 'Завершена',
            'player.joined': '👤 Участник',
            'player.ready': '✓ Готов',
            'player.racing': '🏃 В гонке',
            'player.finished': '🏁 Финиш',
            'empty.noPlayers.title': '👥 Нет участников',
            'empty.noPlayers.text': 'Присоединяйтесь первым!',
            'empty.noRaces.title': '🏁 Нет активных гонок',
            'empty.noRaces.text': 'Ожидайте, пока организатор создаст гонку',
            'empty.noActivePlayers': 'Пока нет активных игроков',
            'common.updated': 'Обновлено:',
            'common.loadingError': 'Ошибка загрузки',
            'common.player': 'Игрок',
            'common.status': 'Статус',
            'common.time': 'Время',
            'common.you': '(вы)',
            'common.kickTitle': 'Удалить игрока',
            'split.default': 'Split',
            'player.finishInLiveSplit': 'Финиш фиксируется в LiveSplit',
            'results.final': '🏁 Итоговый топ гонки',
            'results.live': '⏳ Финишировали: {finished} из {total} — топ обновляется по мере финиша',
            'autostart.notice': '🟢 Все готовы — авто-старт через 5 сек!',

            'confirm.startRace': 'Запустить гонку? Отсчёт: {seconds} сек.',
            'confirm.finishRace': 'Завершить гонку? Не финишировавшие попадут в топ как DNF. Гонка исчезнет из списка активных.',
            'confirm.kickPlayer': 'Удалить игрока из гонки?',
            'confirm.deleteRace': '🗑️ Удалить гонку полностью? Это удалит всех участников и результаты. Отменить нельзя.',
            'alert.loginFirst': 'Сначала войдите в аккаунт',
            'alert.requiredRace': 'ID гонки и название игры обязательны',
            'alert.error': 'Ошибка: ',
            'alert.deleteError': 'Ошибка удаления: ',
            'toast.raceDeleted': 'Гонка удалена',
            'toast.loggedOut': 'Вы вышли из аккаунта',
            'toast.welcome': 'Добро пожаловать, {name}!',
            'toast.registerSuccess': 'Регистрация успешна!',
            'auth.err.required': 'Введите имя и пароль',
            'auth.err.invalid': 'Неверное имя или пароль',
            'auth.err.login': 'Ошибка входа',
            'auth.err.requiredRegister': 'Имя и пароль обязательны',
            'auth.err.usernameShort': 'Имя должно быть минимум 3 символа',
            'auth.err.userExists': 'Пользователь с таким именем уже существует',
            'auth.err.register': 'Ошибка регистрации',
            'auth.err.registerPrefix': 'Ошибка регистрации: '
        },
        en: {
            'nav.races': 'Races',
            'nav.active': 'Active',
            'nav.howto': 'How to connect',
            'nav.login': 'Log in',
            'nav.logout': 'Log out',
            'theme.title': 'Toggle theme',
            'lang.title': 'Переключить язык',

            'home.subtitle': 'Real-time speedrun races',
            'home.stat.timer': 'Live timer',
            'home.stat.splits': 'Splits',
            'home.stat.players': 'Players',
            'home.cta': 'View races →',
            'home.welcome': 'Welcome!',
            'home.text': 'Create and join competitive speedrun races here.<br>Everything happens in real time through LiveSplit.',

            'races.title': 'All races',
            'races.create': '+ Create race',
            'races.loading': 'Loading races…',

            'race.back': '← Back to races',
            'race.hostPanel': 'Host panel',
            'race.start': '▶ Start race',
            'race.finish': '🏁 Finish',
            'race.countdown': 'Countdown:',
            'race.seconds': 'sec',
            'race.countdown.5': '5 sec',
            'race.countdown.10': '10 sec',
            'race.countdown.15': '15 sec',
            'race.countdown.30': '30 sec',
            'race.delete': '🗑️ Delete race',
            'race.readyTitle': 'Participant readiness',
            'race.readyText': 'Ready:',
            'race.results': 'Results',
            'race.players': 'Participants',
            'race.playersLoading': 'Loading participants…',
            'race.updatedDash': 'Updated: —',

            'active.title': 'Active players',
            'active.loading': 'Loading players…',

            'howto.title': 'How to connect to a race',
            'howto.install.title': 'Install the component',
            'howto.install.text': 'Add SpeedRun Race Tracker to LiveSplit',
            'howto.download': 'Download .dll',
            'howto.register.title': 'Register',
            'howto.register.text': 'Create an account on this site',
            'howto.auth.title': 'Log in in LiveSplit',
            'howto.auth.text': 'Enter your username and password in the component settings',
            'howto.join.title': 'Join a race',
            'howto.join.text': 'Enter the race ID and click “Connect”',

            'auth.title': 'Authorization',
            'auth.loginTab': 'Login',
            'auth.registerTab': 'Register',
            'auth.username': 'Username',
            'auth.password': 'Password',
            'auth.loginPlaceholder': 'Enter username',
            'auth.passwordPlaceholder': 'Enter password',
            'auth.regUsernamePlaceholder': 'Choose a username',
            'auth.regPasswordPlaceholder': 'Choose a password',
            'auth.cancel': 'Cancel',
            'auth.login': 'Log in',
            'auth.createAccount': 'Create account',

            'create.title': 'Create race',
            'create.id': 'Race ID',
            'create.name': 'Name',
            'create.game': 'Game',
            'create.category': 'Category',
            'create.idPlaceholder': 'for example: any-percent-1',
            'create.namePlaceholder': 'Race name',
            'create.gamePlaceholder': 'Game title',
            'create.categoryPlaceholder': 'for example: Any%',
            'create.submit': 'Create',

            // Dynamic app.js strings
            'status.waiting': 'Waiting',
            'status.active': 'Race in progress',
            'status.finished': 'Finished',
            'player.joined': '👤 Joined',
            'player.ready': '✓ Ready',
            'player.racing': '🏃 Racing',
            'player.finished': '🏁 Finished',
            'empty.noPlayers.title': '👥 No participants',
            'empty.noPlayers.text': 'Be the first to join!',
            'empty.noRaces.title': '🏁 No active races',
            'empty.noRaces.text': 'Wait until a host creates a race',
            'empty.noActivePlayers': 'No active players yet',
            'common.updated': 'Updated:',
            'common.loadingError': 'Loading error',
            'common.player': 'Player',
            'common.status': 'Status',
            'common.time': 'Time',
            'common.you': '(you)',
            'common.kickTitle': 'Kick player',
            'split.default': 'Split',
            'player.finishInLiveSplit': 'Finish is recorded in LiveSplit',
            'results.final': '🏁 Final race standings',
            'results.live': '⏳ Finished: {finished} of {total} — standings update as players finish',
            'autostart.notice': '🟢 Everyone is ready — auto-start in 5 sec!',

            'confirm.startRace': 'Start the race? Countdown: {seconds} sec.',
            'confirm.finishRace': 'Finish the race? Unfinished players will be listed as DNF. The race will disappear from the active list.',
            'confirm.kickPlayer': 'Kick this player from the race?',
            'confirm.deleteRace': '🗑️ Delete this race completely? This will delete all participants and results. This cannot be undone.',
            'alert.loginFirst': 'Log in first',
            'alert.requiredRace': 'Race ID and game title are required',
            'alert.error': 'Error: ',
            'alert.deleteError': 'Delete error: ',
            'toast.raceDeleted': 'Race deleted',
            'toast.loggedOut': 'You have logged out',
            'toast.welcome': 'Welcome, {name}!',
            'toast.registerSuccess': 'Registration successful!',
            'auth.err.required': 'Enter username and password',
            'auth.err.invalid': 'Invalid username or password',
            'auth.err.login': 'Login error',
            'auth.err.requiredRegister': 'Username and password are required',
            'auth.err.usernameShort': 'Username must be at least 3 characters',
            'auth.err.userExists': 'A user with this name already exists',
            'auth.err.register': 'Registration error',
            'auth.err.registerPrefix': 'Registration error: '
        }
    };

    function getLang() {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved === 'en' || saved === 'ru' ? saved : DEFAULT_LANG;
    }

    function t(key, vars) {
        const lang = getLang();
        let value = (dict[lang] && dict[lang][key]) || dict.ru[key] || key;
        if (vars) {
            Object.keys(vars).forEach(k => {
                value = value.replaceAll('{' + k + '}', String(vars[k]));
            });
        }
        return value;
    }

    function applyI18n(root) {
        const lang = getLang();
        document.documentElement.lang = lang;

        (root || document).querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.innerHTML = t(key);
        });

        (root || document).querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
        });

        (root || document).querySelectorAll('[data-i18n-title]').forEach(el => {
            const text = t(el.getAttribute('data-i18n-title'));
            el.setAttribute('title', text);
            el.setAttribute('aria-label', text);
        });

        const btn = document.getElementById('languageToggle');
        if (btn) btn.textContent = lang.toUpperCase();

        // Обновить динамические блоки после смены языка.
        if (typeof window.refreshCurrentViewTranslations === 'function') {
            window.refreshCurrentViewTranslations();
        }
    }

    window.t = t;
    window.getCurrentLang = getLang;
    window.setLanguage = function (lang) {
        if (lang !== 'ru' && lang !== 'en') return;
        localStorage.setItem(STORAGE_KEY, lang);
        applyI18n(document);
    };
    window.toggleLanguage = function () {
        window.setLanguage(getLang() === 'ru' ? 'en' : 'ru');
    };
    window.applyI18n = applyI18n;

    document.addEventListener('DOMContentLoaded', () => applyI18n(document));
})();
