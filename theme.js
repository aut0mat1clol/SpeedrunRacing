// ============================================================
// theme.js — переключение темы (тёмная/светлая)
// ============================================================

(function () {
    var saved = localStorage.getItem('srt-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);

    window.toggleTheme = function () {
        var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        var next = cur === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('srt-theme', next);
    };
})();