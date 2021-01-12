class SettingsHolder {

    static SETTINGS_KEY = 'profile:settings';
    static INSTANCE_PREFERENCES_KEY = 'profile:preferences';

    constructor() {
        this.data = GM_getValue(SettingsHolder.SETTINGS_KEY) || {};
        this.data['instance-preferences'] = GM_getValue(SettingsHolder.INSTANCE_PREFERENCES_KEY) || {};
    }

    add(key, value) {
        this.data[key] = value;
        return this;
    };

    get(key) {
        return this.data[key];
    };

    update(settings) {
        if (typeof settings !== 'object' || !settings) {
            return this;
        }
        Object.keys(settings).forEach(k => this.data[k] = settings[k]);
        return this;
    };

    save() {
        GM_setValue(this.dataKey, this.data);
        return this;
    }

}

CRXB.settings = new SettingsHolder()