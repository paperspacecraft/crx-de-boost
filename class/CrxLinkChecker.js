class CrxLinkChecker {

    constructor(extObj, config) {
        this.extObj = extObj;
        this.cache = {};
        this.tasks = {};
        this.baseUrl = (config || {}).baseUrl || `${CRX.Util.getSpiBaseUrl()}/${CRX.Util.getWorkspace()}/${CRX.ide.JCR_ROOT_NAME}`;
    }

    check(address, cb) {
        if (this.cache[address] === true) {
            return address;
        } else if (this.cache[address] === false) {
            return false;
        } else if (this.cache.hasOwnProperty(address)) {
            return this.cache[address];
        }

        this.scheduleRequest(address, cb);
        return false;
    }

    scheduleRequest(address, cb) {
        let task = this.tasks[address];
        if (!task) {
            task = new Ext.util.DelayedTask();
            this.tasks[address] = task;
        }
        task.delay(100, this.runRequest, this, [address, cb]);
    }

    runRequest(address, cb) {
        const Ext = this.extObj;
        const testables = [];
        if (/^\//.test(address)) {
            testables.push(address);
        } else {
            testables.push('/apps/' + address);
            testables.push('/libs/' + address);
        }
        Ext.Ajax.request({
            url: this.baseUrl + testables[0],
            method: 'HEAD',
            success: this.handleResponse,
            failure: this.handleResponse,
            argument: {address: address, testables: testables, cb: cb},
            scope: this
        });
    }

    handleResponse(response) {
        const argument = response.argument;
        const testable = argument.testables.shift();
        if (response.status >= 200 && response.status < 300) {
            this.finalizeRequest(argument, argument.address === testable ? true : testable);
        } else if (argument.testables.length) {
            Ext.Ajax.request({
                url: this.baseUrl + argument.testables[0],
                method: 'HEAD',
                success: this.handleResponse,
                failure: this.handleResponse,
                argument: argument,
                scope: this
            });
        } else {
            this.finalizeRequest(argument, false);
        }
    }

    finalizeRequest(argument, result) {
        this.cache[argument.address] = result;
        argument.cb(this.cache[argument.address]);
        delete this.tasks[argument.address];
    }
}
