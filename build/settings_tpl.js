CRXB.settings = new (function() {
    this.data = {};
    this.add = function(key, value) {
        this.data[key] = value;
        return this;
    };
    this.get = function(key) {
        return this.data[key];
    }
})()