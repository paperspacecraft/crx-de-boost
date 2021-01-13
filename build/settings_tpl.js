class SettingsHolder {

    static SETTINGS = 'profile:settings';
    static INSTANCE_PREFERENCES = 'profile:preferences';

    constructor() {
        this.data = {};
        this.data[SettingsHolder.SETTINGS] = GM_getValue(SettingsHolder.SETTINGS) || {};
        this.data[SettingsHolder.INSTANCE_PREFERENCES] = GM_getValue(SettingsHolder.INSTANCE_PREFERENCES) || {};
    }

    add(key, value) {
        this.data[key] = value;
        return this;
    };

    get(key) {
        return this.data[key] || this.data[SettingsHolder.SETTINGS][key] || this.data[SettingsHolder.INSTANCE_PREFERENCES][key];
    };

    update(key, settings) {
        if (!key || typeof settings !== 'object' || !settings) {
            return this;
        }
        Object.keys(settings).forEach(k => this.data[key][k] = settings[k]);
        return this;
    };

    save() {
        GM_setValue(SettingsHolder.SETTINGS, this.data[SettingsHolder.SETTINGS]);
        GM_setValue(SettingsHolder.INSTANCE_PREFERENCES, this.data[SettingsHolder.INSTANCE_PREFERENCES]);
        return this;
    }

}

CRXB.settings = new SettingsHolder()