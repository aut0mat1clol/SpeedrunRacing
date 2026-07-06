// ============================================================
// i18n.js — переключение языка RU / EN
// ============================================================

(function () {
    const STORAGE_KEY = 'srt-lang';
    const DEFAULT_LANG = 'ru';

    const dict = {
        ru: {
            'nav.races': 'Гонки',
            'nav.history': 'История',
            'nav.players': 'Игроки',
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
            'race.saveToHistory': '💾 Сохранить в историю',
            'race.gameTimeWarning': 'Эта гонка использует Game Time. Перед подключением обязательно выберите в LiveSplit «Compare Against → Game Time», иначе ваше время будет засчитано неверно.',
            'race.readyTitle': 'Готовность участников',
            'race.readyText': 'Готовы:',
            'race.results': 'Результаты',
            'race.players': 'Участники',
            'race.playersLoading': 'Загрузка участников…',
            'race.updatedDash': 'Обновлено: —',

            'history.title': 'История гонок',
            'history.loading': 'Загрузка истории…',
            'history.noWinner': 'Победитель не зафиксирован',

            'players.title': 'Поиск игроков',
            'players.placeholder': 'Введите ник…',
            'players.hint': 'Введите минимум 2 символа для поиска',
            'players.searching': 'Поиск…',
            'players.notFound': 'Игроки не найдены',
            'players.random': '🎲 Случайные игроки',
            'players.racesTitle': 'Завершённых гонок',
            'players.winsTitle': 'Побед',
            'players.sortWins': 'По победам',
            'players.sortRaces': 'По матчам',
            'players.sortReset': '✕ Сброс',
            'players.leaderboardWins': '🥇 Топ по победам',
            'players.leaderboardRaces': '🏁 Топ по количеству матчей',

            'profile.back': '← Назад к поиску',
            'profile.loading': 'Загрузка профиля…',
            'profile.notFound': '😕 Игрок не найден',
            'profile.rolePlayer': 'ИГРОК',
            'profile.stat.races': 'Гонок',
            'profile.stat.wins': 'Побед',
            'profile.stat.podiums': 'Подиумов',
            'profile.recentRaces': 'Последние гонки',
            'profile.noRaces': 'Этот игрок ещё не участвовал в завершённых гонках',
            'profile.twitch': 'Twitch',
            'profile.twitchPlaceholder': 'например: shroud',
            'profile.twitchLabel': 'Ваш Twitch:',
            'profile.twitchHintOwn': 'Укажите ваш ник на Twitch — ссылка появится в вашем профиле, а во время гонки другие увидят кнопку перехода на стрим, если вы в эфире.',
            'profile.twitchSaved': 'Сохранено',
            'profile.twitchSave': 'Сохранить',
            'profile.twitchSettingsTitle': 'Настройка Twitch',
            'profile.twitchEdit': 'Изменить',
            'profile.twitchLink': 'Привязать Twitch',
            'profile.twitchUnlinked': 'Twitch не привязан',
            'profile.settingsTitle': 'Настройки профиля',
            'avatar.upload': 'Загрузить аватар',
            'avatar.change': 'Сменить аватар',
            'avatar.remove': 'Удалить аватар',
            'avatar.saved': 'Аватар обновлён',
            'avatar.removed': 'Аватар удалён',
            'avatar.err.noAuth': 'Войдите, чтобы загрузить аватар',
            'avatar.err.type': 'Только изображения: PNG, JPG, WEBP или GIF',
            'avatar.err.size': 'Файл слишком большой (макс. 2 МБ)',
            'avatar.err.upload': 'Ошибка загрузки аватара: ',

            'howto.title': 'Как подключиться к гонке',
            'howto.intro': 'Скачай компонент для LiveSplit, добавь его в layouts, зарегистрируйся на сайте и подключись к гонке.',
            'howto.recommended': 'Компонент для LiveSplit',
            'howto.recommendedText': 'Скачайте архив, распакуйте его и следуйте инструкции по установке.',
            'howto.dllOnly': 'Только DLL (для опытных)',
            'howto.dllOnlyText': 'Если знаете, куда положить файл. Может вызвать предупреждение SmartScreen — добавьте в исключения.',
            'howto.downloadLabel': 'Скачать',
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

            'profileSettings.title': 'Настройки профиля',
            'profileSettings.twitch': 'Ник на Twitch',
            'profileSettings.twitchPlaceholder': 'например: shroud',
            'profileSettings.twitchHint': 'Укажите ваш ник на Twitch (без ссылки, только имя канала) — на странице профиля и во время гонки, если вы стримите, у остальных появится кнопка перехода на ваш стрим.',
            'profileSettings.save': 'Сохранить',
            'profileSettings.saved': 'Настройки профиля сохранены',
            'profileSettings.err.invalid': 'Некорректный ник Twitch. Допустимы буквы, цифры и подчёркивание (2–25 символов).',
            'profileSettings.err.save': 'Ошибка сохранения: ',

            'twitch.watch': 'Смотреть стрим',
            'twitch.watchTitle': 'Игрок сейчас стримит на Twitch',
            'twitch.profile': 'Twitch',
            'twitch.live': 'В эфире',

            'create.title': 'Создать гонку',
            'create.id': 'ID гонки',
            'create.name': 'Название',
            'create.game': 'Игра',
            'create.category': 'Категория',
            'create.idPlaceholder': 'например: race_00001',
            'create.namePlaceholder': 'Название гонки (Необязательно)',
            'create.gamePlaceholder': 'Название игры',
            'create.categoryPlaceholder': 'например: Any%',
            'create.timingMethod': 'Метод времени',
            'create.timingMethod.realTime': 'Real Time',
            'create.timingMethod.gameTime': 'Game Time',
            'create.timingMethod.warning': 'Внимание! Если выбран Game Time, каждый участник обязан заранее, ещё до подключения к гонке, выбрать в LiveSplit «Compare Against → Game Time». Иначе время будет учитываться неправильно.',
            'create.timingMethod.confirm': 'Вы выбрали Game Time. Убедитесь, что все участники предупреждены и выберут в LiveSplit «Compare Against → Game Time» перед подключением. Продолжить создание гонки?',
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
            'empty.noHistory': 'Сохранённых результатов пока нет',
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
            'confirm.finishRace': 'Завершить гонку? Не финишировавшие попадут в топ как DNF. Гонка переместится в раздел «История».',
            'confirm.saveToHistory': 'Сохранить текущие результаты в историю? Гонка останется активной, а снимок текущего топа попадёт в раздел «История».',
            'confirm.kickPlayer': 'Удалить игрока из гонки?',
            'confirm.deleteRace': '🗑️ Удалить гонку полностью? Это удалит всех участников и результаты. Отменить нельзя.',
            'alert.loginFirst': 'Сначала войдите в аккаунт',
            'alert.requiredRace': 'ID гонки и название игры обязательны',
            'alert.error': 'Ошибка: ',
            'alert.deleteError': 'Ошибка удаления: ',
            'toast.raceDeleted': 'Гонка удалена',
            'toast.savedToHistory': 'Результаты сохранены в историю!',
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
            'nav.history': 'History',
            'nav.players': 'Players',
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
            'race.saveToHistory': '💾 Save to history',
            'race.gameTimeWarning': 'This race uses Game Time. Before joining, make sure to set “Compare Against → Game Time” in LiveSplit, otherwise your time won\'t be tracked correctly.',
            'race.readyTitle': 'Participant readiness',
            'race.readyText': 'Ready:',
            'race.results': 'Results',
            'race.players': 'Participants',
            'race.playersLoading': 'Loading participants…',
            'race.updatedDash': 'Updated: —',

            'history.title': 'Race history',
            'history.loading': 'Loading history…',
            'history.noWinner': 'No winner recorded',

            'players.title': 'Player search',
            'players.placeholder': 'Enter a nickname…',
            'players.hint': 'Type at least 2 characters to search',
            'players.searching': 'Searching…',
            'players.notFound': 'No players found',
            'players.random': '🎲 Random players',
            'players.racesTitle': 'Finished races',
            'players.winsTitle': 'Wins',
            'players.sortWins': 'By wins',
            'players.sortRaces': 'By matches',
            'players.sortReset': '✕ Reset',
            'players.leaderboardWins': '🥇 Top by wins',
            'players.leaderboardRaces': '🏁 Top by number of matches',

            'profile.back': '← Back to search',
            'profile.loading': 'Loading profile…',
            'profile.notFound': '😕 Player not found',
            'profile.rolePlayer': 'PLAYER',
            'profile.stat.races': 'Races',
            'profile.stat.wins': 'Wins',
            'profile.stat.podiums': 'Podiums',
            'profile.recentRaces': 'Recent races',
            'profile.noRaces': 'This player has not taken part in any finished races yet',
            'profile.twitch': 'Twitch',
            'profile.twitchPlaceholder': 'e.g. shroud',
            'profile.twitchLabel': 'Your Twitch:',
            'profile.twitchHintOwn': 'Add your Twitch username — the link will show in your profile, and during a race others will see a button to your stream when you go live.',
            'profile.twitchSaved': 'Saved',
            'profile.twitchSave': 'Save',
            'profile.twitchSettingsTitle': 'Twitch settings',
            'profile.twitchEdit': 'Edit',
            'profile.twitchLink': 'Link Twitch',
            'profile.twitchUnlinked': 'Twitch not linked',
            'profile.settingsTitle': 'Profile settings',
            'avatar.upload': 'Upload avatar',
            'avatar.change': 'Change avatar',
            'avatar.remove': 'Remove avatar',
            'avatar.saved': 'Avatar updated',
            'avatar.removed': 'Avatar removed',
            'avatar.err.noAuth': 'Log in to upload an avatar',
            'avatar.err.type': 'Images only: PNG, JPG, WEBP or GIF',
            'avatar.err.size': 'File is too large (max 2 MB)',
            'avatar.err.upload': 'Avatar upload error: ',

            'howto.title': 'How to connect to a race',
            'howto.intro': 'Download the LiveSplit component, add it to your layouts, sign up on the site, and join a race.',
            'howto.recommended': 'LiveSplit Component',
            'howto.recommendedText': 'Download the archive, extract it, and follow the installation instructions.',
            'howto.dllOnly': 'DLL only (advanced)',
            'howto.dllOnlyText': 'For users who know where to place the file. May trigger a SmartScreen warning — add to exclusions.',
            'howto.downloadLabel': 'Download',
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

            'profileSettings.title': 'Profile settings',
            'profileSettings.twitch': 'Twitch username',
            'profileSettings.twitchPlaceholder': 'e.g. shroud',
            'profileSettings.twitchHint': 'Enter your Twitch username (no link, just the channel name) — on your profile page and while racing, if you\'re live, others will see a button to your stream.',
            'profileSettings.save': 'Save',
            'profileSettings.saved': 'Profile settings saved',
            'profileSettings.err.invalid': 'Invalid Twitch username. Only letters, digits and underscore are allowed (2-25 characters).',
            'profileSettings.err.save': 'Error saving: ',

            'twitch.watch': 'Watch stream',
            'twitch.watchTitle': 'This player is live on Twitch right now',
            'twitch.profile': 'Twitch',
            'twitch.live': 'Live',

            'create.title': 'Create race',
            'create.id': 'Race ID',
            'create.name': 'Name',
            'create.game': 'Game',
            'create.category': 'Category',
            'create.idPlaceholder': 'for example: any-percent-1',
            'create.namePlaceholder': 'Race name (Optional)',
            'create.gamePlaceholder': 'Game title',
            'create.categoryPlaceholder': 'for example: Any%',
            'create.timingMethod': 'Timing method',
            'create.timingMethod.realTime': 'Real Time',
            'create.timingMethod.gameTime': 'Game Time',
            'create.timingMethod.warning': 'Warning! If Game Time is selected, every participant must set “Compare Against → Game Time” in LiveSplit before joining the race. Otherwise their time will be tracked incorrectly.',
            'create.timingMethod.confirm': 'You selected Game Time. Make sure all participants are aware and set “Compare Against → Game Time” in LiveSplit before joining. Continue creating the race?',
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
            'empty.noHistory': 'No saved results yet',
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
            'confirm.finishRace': 'Finish the race? Unfinished players will be listed as DNF. The race will move to the History section.',
            'confirm.saveToHistory': 'Save current results to history? The race stays active while the current standings are snapshotted to the History section.',
            'confirm.kickPlayer': 'Kick this player from the race?',
            'confirm.deleteRace': '🗑️ Delete this race completely? This will delete all participants and results. This cannot be undone.',
            'alert.loginFirst': 'Log in first',
            'alert.requiredRace': 'Race ID and game title are required',
            'alert.error': 'Error: ',
            'alert.deleteError': 'Delete error: ',
            'toast.raceDeleted': 'Race deleted',
            'toast.savedToHistory': 'Results saved to history!',
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
