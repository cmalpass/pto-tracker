// Apply the saved theme before first paint to avoid a light-theme flash.
// Loaded synchronously in <head> ahead of the stylesheet and app modules.
(function () {
    'use strict';
    try {
        var theme = null;
        try {
            theme = localStorage.getItem('pto-theme');
        } catch (_) {
            // Storage can throw in private browsing modes.
        }
        if (theme !== 'dark' && theme !== 'light') {
            theme = window.matchMedia
                && window.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark' : 'light';
        }
        document.documentElement.dataset.theme = theme;
    } catch (_) {
        // Leave the default light theme if anything above is unavailable.
    }
})();
