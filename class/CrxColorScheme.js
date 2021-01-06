class CrxColorScheme {
    static DEFAULTS = {
        toolsBackground: "#73b5dd",
        toolsForeground: "#ffffff",
        toolsHighlight: "#1d7db9",
        workspaceBackground: "#ffffff",
        workspaceShade: "#cfe8f7",
        workspaceForeground: "#000000"
    };

    constructor(value) {
        Object.keys(CrxColorScheme.DEFAULTS).forEach(k => this[k] = CrxColorScheme.DEFAULTS[k]);
        this.update(value);
    }

    update(value) {
        if (!value || !(typeof value === 'object')) {
            return;
        }
        Object.keys(value).forEach(k => {
            if (value[k] || value[k] === false) {
                this[k] = value[k];
            }
        });
    }
}