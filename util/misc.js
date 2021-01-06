CRXB.util.extendAction = function(action, extension) {
    if (!action ||!extension) {
        return;
    }
    const oldHandler = action.initialConfig.handler;
    action.setHandler(function() {
        extension(oldHandler);
    });
};

CRXB.util.stringify = function(value, filter) {
    // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Cyclic_object_value
    const getCircularReplacer = () => {
        const seen = new WeakSet();
        const isNumber = /\d+/;
        return (key, value) => {
            if (filter && Array.isArray(filter.allowed)) {
                if (!isNumber.test(key) && key.length && filter.allowed.indexOf(key) < 0) {
                    return;
                }
            } else if (filter && Array.isArray(filter.disallowed)) {
                if (filter.disallowed.indexOf(key) >= 0) {
                    return;
                }
            }
            if (typeof value === "object" && value !== null) {
                if (seen.has(value)) {
                    return;
                }
                seen.add(value);
            }
            return value;
        };
    };
    return JSON.stringify(value, getCircularReplacer());
};

CRXB.util.getCurrentColorScheme = function(preferences, name, ignoreCustom) {
    const prefs = preferences || GM_getValue('profile:preferences') || {};
    const colorSchemeName = name ||  (prefs.colorScheme || {})[window.location.host] || 'Blue';
    const colorScheme = new CrxColorScheme(CRXB.settings.get('color-schemes')[colorSchemeName]);

    const customColors = prefs.customColors || {};
    const customScheme = customColors[colorSchemeName];
    if (customScheme && !ignoreCustom) {
        colorScheme.update(customScheme);
    }
    return colorScheme;
};

CRXB.util.getEnvironmentLabel = function(preferences) {
    const prefs = preferences || GM_getValue('profile:preferences') || {};
    return ((prefs.environment || {})[window.location.host] || window.location.host) + ' ›';
};