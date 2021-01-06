CRXB.styles = new (function() {
    this._src = {};
    this.add = function(scope, text) {
        if (scope && !text) {
            this._src['default'] = (this._src['default'] || '') + scope;
        } else if (text) {
            scope = scope || 'default';
            this._src[scope] = (this._src[scope] || '') + text;
        }
        return this;
    };
    this.interpolateVars = function(scope = 'default') {
        const names = Object.keys(this)
            .filter(k => !(typeof this[k] === 'function') && k.substr(0, 1) !== '_');
        const values = names.map(k => this[k]);

        const colorVars = names.filter(n => n.indexOf('COLOR_') === 0);
        for (let colorVar of colorVars) {
            names.push(colorVar + '_NOHASH');
            values.push(this[colorVar].substr(1));
        }

        const func = new Function(...names, 'return `' + this._src[scope] + '`;');
        return func(...values);
    };
    this.install = function(scope ) {
        if (Array.isArray(scope)) {
            for (let item of scope) {
                this.install(item);
            }
            return;
        }
        if (!scope) {
            return;
        }
        let styleElement = document.getElementById('crxde-styles-' + scope);
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = 'crxde-styles-' + scope;
            (document.body || document.head || document.documentElement).appendChild(styleElement);
        }

        styleElement.innerHTML = this.interpolateVars(scope);
    };
    this.remove = function(scope = 'default') {
        const styleElement = document.getElementById('crxde-styles-' + scope);
        if (styleElement) {
            styleElement.remove();
        }
    };
})()