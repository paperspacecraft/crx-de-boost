CRXB.tweaks.applyStyles = function(scope = ['splash', 'default']) {

    const prefs = GM_getValue('profile:preferences') || {};
    const colorScheme = CRXB.util.getCurrentColorScheme(prefs);

    CRXB.styles.FONT_SIZE = (prefs.fontSize || 13) + 'px';

    Object.keys(colorScheme)
        .filter(k => !/^_/.test(k))
        .forEach(k => {
            const styleName = 'COLOR_' + k.replace(/[A-Z]/g, letter => '_' + letter).toUpperCase()
                .replace('_BACKGROUND', '_BG')
                .replace('_HIGHLIGHT', '_HIGH')
                .replace('_FOREGROUND', '_FG');
            CRXB.styles[styleName] = colorScheme[k];
        });

    if (colorScheme._invertMenuBg) {
        document.body.classList.add('invert-menu-bg');
    } else {
        document.body.classList.remove('invert-menu-bg');
    }

    // Apply favicon
    const oldFavicon = document.querySelector('link[rel="icon"]');
    const newFavicon = oldFavicon.cloneNode(false);
    newFavicon.href = CRXB.settings.get('favicon').replace(/%23111/, '%23' + CRXB.styles.COLOR_TOOLS_BG.substring(1));
    newFavicon.type = 'image/svg+xml';
    document.querySelectorAll('[rel~="icon"]').forEach(element => element.parentNode.removeChild(element));
    document.head.appendChild(newFavicon);

    console.log(CRXB.styles);
    CRXB.styles.install(scope);
};