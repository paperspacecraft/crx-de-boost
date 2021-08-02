// ==UserScript==

// @name         CRX/DE Boost
// @namespace    http://aem.velwetowl.org/
// @version      0.1.6
// @description  Makes CRX/DE passable for an AEM developer environment
// @author       Stephen Velwetowl

// @match        http*://*/crx/de/*
// @match        http*://*/crx/*?crxbflow*

// @grant        GM_addValueChangeListener
// @grant        GM_getValue
// @grant        GM_setValue

// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.5.0/jszip.min.js
// @run-at       document-start

// ==/UserScript==


window.CRXB = {flows: {}, tweaks: {}, util: {}};


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


class CrxPackageModifier {
    static FOLDER_META = 'META-INF';
    static FILE_FILTER = CrxPackageModifier.FOLDER_META + '/vault/filter.xml';

    constructor(config) {
        this.config = config || {};
    }

    async modify(value, target) {
        if (!value || !target || value.constructor.name !== 'Blob' || !JSZip) {
            return value;
        }

        try {

            const sourceZip = await JSZip.loadAsync(value);

            const targetZip = new JSZip();
            await targetZip.folder(CrxPackageModifier.FOLDER_META).loadAsync(await sourceZip.folder(CrxPackageModifier.FOLDER_META).generateAsync({type: 'arraybuffer'}));

            let filterText = await targetZip.file(CrxPackageModifier.FILE_FILTER).async('string');
            const filterRoots = Array.from(filterText.matchAll(/<filter\s+root\s*=\s*"(.+?)".*\/>/g), match => match[1])
                .map(str => {return {path: str, nodeName: str.split('/').slice(-1)}});

            const newFilterEntries = filterRoots.map(root => target + '/' + root.nodeName).map(str => `<filter root="${str}"/>`).join('\n');
            filterText = filterText.replace(/<filter.+\/>/s, newFilterEntries);
            targetZip.file(CrxPackageModifier.FILE_FILTER, filterText);

            const targetFolderPath = CrxPackageModifier.getTargetFolderPath(target);
            for (let filterRoot of filterRoots) {
                const sourceDirBinary = await sourceZip
                    .folder(CrxPackageModifier.getTargetFolderPath(filterRoot.path))
                    .generateAsync({type: 'arraybuffer'});
                await targetZip
                    .folder(targetFolderPath)
                    .folder(filterRoot.nodeName)
                    .loadAsync(sourceDirBinary);
            }

            const exportOptions = {type: 'blob'};
            if (this.config.compression) {
                exportOptions.compression = 'DEFLATE';
            }
            return await targetZip.generateAsync(exportOptions);

        } catch (e) {
            console.error(e);
        }
        return value;
    }

    static getTargetFolderPath(target) {
        let targetFolder = target[0] === '/' ? target.substr(1) : target;
        if (!/^jcr_root/.test(targetFolder)) {
            targetFolder = 'jcr_root/' + targetFolder;
        }
        return targetFolder;
    }

    static getTargetNodeName(path) {

    }
}

class CrxPackager {

    static MAX_BLOB_SIZE_MB = 20; 
    static AC_HANDLING_OPTIONS = ['-', 'ignore', 'overwrite', 'merge', 'merge_preserve', 'clear'];
    static DEFAULT_PACKAGE_GROUP = 'my_packages';

    constructor(config) {
        this.config = config || {};

        CrxPackager.apply(this.config, {

            success: () => {},
            failure: () => {},
            status: () => {},
            acHandling: CRXB.settings.get('default-ac-handling')

        }, true);

        this.config.endpoints = this.config.endpoints || {};
        CrxPackager.apply(this.config.endpoints, {
            install: '/crx/packmgr/service.jsp',
            create: '/crx/packmgr/service/.json',
            setup: '/crx/packmgr/update.jsp',
            build: '/crx/packmgr/service/script.html',
            download: '/crx/packmgr/download.jsp'
        }, true);

        this.config.maxBlobSize = (CRXB.settings.get('in-mem-package-size') || CrxPackager.MAX_BLOB_SIZE_MB) * 1024 * 1024;
    }


    async download(path) {
        path = decodeURIComponent(path || this.config.path);
        let effectivePackageName = this.config.packageName || CrxPackager.getPackageName(path) + '-' + new Date().getTime();

        if (!effectivePackageName || !path) {
            return this.handleFailure('Package name or path not specified');
        }

        const argument = {
            jcrPath: path,
            packageName: effectivePackageName,
            stage: 'Creating package',
            completion: 0
        };

        try {


            this.config.status(argument);

            const createUrl = CrxPackager.getEncodedUrl(this.config.endpoints.create, {
                cmd: 'create',
                packageName: argument.packageName,
                groupName: this.config.groupName || 'transient'
            });
            const createResponse = await fetch(createUrl, {method: 'post'});
            const createResponseJson = createResponse.ok && CrxPackager.isJson(createResponse)
                ? await createResponse.json()
                : {};
            if (!createResponseJson.success) {
                argument.httpStatus = createResponse.status;
                argument.message = 'Could not create package' + (createResponseJson.msg ? ': ' + createResponseJson.msg : '');
                return this.handleFailure(argument);
            }

            argument.packagePath = createResponseJson.path;
            argument.stage = 'Setting up package';
            argument.completion = .2;
            this.config.status(argument);


            const setupUrlParams = {
                path: argument.packagePath,
                packageName: argument.packageName,
                filter: JSON.stringify([{root: argument.jcrPath, rules: []}])
            };
            if (this.config.acHandling && CrxPackager.AC_HANDLING_OPTIONS.indexOf(this.config.acHandling) >= 0) {
                setupUrlParams['acHandling'] = this.config.acHandling;
            }
            const setupUrl = CrxPackager.getEncodedUrl(this.config.endpoints.setup, setupUrlParams);
            const setupResponse = await fetch(setupUrl, {method: 'post'});
            const setupResponseJson = setupResponse.ok
                ? await setupResponse.json()
                : {};
            if (!setupResponseJson.success) {
                argument.httpStatus = setupResponse.status;
                argument.message = setupResponseJson.msg || 'Could not set up package';
                return this.handleFailure(argument);
            }


            argument.stage = 'Building package';
            argument.completion = -1;
            this.config.status(argument);

            const buildUrl = this.config.endpoints.build + argument.packagePath + '?cmd=build';
            const buildResponse = await fetch(buildUrl, {method: 'post'});
            const buildResponseText = buildResponse.ok ? await buildResponse.text() : '';
            const buildResponseResult = CrxPackager.extractInlineStatus(buildResponseText);

            if (!buildResponseResult.success) {
                argument.httpStatus = setupResponse.status;
                argument.message = CrxPackager.truncate(buildResponseText, 300) || buildResponse.statusText;
                return this.handleFailure(argument);
            }


            let packageSize = 0;
            if (this.config.cleanUp) {
                argument.stage = 'Checking package';
                argument.completion = .8;
                this.config.status(argument);
                const queryUrl = this.config.endpoints.download + '?path=' + argument.packagePath;
                const queryResponse = await fetch(queryUrl, {method: 'head'});
                if (queryResponse.ok) {
                    packageSize = parseInt(queryResponse.headers.get('content-length') || '0');
                } else {
                    argument.httpStatus = queryResponse.status;
                    argument.message = 'Could not retrieve package details';
                    return this.handleFailure(argument);
                }
            }


            argument.stage = 'Ready for download';
            argument.completion = 1;
            if (this.config.maxBlobSize && packageSize > this.config.maxBlobSize) {
                argument.extraSize = true;
            }
            argument.autoCleanUp = this.config.cleanUp && !argument.extraSize;

            if (!argument.autoCleanUp) {
                return this.config.success(argument);
            }

            const downloadResponse = await fetch(argument.packagePath);
            if (!downloadResponse.ok) {
                argument.httpStatus = downloadResponse.status;
                argument.message = downloadResponse.statusText;
                return this.handleFailure(argument);
            }

            const downloadResponseBlob = await downloadResponse.blob();
            const originalPackagePath = argument.packagePath;
            if (this.config.storeBlob) {
                argument.blob = downloadResponseBlob;
            } else {
                argument.packagePath = URL.createObjectURL(downloadResponseBlob);
            }
            argument.packageFileName = argument.packageName + '.zip';
            this.config.success(argument);
            if (!this.config.storeBlob) {
                URL.revokeObjectURL(argument.packagePath);
            }


            argument.stage = 'Cleaning up';
            const cleanupUrl = this.config.endpoints.build + originalPackagePath + '?cmd=delete';
            await fetch(cleanupUrl, {method: 'post'});

        } catch (e) {
            argument.message = e.message || e;
            argument.httpStatus = argument.httpStatus || '';
            this.handleFailure(argument);
        }
    }


    async upload(value) {
        let formData;
        if (value && value.xtype === 'panel' && value.el.dom.tagName === 'FORM') {
            formData = new FormData();
            Object.keys(value.getValues())
                .forEach(k => formData.append(k, value.getValues()[k]));
            if (!formData.get('file')) {
                formData.append('file', value.el.dom['file'][1].files[0]);
            }
        } else if (value && value.constructor.name === 'Blob') {
            formData = new FormData();
            formData.append('file', value);
            formData.append('force', true);
            formData.append('install', true);
        }

        if (!formData) {
            return;
        }

        const argument = {
            stage: 'Installing package',
            packageFileName: value.packageFileName,
            completion: -1
        };
        try {


            this.config.status(argument);
            const uploadResponse = await fetch(this.config.endpoints.install, {
                method: 'post',
                body: formData
            });
            let uploadResponseText = uploadResponse.ok ? await uploadResponse.text() : '';
            uploadResponseText = CrxPackager.normalizeHtml(uploadResponseText);
            const uploadResponseStatusValue = CrxPackager.extractInlineMessage(uploadResponseText, 'status');
            if (uploadResponseStatusValue !== 'ok') {
                argument.httpStatus = uploadResponse.status;
                argument.message = CrxPackager.truncate(uploadResponseStatusValue || uploadResponseText, 300) || uploadResponse.statusText;
                return this.handleFailure(argument);
            }


            argument.stage = 'Checking package';
            argument.completion = .8;
            this.config.status(argument);

            argument.packageFileName = CrxPackager.extractInlineMessage(uploadResponseText, 'downloadName');
            argument.packageGroup = CrxPackager.extractInlineMessage(uploadResponseText, 'group');
            argument.packagePath = '/etc/packages/' + argument.packageGroup + '/' + argument.packageFileName;

            const queryUrl = argument.packagePath + '/jcr%3Acontent/vlt%3Adefinition/filter.1.json';
            const queryResponse = await fetch(queryUrl);
            if (!queryResponse.ok || !CrxPackager.isJson(queryResponse)) {
                argument.httpStatus = queryResponse.status;
                argument.message = queryResponse.statusText || 'Could not retrieve package detail';
                return this.config.failure(argument);
            }

            const queryJson = await queryResponse.json();
            const firstFilter = Object.keys(queryJson)
                .filter(k => k !== 'jcr:primaryType')
                .map(k => queryJson[k])
                [0];

            if (firstFilter) {
                argument.jcrPath = firstFilter.root;
            }

            argument.stage = 'Finished';
            argument.completion = 1;
            this.config.success(argument);
            if (!this.config.cleanUp) {
                return;
            }


            argument.stage = 'Cleaning up';
            const cleanupUrl = this.config.endpoints.build + argument.packagePath + '?cmd=delete';
            fetch(cleanupUrl, {method: 'post'});

        } catch (e) {
            argument.message = e.message || e;
            argument.httpStatus = argument.httpStatus || '';
            this.handleFailure(argument);
        }
    }

    import(origin, path) {
        const doCommunication = async (message) => {
            if (message.data.from !== 'download-package') {
                return;
            }
            const msg = message.data.msg;
            if (msg === 'status') {
                this.config.status(message.data.status);
                finalizationTask.delay(finalizationTaskGrace);
                return;
            }
            if (msg === 'failure') {
                this.config.failure(message.data.status);
            } else if (msg === 'success') {
                let status = message.data.status;
                if (status.extraSize) {
                    status.message = 'The resource package is too big for importing';
                    this.handleFailure(status);
                } else {
                    if (this.config.preInstall) {
                        status = await this.config.preInstall(status) || status;
                    }
                    this.upload(status.blob);
                }
            }
            finalize(false);
        };
        window.addEventListener('message', doCommunication);

        const finalize = (clearUi) => {
            finalizationTask.cancel();
            window.removeEventListener('message', doCommunication);
            if (frame && frame.opener) { 
                frame.close();
            } else if (frame && frame.remove) {
                frame.remove();
            }
            if (clearUi) {
                this.config.success();
            }
        };

        const finalizationTaskGrace = 10 * 60 * 1000; 
        const finalizationTask = new Ext.util.DelayedTask(() => finalize(true));
        finalizationTask.delay(finalizationTaskGrace);

        const frameUrl = origin + this.config.endpoints.install + '?crxbflow=downloadPackage&path=' + path;
        const frame = window.open(frameUrl, 'Import Resource', 'height=1,width=1,menubar=no,toolbar=no,status=no,resizable=no,scrollbars=no');
        if (!frame) {
            this.config.failure('Could not start package download');
            finalize(false);
        }
    }


    handleFailure(err) {
        this.config.failure(err);
        if (err.packagePath) {
            fetch(this.config.endpoints.build + err.packagePath + '?cmd=delete', {method: 'post'});
        }
    }

    static isJson(response) {
        const contentTypeHeader =  response.headers.get('content-type') || '';
        return contentTypeHeader.indexOf('application/json') === 0;
    }

    static getPackageName(path) {
        const decodedPath = decodeURIComponent(path);
        return CrxPackager.sanitizePackageName(`${CRXB.util.getEnvironmentLabel()}-${decodedPath}`);
    }

    static sanitizePackageName(value) {
        return value.replace(/[\/:.,]+/g, '-');
    }

    static getEncodedUrl(url, params) {
        return url + '?' + new URLSearchParams(params).toString();
    }

    static normalizeHtml(text) {
        return (text || '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();
    }

    static extractInlineMessage(text, tag) {
        if (!text) {
            return text || '';
        }
        const tmp = document.createElement("DIV");
        tmp.innerHTML = text;
        const tags = Array.isArray(tag) ? tag : [tag];
        for (let t of tags) {
            const elt = Array.from(tmp.querySelectorAll(t)).map(elt => elt.textContent || elt.innerText).join(' ');
            if (elt) {
                return elt.trim();
            }
        }
        return '';
    }

    static extractInlineStatus(text) {
        const status = CrxPackager.extractInlineMessage(text, 'textarea');
        if (status) {
            return JSON.parse(status);
        }
        return {};
    }

    static truncate(text, len) {
        if (/<\w+>/.test(text)) {
            const tmp = document.createElement("DIV");
            tmp.innerHTML = text;
            text = (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ');
        }
        if (text.length < len) {
            return text;
        }
        return text.slice(0, len) + '...';
    }

    static apply(src, ext, ifEmpty) {
        if (!ext || typeof ext !== 'object') {
            return src;
        }
        Object.keys(ext)
            .forEach(k => {
                if (!ifEmpty || !src[k]) {
                    src[k] = ext[k];
                }
            });
        return src;
    }
}

class CrxProgressFacade {

    constructor(title, msg) {
        this.title = title;
        this.state = undefined;
        if (msg) {
            this.show(-1, msg);
        }
    }

    show(progress, msg) {
        if (!msg) {
            msg = progress;
            progress = -1;
        }
        const newState = progress >= 0 ? 'progress' : 'wait';
        if (newState !== this.state && newState === 'progress') {
            Ext.Msg.show({
               title: this.title,
               msg: msg,
               width: 420,
               progress: true
            });
            Ext.Msg.updateProgress(progress, '', msg);
        } else if (newState !== this.state && newState === 'wait') {
            Ext.Msg.show({
                title: this.title,
                msg: msg,
                width: 420,
                wait: true
            });
        } else if (newState === 'progress') {
            Ext.Msg.updateProgress(progress, '', msg);
        } else {
            Ext.Msg.updateText(msg);
        }
    }

    hide(delay) {
        if (delay > 0) {
            setTimeout(() => Ext.Msg.hide(), delay);
        } else {
            Ext.Msg.hide();
        }
    }
}

class CrxRegulator {
    constructor() {
        this.observer = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                const regulated = this.getRegulatedItems(mutation);
                for (let item of regulated) {
                    if (item.node.tagName === 'SCRIPT') {
                        item.node.type = 'javascript/blocked';
                    }
                    if (item.action) {
                        item.action(item.node);
                    }
                }
            }
        });
        this.observer.observe(document, {childList: true, subtree: true});
    }

    blockExternal(matcher) {
        this.addRegulation(matcher, (node) => node.parentElement.removeChild(node));
        return this;
    }

    addRegulation(matcher, action) {
        if (!this.regulations) {
            this.regulations = [];
        }
        this.regulations.push({matcher: matcher, action: action});
    }

    dispose() {
        this.observer.disconnect();
        this.observer = null;
    }

    getRegulatedItems(mutation) {
        const result = [];
        if (!mutation || !mutation.addedNodes) {
            return result;
        }
        for (let node of mutation.addedNodes) {
            const action = this.getMatchedAction(node);
            if (action) {
                result.push({node: node, action: action});
            }
        }
        return result;
    }

    getMatchedAction(arg) {
        if (!arg) {
            return false;
        }
        for (let entry of (this.regulations || [])) {
            if ((entry.matcher.constructor.name === 'RegExp' && entry.matcher.test(arg.src || arg.href))
                || (entry.matcher.constructor.name !== 'RegExp' && typeof arg.matches === 'function' && arg.matches(entry.matcher))) {
                return entry.action;
            }
        }
        return false;
    }
}

class CrxTweaker {

    add(tweak, context) {
        if (!this.tweaks) {
            this.tweaks = [];
        }
        this.tweaks.push({tweak: tweak, context: context});
        return this;
    }

    execute(extObj) {
        const tweaks = this.tweaks;
        tweaks.filter(item => !item.context).forEach(item => item.tweak());

        const isMatch = (component, tweakItem) => {
            if (!tweakItem.context) {
                return false;
            }
            if (Array.isArray(tweakItem.context)) {
                return tweakItem.context.indexOf(component.id) >= 0;
            } else {
                return tweakItem.context === component.id;
            }
        };

        const runInContext = (component, tweakItem) => {
            if (Array.isArray(tweakItem.context)) {
                tweakItem.context.splice(tweakItem.context.indexOf(component.id), 1);
                if (!tweakItem.context.length) {
                    tweakItem.tweak();
                }
            } else {
                tweakItem.tweak(component);
            }
        };

        extObj.ComponentMgr.all.on('add', function(index, obj) {
            const matchingTweaks = tweaks.filter(item => isMatch(obj, item));
            matchingTweaks.forEach(item => runInContext(obj, item));
        });
    }
}

CRXB.util.registerAccessControlDialog = function() {
    if (CRX.ide.AccessControlDialog) {
        return;
    }

    CRX.ide.AccessControlDialog = Ext.extend(Ext.Window, {
        cls: 'accesscontrol',
        title: 'Access Control',
        modal: true,
        width: 640,
        height: 420,
        closeAction: 'hide',
        layout: 'fit',
        buttonAlign: 'center',

        constructor: function(config) {
            config = config || {};
            this.aclPanel = new CRX.ide.DetailsAccessControlPanel();

            Ext.applyIf(config, {
                items: [this.aclPanel]
            });

            CRX.ide.AccessControlDialog.superclass.constructor.call(this, config);
        },

        initComponent: function() {
            CRX.ide.AccessControlDialog.superclass.initComponent.call(this);
            this.on('show', function() {
                const path = this.node ? CRX.Util.getLocalWorkspacePath(this.node.getRealPath()) : CRXB.util.getCurrent('path');
                if (path) {
                    this.aclPanel.meActive = true;
                    this.aclPanel.setCurrentPath(path);
                }
            });
        },

        init: function(node) {
            this.node = node;
        }
    });

    CRX.ide.AccessControlDialog.getInstance = (function() {
        const id = Ext.id();
        return function() {
            return Ext.WindowMgr.get(id) || new CRX.ide.AccessControlDialog({ id: id });
        }
    })();

    Ext.reg('accesscontroldialog', CRX.ide.AccessControlDialog);
};

CRXB.util.getAccessControlDialogAction = function() {
    if (CRX.ide.AccessControlDialogAction) {
        return CRX.ide.AccessControlDialogAction;
    }

    CRXB.util.registerAccessControlDialog();

    CRX.ide.AccessControlDialogAction = new Ext.Action({
        text: 'Access Control ...',
        iconCls: 'action-access',
        dialogId: 'accesscontroldialog',
        handler: CRX.Util.openActionDialog
    });
    return CRX.ide.AccessControlDialogAction;
};

CRXB.util.registerDownloadDialog = function() {
    if (CRX.ide.PackageDownloadDialog) {
        return;
    }

    CRX.ide.PackageDownloadDialog = Ext.extend(Ext.Window, {
        title: 'Download',
        modal: true,
        width: 480,
        height: 230,
        layout: 'fit',
        buttonAlign: 'center',

        constructor: function(config) {
            this.packageName = new Ext.form.TextField({
                id: 'packageName',
                fieldLabel: 'Package name',
                allowBlank: false
            });

            this.packageGroup = new Ext.form.TextField({
                id: 'packageGroup',
                fieldLabel: 'Package group name',
                allowBlank: false
            });

            this.acHandling = new Ext.form.ComboBox({
                id: 'acHandling',
                fieldLabel: 'Access control handling',
                store: CrxPackager.AC_HANDLING_OPTIONS,
                triggerAction: 'all',
                allowBlank: this,
                validator: function (value) {
                    return CrxPackager.AC_HANDLING_OPTIONS.indexOf(value) >= 0;
                }
            });

            this.okButton = new Ext.Button({
                text: 'OK',
                handler: () => {
                    if (!this.isValid()) {
                        return;
                    }
                    CRX.ide.DownloadAction.execute({
                        packageName: this.packageName.getValue(),
                        packageGroup: this.packageGroup.isVisible() ? this.packageGroup.getValue() : undefined,
                        persist: this.packageGroup.isVisible(),
                        acHandling: this.acHandling.getValue()
                    });
                    this.close();

                }
            });


            Ext.applyIf(config, {
                items: {
                    xtype: 'panel',
                    layout: 'form',
                    bodyStyle: 'padding: 20px 12px 0 12px',
                    labelWidth: 100,
                    defaults: {
                        msgTarget: 'side',
                        anchor: '98%',
                    },
                    items: [
                        this.packageName,
                        this.acHandling,
                        {
                            xtype: 'checkbox',
                            fieldLabel: 'Persist package',
                            listeners: {
                                'check': (checkbox, value) => {
                                    this.packageGroup.setDisabled(!value);
                                    this.packageGroup.setVisible(value);
                                    const itemGroup =  this.packageGroup.getEl().up('.x-form-item');
                                    if (value) {
                                        itemGroup.show();
                                        if (!this.packageGroup.getValue()) {
                                            this.packageGroup.setValue(CrxPackager.DEFAULT_PACKAGE_GROUP);
                                        }
                                        this.packageGroup.focus();
                                    } else {
                                        this.packageGroup.clearInvalid();
                                        itemGroup.hide();
                                    }
                                }
                            }
                        },
                        this.packageGroup
                    ],
                },
                buttonAlign: 'center',
                buttons: [
                    this.okButton,
                    {
                        text: 'Cancel',
                        handler: () => this.close()
                    }
                ],
                keys: [
                    {
                        key: [10, 13],
                        alt: false,
                        ctrl: false,
                        shift: false,
                        fn: () => this.okButton.el.dom.click(),
                        stopEvent: true
                    }
                ]
            });
            CRX.ide.PackageDownloadDialog.superclass.constructor.call(this, config);
        },

        initComponent: function() {
            CRX.ide.PackageDownloadDialog.superclass.initComponent.call(this);

            this.packageName.setValue(CrxPackager.getPackageName(CRXB.util.getCurrent('path')));
            this.acHandling.setValue(CRXB.settings.get('default-ac-handling') || CrxPackager.AC_HANDLING_OPTIONS[0]);

            this.on('show', function() {
                this.packageGroup.getEl().up('.x-form-item').hide();
                this.packageName.focus();
            });
        },

        isValid: function() {
            return this.packageName.isValid()
                && this.acHandling.isValid()
                && (!this.packageGroup.isVisible() || this.packageGroup.isValid());
        }

    });

    CRX.ide.PackageDownloadDialog.getInstance = (function() {
        const id = Ext.id();
        return function() {
            return Ext.WindowMgr.get(id) || new CRX.ide.PackageDownloadDialog({ id: id });
        }
    })();

    Ext.reg('packagedownloaddialog', CRX.ide.PackageDownloadDialog);
};


CRXB.util.getDownloadActions = function() {
    if (CRX.ide.DownloadDialogAction) {
        return [CRX.ide.DownloadDialogAction, CRX.ide.DownloadAction];
    }

    CRXB.util.registerDownloadDialog();

    CRX.ide.DownloadDialogAction = new Ext.Action({
        text: 'Download ...',
        iconCls: 'action-download',
        handler: () => {
            CRX.ide.PackageDownloadDialog.getInstance().show();
        }
    });
    CRX.ide.DownloadDialogAction.checkActive = function() {
        this.setDisabled(!CRXB.util.getCurrent('path'));
    };


    CRX.ide.DownloadAction = new Ext.Action({
        text: 'Download now',
        handler: function(args) {
            args = args || {};
            const msg = new CrxProgressFacade('Download resource', 'Please wait');
            const crxPackagerConfig = {
                cleanUp: true,
                success: (status) => {
                    msg.show(1, 'Finished');
                    msg.hide(500);

                    const downloadLink = document.createElement('A');
                    downloadLink.style.display = 'none';
                    downloadLink.href = status.packagePath;
                    if (status.packageFileName) {
                        downloadLink.download = status.packageFileName;
                    }
                    document.body.appendChild(downloadLink);
                    downloadLink.click();
                    downloadLink.remove();
                },
                failure: (status) => {
                    const errorMsg = `Package creation for ${status.jcrPath} failed at "${status.stage}": ${status.httpStatus} ${status.message}`;
                    console.error(errorMsg);
                    Ext.Msg.show({
                        title: 'Error',
                        msg: errorMsg,
                        width: 420,
                        buttons: Ext.MessageBox.OK,
                        icon: Ext.MessageBox.ERROR
                    });
                },
                status: (status) => msg.show(status.completion, status.stage + '... Please wait')
            };

            if (args.packageName) {
                crxPackagerConfig.packageName = args.packageName;
            }
            if (args.acHandling) {
                crxPackagerConfig.acHandling = args.acHandling;
            }
            if (args.persist && args.packageGroup) {
                crxPackagerConfig.cleanUp = false;
                crxPackagerConfig.groupName = args.packageGroup;
            }

            const packager = new CrxPackager(crxPackagerConfig);
            const path = args.path || CRXB.util.getCurrent('path');
            packager.download(path);
        }
    });
    CRX.ide.DownloadAction.checkActive = function() {
        this.setDisabled(!CRXB.util.getCurrent('path'));
    };

    return [CRX.ide.DownloadDialogAction, CRX.ide.DownloadAction];
};


CRXB.util.registerPackageUploadDialog = function() {
    if (CRX.ide.PackageUploadDialog) {
        return;
    }
    CRX.ide.PackageUploadDialog = Ext.extend(Ext.Window, {
        title: 'Upload Package',
        modal: true,
        width: 420,
        height: 180,
        layout: 'fit',

        constructor: function(config) {
            this.form = new Ext.form.FormPanel({
                xtype: 'panel',
                layout: 'form',
                bodyStyle: 'padding: 20px 20px 12px 16px',
                labelWidth: 80,
                defaults: {
                    msgTarget: 'side',
                    anchor: '100%',
                },
                items: [
                    {
                        xtype: 'fileuploadfield',
                        id: 'file',
                        name: 'file',
                        fieldLabel: 'Package file',
                        allowBlank: false,
                        validator: function(value) {
                            return /\.zip$/i.test(value);
                        }
                    },
                    {
                        xtype: 'hidden',
                        name: 'force',
                        value: true
                    },
                    {
                        xtype: 'hidden',
                        name: 'install',
                        value: true
                    }
                ],
            });
            Ext.applyIf(config, {
                items: this.form,
                buttonAlign: 'center',
                buttons: [
                    {
                        text: 'OK',
                        handler: () => this.doUpload()
                    },
                    {
                        text: 'Cancel',
                        handler: () => this.close()
                    }
                ],
                keys: [
                    {
                        key: [10, 13],
                        alt: false,
                        ctrl: false,
                        shift: false,
                        fn: () => this.doUpload(),
                        stopEvent: true
                    }
                ]

            });
            CRX.ide.PackageUploadDialog.superclass.constructor.call(this, config);
        },

        doUpload: async function() {
            if (!this.form.getForm().isValid()) {
                return;
            }
            await CRXB.util.save();

            const msg = new CrxProgressFacade('Install resource', 'Please wait');
            const packager = new CrxPackager({
                cleanUp: true,
                success: (status) => {
                    msg.show(1, 'Finished');
                    msg.hide(500);
                    if (!status.jcrPath) {
                        return;
                    }
                    CRXB.util.findNearestCommon(CRXB.util.getCurrent('node'), status.jcrPath).reload(() => {
                        CRXB.util.setLocation(status.jcrPath);
                    });

                },
                failure: (status) => {
                    const errorMsg = `Installation for ${status.packageFileName} failed at "${status.stage}": ${status.httpStatus} ${status.message}`;
                    console.error(errorMsg);
                    Ext.Msg.show({
                        title: 'Error',
                        msg: errorMsg,
                        width: 420,
                        buttons: Ext.MessageBox.OK,
                        icon: Ext.MessageBox.ERROR
                    });
                },
                status: (status) => msg.show(status.completion, status.stage + '... Please wait')
            });
            const payload = this.form.getForm();
            const payloadFileElt = this.form.el.dom.querySelector('#file-file');
            if (payloadFileElt) {
                const packageFileName = payloadFileElt.value.split(/[\\/]/);
                payload.packageFileName = packageFileName.pop();
            }
            packager.upload(payload);
            this.close();
        },
    });

    CRX.ide.PackageUploadDialog.getInstance = (function() {
        const id = Ext.id();
        return function() {
            return Ext.WindowMgr.get(id) || new CRX.ide.PackageUploadDialog({ id: id });
        }
    })();
};

CRXB.util.getUploadDialogAction = function() {
    if (CRX.ide.UploadDialogAction) {
        return CRX.ide.UploadDialogAction;
    }

    CRXB.util.registerPackageUploadDialog();
    CRX.ide.UploadDialogAction = new Ext.Action({
        text: 'Install ...',
        iconCls: 'action-upload',
        handler: () => {
            CRX.ide.PackageUploadDialog.getInstance().show();
        }
    });

    return CRX.ide.UploadDialogAction;
};

CRXB.util.registerPreferencesDialog = function() {
    if (CRX.ide.CustomPreferencesDialog) {
        return;
    }

    const DEFAULT_FONT_SIZE = 13;
    const COLOR_SCHEMES = Object.keys(CRXB.settings.get('color-schemes') || {});
    if (!COLOR_SCHEMES.length) {
        COLOR_SCHEMES.push('Blue');
    }
    const DEFAULT_COLOR_SCHEME = COLOR_SCHEMES[0];

    CRX.ide.CustomPreferencesDialog = Ext.extend(Ext.Window, {
        title: 'Preferences',
        modal: true,
        width: 420,
        height: 620,
        layout: 'fit',
        closeAction: 'hide',

        constructor: function(config) {
            const labelStyle = 'display: block; padding: 0 0 16px 106px';

            this.envName = new Ext.form.TextField({
                xtype: 'textfield',
                id: 'envName',
                fieldLabel: 'Custom name'
            });

            this.fontSize = new Ext.ux.SpinnerField({
                id: 'fontSize',
                fieldLabel: 'Font size',
                allowBlank: false,
                minValue: 1,
            });

            this.colorScheme = new Ext.form.ComboBox({
                id: 'colorScheme',
                fieldLabel: 'Color scheme',
                store: COLOR_SCHEMES,
                triggerAction: 'all',
                validator: function(value) {
                    return COLOR_SCHEMES.indexOf(value) >= 0;
                },
                listeners: {
                    'select': () => this.processSchemeChange()
                }
            });

            this.okButton = new Ext.Button({
                text: 'OK',
                handler: () => {
                    if (!this.isValid()) {
                        return;
                    }
                    if (this.save()) {
                        CRXB.tweaks.applyStyles();
                        Ext.getCmp('environment').setText(CRXB.util.getEnvironmentLabel() + ' ›');
                        Ext.getCmp(CRX.ide.MAIN_ID).items.get(0).items.get(0).doLayout();
                    }
                    this.hide();
                }
            });

            this.preferences = CRXB.settings.get(SettingsHolder.INSTANCE_PREFERENCES);
            this.colorControls = [];
            for (let colorSchemeName of COLOR_SCHEMES) {
                const colorSchemeSrc = CRXB.util.getCurrentColorScheme(colorSchemeName);
                this.colorControls.push(...Object.keys(colorSchemeSrc)
                    .filter(k => !/^_/.test(k))
                    .map(k => {return {
                        xtype: 'textfield',
                        cls: 'color-swatch',
                        name: colorSchemeName + '-' + k,
                        visible: false,
                        id: `color-control--${colorSchemeName}-${k}`,
                        fieldLabel: k.replace(/[A-Z]/g, val => ' ' + val.toLowerCase()).replace(/^\w/, val => val.toUpperCase()),
                    }}));
                this.colorControls.push(new Ext.form.Checkbox({
                    fieldLabel: 'Light menu background',
                    cls: 'color-swatch',
                    name: colorSchemeName + '-_invertMenuBg',
                    id: `color-control--${colorSchemeName}-_invertMenuBg`,
                }));
            }

            const hostLabel = {
                    xtype: 'label',
                    html: `This will be applied to <b>${window.location.host}</b>`,
                    style: labelStyle,
                    anchor: false,
            };


            Ext.applyIf(config, {
                items: {
                    xtype: 'panel',
                    layout: 'form',
                    bodyStyle: 'padding: 20px 20px 0 12px',
                    labelWidth: 100,
                    autoScroll: true,
                    defaults: {
                        msgTarget: 'side',
                        anchor: '98%',
                    },
                    items: [
                        {
                            xtype: 'label',
                            cls: 'dialog-section',
                            text: 'Environment settings',
                            anchor: false,
                        },
                        this.envName,
                        hostLabel,
                        {
                            xtype: 'label',
                            cls: 'dialog-section',
                            text: 'Visual style',
                            anchor: false,
                        },
                        this.fontSize,
                        {
                            xtype: 'label',
                            text: 'This will affect all hosts',
                            style: labelStyle,
                            anchor: false,
                        },
                        this.colorScheme,
                        hostLabel,
                        {
                            xtype: 'label',
                            id: 'colors-section-header',
                            cls: 'dialog-section',
                            text: 'Current scheme colors',
                            anchor: false,
                        },
                        this.colorControls,
                        {
                            xtype: 'button',
                            id: 'reset-colors',
                            text: '↺',
                            anchor: 'right',
                            style: 'float: right; margin: -32px 16px 0 0;',
                            handler: () => this.resetColors(),
                        }

                    ],
                },
                buttonAlign: 'center',
                buttons: [
                    this.okButton,
                    {
                        text: 'Cancel',
                        handler: () => this.hide()
                    }
                ],
                keys: [
                    {
                        key: [10, 13],
                        alt: false,
                        ctrl: false,
                        shift: false,
                        fn: () => this.okButton.el.dom.click,
                        stopEvent: true
                    }
                ]

            });
            CRX.ide.CustomPreferencesDialog.superclass.constructor.call(this, config);
        },

        initComponent: function() {
            CRX.ide.CustomPreferencesDialog.superclass.initComponent.call(this);
            this.on('show', function() {
                if (this.domCreated) {
                    return;
                }
                this.domCreated = true;
                this.convertSwatchesToColorFields();
                this.colorScheme.fireEvent('select');
            });
        },

        reset: function() {
            this.fontSize.setValue(this.preferences.fontSize && !isNaN(this.preferences.fontSize) ? this.preferences.fontSize : DEFAULT_FONT_SIZE);
            this.fontSize.originalValue = this.fontSize.getValue();

            this.colorScheme.setValue((this.preferences.colorScheme ? this.preferences.colorScheme[window.location.host] : '') || DEFAULT_COLOR_SCHEME);
            this.colorScheme.originalValue = this.colorScheme.getValue();

            this.envName.setValue((this.preferences.environment ? this.preferences.environment[window.location.host] : '') || '');
            this.envName.originalValue = this.envName.getValue();

            const panel = this.items.get(0);
            for (let colorSchemeName of COLOR_SCHEMES) {
                const colorSchemeSrc = CRXB.util.getCurrentColorScheme(colorSchemeName);
                Object.keys(colorSchemeSrc).forEach(k => {
                    const swatch = panel.items.get(`color-control--${colorSchemeName}-${k}`);
                    swatch.setValue(colorSchemeSrc[k]);
                    swatch.originalValue = swatch.getValue();
                });
            }
        },

        save: function() {
            if (!this.isDirty()) {
                return false;
            }
            this.preferences.fontSize = this.fontSize.getValue();

            this.preferences.colorScheme = this.preferences.colorScheme || {};
            this.preferences.colorScheme[window.location.host] = this.colorScheme.getValue();

            if (this.envName.getValue()) {
                this.preferences.environment = this.preferences.environment || {};
                this.preferences.environment[window.location.host] = this.envName.getValue();
            } else if (this.preferences.environment) {
                delete this.preferences.environment[window.location.host];
            }

            this.preferences.customColors = this.preferences.customColors || {};
            this.preferences.customColors[this.colorScheme.value] = {};
            this.items.get(0).items
                .filterBy(item => item.initialConfig.cls === 'color-swatch')
                .each(item => {
                    const schemeName = item.name.split('-')[0];
                    const colorKey = item.name.split('-')[1];
                    this.preferences.customColors[schemeName] = this.preferences.customColors[schemeName] || {};
                    this.preferences.customColors[schemeName][colorKey] = item.getValue()
                });
            CRXB.settings.save();
            return true;
        },

        isValid: function() {
            return this.colorScheme.isValid() && this.fontSize.isValid();
        },

        isDirty: function() {
            if (this.fontSize.isDirty() || this.colorScheme.isDirty() || this.envName.isDirty()) {
                return true;
            }
            return this.items.get(0).items.filterBy(item => item.initialConfig.cls === 'color-swatch' && item.isDirty()).getCount() > 0;
        },

        resetColors: function() {
            const colorSchemeSrc = CRXB.util.getCurrentColorScheme(this.colorScheme.getValue(), true);
            this.items.get(0).items
                .filterBy(item => item.initialConfig.cls === 'color-swatch' && item.name.indexOf(this.colorScheme.getValue()) === 0)
                .each(item => {
                    const colorKey = item.name.split('-')[1];
                    item.setValue(colorSchemeSrc[colorKey]);
                });
            this.processResetButtonState();
        },

        processResetButtonState: function() {
            const colorSchemeSrc = CRXB.util.getCurrentColorScheme(this.colorScheme.getValue(), true);
            const currentSwatches =this.items.get(0).items
                .filterBy(item => item.initialConfig.cls === 'color-swatch'
                    && item.name.indexOf(this.colorScheme.getValue()) === 0
                    && item.name.indexOf('-_') < 0);
            let resetBtnVisible = false;
            for (let item of currentSwatches.items) {
                const colorKey = item.name.split('-')[1];
                if (item.getValue() !== colorSchemeSrc[colorKey]) {
                    resetBtnVisible = true;
                    break;
                }
            }
            this.items.get(0).items.get('reset-colors').setVisible(resetBtnVisible);
        },

        processSchemeChange: function() {
            const panel = this.items.get(0);
            this.colorControls.forEach(swatch => {
                const schemeName = swatch.name.split('-')[0];
                const isVisible = schemeName === this.colorScheme.getValue();
                const swatchElementHost = panel.items.get(swatch.id).el.dom.closest('.x-form-item');
                if (isVisible) {
                    swatchElementHost.classList.remove('x-hide-display');
                } else {
                    swatchElementHost.classList.add('x-hide-display');
                }
            });
            panel.items.get('colors-section-header').setText(this.colorScheme.getValue() + ' scheme colors');
            this.processResetButtonState();
        },

        convertSwatchesToColorFields: function() {
            const panelElement = this.items.get(0).el.dom;
            const swatches = panelElement.querySelectorAll('.color-swatch[type="text"]');
            for (let swatch of swatches) {
                swatch.type = 'color';
                swatch.addEventListener('change', () => this.processResetButtonState());
            }
            this.processResetButtonState();
        },

    });
    Ext.reg("preferencesdialog", CRX.ide.CustomPreferencesDialog);
    return CRX.ide.CustomPreferencesDialog;
};



CRXB.util.registerPropertyDialog = function() {
    if (CRX.ide.CustomPropertyDialog) {
        return;
    }

    CRX.ide.CustomPropertyDialog = Ext.extend(Ext.Window, {
        title: 'Add Property',
        modal: true,
        width: 640,
        height: 370,
        closeAction: 'hide',
        layout: 'fit',

        constructor: function(config) {
            this.propertyPanel = Ext.getCmp(CRX.ide.PROPERTIES_ID);
            config = config || {};

            Ext.applyIf(config, {
                items: {
                    xtype: 'panel',
                    layout: 'form',
                    bodyStyle: 'padding: 20px 20px 0 12px',
                    autoScroll: true,
                    labelWidth: 50,
                    defaults: {
                        msgTarget: 'side',
                        anchor: '98.5%',
                    },
                    items: [
                        Ext.apply(this.propertyPanel.name.cloneConfig(), {
                            id: 'propName',
                            fieldLabel: 'Name',
                        }),
                        Ext.apply(this.propertyPanel.types.cloneConfig(), {
                            id: 'propType',
                            fieldLabel: 'Type'
                        }),
                        this.prepareValueField(CRX.util.STRING),
                        {
                            xtype: 'button',
                            id: 'multiTrigger',
                            text: '+',
                            width: 30,
                            anchor: 'left',
                            style: 'margin: 0 0 0 55px',
                            handler: () => this.swapValueField('', true),
                        }
                    ],
                    listeners: {
                        'beforeremove': function (panel, item) {
                            if (item.id === 'propValue') {
                                const propValueEl = document.querySelector('#x-form-el-propValue');
                                if (propValueEl) {
                                    propValueEl.closest('.x-form-item').remove();
                                }
                            }
                        }
                    }
                },
                buttonAlign: 'center',
                buttons: [
                    {
                        text: 'OK',
                        handler: async () => {
                            if (await this.save()) {
                                this.hide();
                            }
                        }
                    },
                    {
                        text: 'Cancel',
                        handler: () => this.hide()
                    }
                ],
                keys: [
                    {
                        key: [10, 13],
                        ctrl: false,
                        alt: false,
                        shift: false,
                        fn: async () => {
                            if (await this.save()) {
                                this.hide();
                            }
                        },
                        stopEvent: true
                    },
                ]
            });

            CRX.ide.CustomPropertyDialog.superclass.constructor.call(this, config);

            this.panel = this.items.get(0);
            this.propName = this.panel.items.get('propName');
            this.propType = this.panel.items.get('propType');
            this.multiTrigger = this.panel.items.get('multiTrigger');
        },

        initComponent: function() {
            CRX.ide.AccessControlDialog.superclass.initComponent.call(this);

            const propType = this.items.get(0).items.get('propType');
            propType.purgeListeners();
            propType.addListener('select', (combo, record) => {
                this.swapValueField(record.get("field1") || CRX.util.STRING);
            });
            propType.bindStore([
                CRX.util.STRING,
                CRX.util.BOOLEAN,
                CRX.util.DATE,
                CRX.util.LONG,
                CRX.util.DOUBLE,
                CRX.util.DECIMAL,
                CRX.util.PATH,
                CRX.util.URI,
                CRX.util.NAME
            ]);

            this.on('show', function() {
                if (this.record && this.isMultiple()) {
                    this.getPropValue().addItems(this.record.get('value'));
                    this.getPropValue().doLayout();
                } else if (this.record) {
                    this.getPropValue().setValue(this.record.get('value'));
                }
                setTimeout(() => {
                    if (this.record) {
                        this.getPropValue().focus();
                    } else {
                        this.propName.focus();
                    }
                }, 100);
            });
            this.on('hide', function() {
                if (this.record && this.resetProtected) {
                    this.record.set('isProtected', true);
                    this.record.commit();
                }
                this.reset();
            });
        },

        reset: function() {
            delete this.record;
            delete this.resetProtected;

            this.setTitle('Add Property');

            this.propName.setValue('');
            this.propName.clearInvalid();
            this.propName.enable();

            this.propType.setValue(CRX.util.STRING);
            this.propType.clearInvalid();
            this.propType.setDisabled(false);

            if (this.getPropValue().xtype === 'textarea') {
                this.getPropValue().setValue('');
            } else {
                this.panel.remove(this.getPropValue(), true);
                this.panel.insert(this.panel.items.length - 1, this.prepareValueField(CRX.util.STRING));
            }
            this.multiTrigger.show();

            Array.prototype.filter.call(document.querySelectorAll('.x-panel'), node => node.style.position === 'absolute')
                .forEach(node => node.style.visibility = 'hidden');

        },

        setRecord: function(record, unlocked) {
            if (!record || !record.data) {
                return;
            }

            this.setTitle('Edit Property');

            this.propName.disable();
            this.propName.setValue(record.get('name'));

            this.propType.setValue(record.get('type'));
            if (unlocked) {
                this.propType.setDisabled(true);
                this.resetProtected = true;
            } else {
                this.resetProtected = false;
            }

            const needMulti = record.get('isMultiple') && Array.isArray(record.get('value'));
            this.swapValueField(record.get('type'), needMulti ? 'auto' : false);
            this.record = record;
        },

        save: async function() {
            if (!Ext.getCmp(CRX.ide.TREE_ID).getSelectionModel().getSelectedNode()) {
                return true;
            }

            if (!this.validateAll()) {
                return false;
            }

            const isString = this.getPropValue().dataType === CRX.util.STRING || this.getPropValue().xtype === 'textarea';
            const savedValue = this.isMultiple()
                ? this.getPropValue().getValues()
                        .map(value => isString ? value.replace(/\s+$/s, '') : value)
                        .filter(value => value !== '' && value !== undefined)
                : (isString ? this.getPropValue().getValue().replace(/\s+$/s, '') : this.getPropValue().getValue());

            const savingContext = {
                record: this.record,
                id: this.propName.getValue(),
                type: this.propType.getValue()
            };

            if (this.isMultiple() && savedValue.length <= 1) {
                Ext.Msg.show({
                    title:  'Save as multi-value?',
                    msg: `You have ${savedValue.length === 0 ? 'no valid entries' : 'only one valid entry'} in the multifield.
                          \nWould you like to save this as a multi-value attribute, or as an ordinary single-value attribute?`,
                    buttons: {ok:'Multivalue', cancel:'Single value'},
                    icon: Ext.MessageBox.QUESTION,
                    closable: false,
                    width: 420,
                    fn: (btn) => {
                        if (btn === 'ok') {
                            this.persistRecord(savedValue, savingContext);
                        } else {
                            this.persistRecord(savedValue[0] || '', savingContext);
                        }
                    }
                });
            } else {
                await this.persistRecord(savedValue, savingContext);
            }
            return true;
        },

        persistRecord: async function(value, context) {
            const main = Ext.getCmp(CRX.ide.MAIN_ID);
            const selection = Ext.getCmp(CRX.ide.TREE_ID).getSelectionModel().getSelectedNode();

            const differByArrayType = (first, second) => {
                return (Array.isArray(first) && !Array.isArray(second))
                    || (!Array.isArray(first) && Array.isArray(second));
            };
            const needRecreate = context.record
                && (context.record.get('type') !== context.type
                    || differByArrayType(context.record.get('value'), value));

            const updateView = () => {
                main.showProperties(selection);
                const propertyPos = this.propertyPanel.getStore().find('name', context.id);
                if (propertyPos > -1) {
                    this.propertyPanel.getSelectionModel().selectRow(propertyPos);
                    this.propertyPanel.getView().getRow(propertyPos).scrollIntoView();
                }
            };

            if (needRecreate) {
                selection.deletePropertyRecords([context.record]);
                await CRXB.util.save(true);
            }

            if (context.record && !needRecreate) {
                context.record.set('value', value);
                context.record.json = JSON.stringify(value);
                await CRXB.util.save(true);
                if (this.resetProtected) {
                    context.record.set('isProtected', true);
                    context.record.commit();
                    await CRXB.util.save(true);
                }
                updateView();
            }

            if (!context.record || needRecreate) {
                const recordAttributes = {
                    name: context.id,
                    type: context.type,
                    value: value,
                    isMandatory: false,
                    isProtected: false,
                    isAutoCreated: false,
                    isMultiple: Array.isArray(value)
                };
                const newRecord = new CRX.ide.PropertyRecord(recordAttributes, context.id);
                newRecord.json = JSON.stringify(value);
                newRecord.markDirty();
                selection.addPropertyRecord(newRecord);
                await CRXB.util.save(true);
                updateView();
            }

        },

        swapValueField: function(value, convertToMulti) {
            const existingField = this.getPropValue();
            const existingValue = this.isMultiple() ? existingField.getValues() : existingField.getValue();

            const dataTypeMatchesExisting = !value || value === existingField.xtype || value === existingField.dataType;
            if (this.isMultiple()) {
                convertToMulti = false;
            }
            if (dataTypeMatchesExisting && !convertToMulti) {
                return;
            }

            let propValueEmpty = undefined;
            if ((convertToMulti && convertToMulti !== 'auto') || (this.isMultiple() && !existingValue.length)) {
                propValueEmpty = existingField.initialConfig ? existingField.initialConfig.value || '' : '';
            }

            let newField;
            if (dataTypeMatchesExisting && convertToMulti) {
                newField = this.convertToMultifield(existingField);

            } else if ((!dataTypeMatchesExisting && convertToMulti)
                || this.isMultiple()) {
                newField = this.convertToMultifield(this.prepareValueField(value));

            } else {
                newField = this.prepareValueField(value);
            }
            this.panel.add(newField);
            this.panel.remove(existingField, true);

            let convertedValue;
            if (convertToMulti !== 'auto') {
                convertedValue =  this.convertValue(existingValue, newField.dataType);
            }
            if (this.isMultiple() && convertedValue !== undefined) {
                this.getPropValue().addItems(convertedValue);
            } else if (convertedValue !== undefined) {
                this.getPropValue().setValue(convertedValue);
            }
            if (propValueEmpty !== undefined) {
                newField.addItem(propValueEmpty);
            }

            if (this.isMultiple() || newField.xtype === 'datetime') {
                this.multiTrigger.hide();
            } else {
                this.multiTrigger.show();
            }
            this.doLayout();
        },

        prepareValueField: function(type) {
            const raw = Ext.apply(this.propertyPanel.value[type], {id: 'propValue', fieldLabel: 'Value', dataType: type});
            if (type === CRX.util.STRING) {
                return Ext.apply(raw, {height: 150});
            }
            return raw;
        },

        convertToMultifield: function(field) {
            const needXtype = field.xtype || (field.initialConfig ? field.initialConfig.xtype : 'textfield');
            if (needXtype === 'datetime') {
                return field;
            }
            const needHeight = field.height || (field.initialConfig ? field.initialConfig.height : '');
            const multi = new CRX.ide.MultiField({
                xtype: 'multifield',
                border: false,
                fieldConfig: {
                    xtype: needXtype,
                    height: needHeight
                }
            });
            multi.fields.defaults.fieldConfig.validator = field.validator;
            if (needXtype === 'combo') {
                multi.fields.defaults.fieldConfig.value = true;
                multi.fields.defaults.fieldConfig.store = [true, false];
                multi.fields.defaults.fieldConfig.triggerAction = "all";
            }
            return Ext.apply(multi, {id: 'propValue', fieldLabel: 'Value', dataType: field.dataType || needXtype});
        },

        convertValue: function(value, type) {
            if (value === undefined || value === null) {
                return undefined;
            }
            if (type === CRX.util.DATE || type === 'datetime') {
                return undefined;
            }
            if (Array.isArray(value)) {
                return value.map(v => this.convertValue(v, type));
            }
            if (type === CRX.util.BOOLEAN || type === 'combo') {
                const numericValue = Number(value.toString());
                if (!isNaN(numericValue) && numericValue !== 0) {
                    return true;
                } else if (!isNaN(numericValue)) {
                    return false;
                }
                return value.toString().toLowerCase() === 'true';
            }
            if (type === CRX.util.LONG || type === CRX.util.DOUBLE || type === CRX.util.DECIMAL || type === 'spinner') {
                if (value.toString().toLowerCase() === 'true') {
                    return 1;
                }
                const result = parseFloat(value);
                return !isNaN(result) ? result : 0;
            }
            return value.toString();
        },

        isMultiple: function() {
            return this.getPropValue().xtype === 'multifield';
        },

        validateAll: function() {
            if (!this.propName.validate() || !this.propType.validate()) {
                return false;
            }
            if (this.getPropValue().xtype === 'multifield') {
                for (let i = 0; i < this.getPropValue().fields.items.length; i++) {
                    const item = this.getPropValue().fields.items.get(i).field;
                    if (item.validate && !item.validate()) {
                        return false;
                    }
                }
                return true;
            }
            return this.getPropValue().validate ? this.getPropValue().validate() : true;
        },

        getPropValue: function() {
            return this.panel.items.get('propValue');
        }

    });

    CRX.ide.CustomPropertyDialog.getInstance = (function() {
        const id = Ext.id();
        return function() {
            return Ext.WindowMgr.get(id) || new CRX.ide.CustomPropertyDialog({ id: id });
        }
    })();

    Ext.reg('custompropertydialog', CRX.ide.CustomPropertyDialog);
};

CRXB.util.getPropertyDialogActions = function() {
    if (CRX.ide.AddPropertyDialogAction) {
        return [CRX.ide.AddPropertyDialogAction, CRX.ide.EditPropertyDialogAction];
    }

    CRXB.util.registerPropertyDialog();

    const UNLOCKABLE_PROPERIES = {
        'jcr:created': function(store) {
            return store.getById('jcr:primaryType').get('value') === 'nt:unstructured'
        },
        'jcr:createdBy': function(store) {
            return store.getById('jcr:primaryType').get('value') === 'nt:unstructured'
        },
        'rep:principalName': false,
        'rep:privileges': false,
        'jcr:predecessors': false,
        'jcr:baseVersion': false,
        'jcr:isCheckedOut': false,
        'jcr:uuid': false,
        'jcr:versionHistory': false
    };

    CRX.ide.AddPropertyDialogAction = new Ext.Action({
        text: 'Add ...',
        iconCls: 'action-add',
        dialogId: 'custompropertydialog',
        handler: () => CRX.ide.CustomPropertyDialog.getInstance().show()
    });

    CRX.ide.EditPropertyDialogAction = new Ext.Action({
        text: 'Edit ...',
        iconCls: 'action-edit',
        dialogId: 'custompropertydialog',
        disabled: true,
        handler: () => {
            const selectionModel = Ext.getCmp(CRX.ide.TOOLS_WRAPPER_ID).items.get(CRX.ide.PROPERTIES_ID).getSelectionModel();
            const record = selectionModel.getSelected();
            const dialog = CRX.ide.CustomPropertyDialog.getInstance();
            if (!record) {
                return this.setDisabled(true);
            }
            if (!record.get('isProtected')) {
                dialog.setRecord(record);
                return dialog.show();
            }
            Ext.Msg.show({
                title: 'Unlock property?',
                msg: `The <em>${record.get('name')}</em> property is read-only by design.<br><br>
                      Do you wish to unlock it for editing?`,
                width: 420,
                icon: Ext.MessageBox.QUESTION,
                buttons: Ext.MessageBox.YESNO,
                fn: function(btn) {
                    if (btn === 'yes') {
                        record.set('isProtected', false);
                        dialog.setRecord(record, true);
                        return dialog.show();
                    }
                }
            });
        }
    });
    CRX.ide.EditPropertyDialogAction.checkActive = function() {
        const grid = Ext.getCmp(CRX.ide.TOOLS_WRAPPER_ID).items.get(CRX.ide.PROPERTIES_ID);
        const record = grid.getSelectionModel().getSelected();
        if (!record || !(record.get('isProtected'))) {
            return this.setDisabled(false);
        }
        const unlockableEntry = UNLOCKABLE_PROPERIES[record.get('name')];
        if (unlockableEntry === false) {
            this.setDisabled(true);
        } else if (unlockableEntry instanceof Function) {
            this.setDisabled(!unlockableEntry(grid.store));
        } else {
            this.setDisabled(false);
        }
    };


    return [CRX.ide.AddPropertyDialogAction, CRX.ide.EditPropertyDialogAction];
};

CRXB.util.registerReplicationDialog = function() {
    if (CRX.ide.ReplicationDialog) {
        return;
    }

    CRX.ide.ReplicationDialog = Ext.extend(Ext.Window, {
        cls: 'replication',
        title: 'Replication',
        modal: true,
        width: 640,
        height: 420,
        closeAction: 'hide',
        layout: 'fit',
        buttonAlign: 'center',

        constructor: function(config) {
            config = config || {};
            this.replicationPanel = new CRX.ide.ReplicationPanel();

            Ext.applyIf(config, {
                xtype: 'replicationdialog',
                items: [this.replicationPanel]
            });

            CRX.ide.ReplicationPanel.superclass.constructor.call(this, config);
        },

        initComponent: function() {
            CRX.ide.ReplicationDialog.superclass.initComponent.call(this);
            this.on('show', function() {
                const path = this.node ? CRX.Util.getLocalWorkspacePath(this.node.getRealPath()) : CRXB.util.getCurrent('path');
                if (path) {
                    this.setTitle('Replication: ' + path);
                    this.replicationPanel.meActive = true;
                    this.replicationPanel.setCurrentPath(path);
                }
            });
        },

        init: function(node) {
            this.node = node;
        }
    });

    CRX.ide.ReplicationDialog.getInstance = (function() {
        const id = Ext.id();
        return function() {
            return Ext.WindowMgr.get(id) || new CRX.ide.ReplicationDialog({ id: id });
        }
    })();

    Ext.reg('replicationdialog', CRX.ide.ReplicationDialog);
};

CRXB.util.getReplicationDialogActions = function() {
    if (CRX.ide.ReplicationDialogAction) {
        return [CRX.ide.ReplicationDialogAction, CRX.ide.ReplicationActivateAction, CRX.ide.ReplicationDeactivateAction];
    }

    CRXB.util.registerReplicationDialog();

    CRX.ide.ReplicationDialogAction = new Ext.Action({
        text: 'Replication ...',
        iconCls: 'action-replicate',
        dialogId: 'replicationdialog',
        handler: CRX.Util.openActionDialog
    });

    const DIALOG_WIDTH = 420;
    const handleException = function(title, e) {
        Ext.Msg.show({
            title: title,
            msg: `Could not ${title.toLowerCase()} <em>${path}</em>: ${e.message || e}`,
            width: DIALOG_WIDTH,
            buttons: Ext.Msg.OK,
            iconCls: Ext.Msg.ERROR
        });
    };

    CRX.ide.ReplicationActivateAction = new Ext.Action({
        text: 'Activate',
        handler: async function() {
            const path = CRXB.util.getCurrent('path');
            if (!path) {
                return;
            }
            const formData = [
                'path=' + encodeURIComponent(path),
                'action=replicate',
                '_charset_=utf-8'
            ];

            try {
                const response = await fetch('replication.jsp', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                    },
                    body: formData.join('&')
                });
                if (response.ok) {
                    Ext.Msg.show({
                        title: 'Activation',
                        msg: `Initiated activation of <em>${path}</em>`,
                        width: DIALOG_WIDTH,
                        buttons: Ext.Msg.OK,
                        icon: Ext.Msg.INFO
                    });
                } else {
                    handleException('Activate', response.statusText);
                }
            } catch (e) {
                handleException('Activate', e);
            }
        }
    });

    CRX.ide.ReplicationDeactivateAction = new Ext.Action({
        text: 'Deactivate',
        handler: async function() {
            const path = CRXB.util.getCurrent('path');
            if (!path) {
                return;
            }
            const formData = [
                'path=' + encodeURIComponent(path),
                'action=replicatedelete',
                '_charset_=utf-8'
            ];

            try {
                const response = await fetch('replication.jsp', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                    },
                    body: formData.join('&')
                });
                if (response.ok) {
                    Ext.Msg.show({
                        title: 'Activation',
                        msg: `Initiated deactivation of <em>${path}</em>`,
                        width: DIALOG_WIDTH,
                        buttons: Ext.Msg.OK,
                        icon: Ext.Msg.INFO
                    });
                } else {
                    handleException('Deactivate', response.statusText);
                }
            } catch (e) {
                handleException('Deactivate', e);
            }
        }
    });

    return [CRX.ide.ReplicationDialogAction, CRX.ide.ReplicationActivateAction, CRX.ide.ReplicationDeactivateAction];
};

CRXB.util.registerSearchPanel = function() {
    if (CRX.ide.SearchPanel) {
        return CRX.ide.SearchPanel;
    }

    CRX.ide.SearchPanel = Ext.extend(Ext.Panel, {
        title: 'SEARCH',
        closable: true,
        layout: 'fit',

        constructor: function(config) {

            this.QUERY_LIMIT = CRXB.settings.get('search-page-size') || 30;

            this.store = new Ext.data.JsonStore({
                autoDestroy: true,
                autoLoad: false,
                fields: ['path'],

                proxy: new Ext.data.HttpProxy({
                    url: config.endpoint || CRX.ide.SearchPanel.SEARCH_ENDPOINT,
                    method: 'GET',
                    timeout: 180000 
                }),
                root: 'results',
                idProperty: 'path',
                totalProperty: 'total',
                listeners: {
                    exception: (proxy, type, action, options, response) => this.handleException(proxy, type, response)
                }
            });

            this.resultsView = new Ext.grid.GridPanel({
                id: 'search-results',
                margins:"0 0 0 0",
                view: new Ext.grid.GridView({
                    emptyText: 'No results to display'
                }),
                autoExpandColumn: 'path',
                cm: new Ext.grid.ColumnModel({
                    columns: [
                        {
                            id: 'path',
                            header: 'Path',
                            dataIndex: 'path',
                            sortable: false,
                            renderer: value => this.renderItem(value)
                        }
                    ],
                }),
                sm: new Ext.grid.RowSelectionModel({
                    singleSelect: true
                }),
                viewConfig: new Ext.grid.GridView({
                    forceFit: true
                }),
                store: this.store,
                contextMenu: new Ext.menu.Menu({
                    id: 'search-menu',
                    cls: 'x-menu-detached hide-disabled',
                    items: [
                        CRX.ide.CopyNodeAction,
                        CRX.ide.MoveNodeAction,
                        '-',
                        CRX.ide.OverlayNodeAction,
                        CRXB.util.getAccessControlDialogAction(),
                        '-',
                        CRXB.util.getReplicationDialogActions(),
                        '-',
                        CRXB.util.getDownloadActions(),
                    ]
                }),
                listeners: {
                    rowdblclick: function(grid, index, e) {
                        e.stopEvent();
                        CRXB.util.setLocation(grid.getSelectionModel().getSelected().get('path'), {ensureVisible: true, shrinkOthers: true});
                    },
                    rowcontextmenu: async function(grid, index, e) {
                        e.stopEvent();
                        const selectionModel = grid.getSelectionModel();
                        if (!selectionModel.hasSelection() || !selectionModel.isSelected(index)) {
                            selectionModel.selectRow(index);
                        }
                        grid.contextMenu.show(grid.getView().getRow(index));
                        grid.contextMenu.getEl().setX(e.getXY()[0]);
                    },
                }
            });

            this.resultsView.getSelectionModel().on('selectionchange', function(selectionModel) {
                if (!selectionModel.hasSelection()) {
                    return;
                }
                CRXB.util.setLocation(selectionModel.getSelected().get('path'), {ensureVisible: false});
            });

            CRXB.util.modifyMenuItem(this.resultsView.contextMenu, CRX.ide.CopyNodeAction, item => item.iconCls = 'action-copy');
            CRXB.util.modifyMenuItem(this.resultsView.contextMenu, CRX.ide.MoveNodeAction, item => item.iconCls = 'action-move');

            this.mask =  new Ext.LoadMask(Ext.getBody());

            const searchPanel = this;
            Ext.applyIf(config, {
                tbar: new Ext.Toolbar({
                    cls: 'light',
                    items: [
                        {
                            id: 'search-nav-backward',
                            iconCls: 'action-backward',
                            disabled: true,
                            handler: () => this.navigateBack()
                        },
                        {
                            id: 'search-nav-status',
                            cls: 'full-size-text',
                            xtype: 'tbtext',
                            text: '',
                            listeners: {
                                render: function(button) {
                                    button.el.dom.addEventListener('click', (e) => {
                                        if (e.target.tagName === 'EM') {
                                            document.getElementById('repository-path').value = searchPanel.term;
                                        }
                                    });
                                }
                            }
                        },
                        {
                            id: 'search-nav-forward',
                            iconCls: 'action-forward',
                            disabled: true,
                            handler: () => this.navigateForward()
                        }
                    ],

                }),
                items: [this.resultsView],
            });
            CRX.ide.SearchPanel.superclass.constructor.call(this, config);
        },

        search: function(term) {
            if (this.masked) {
                return;
            }

            this.store.proxy.setApi({read: CRX.ide.SearchPanel.SEARCH_ENDPOINT});
            this.store.proxy.setUrl(CRX.ide.SearchPanel.SEARCH_ENDPOINT, true);

            this.term = term;
            this.paging = {start: 1};

            this.store.loaded = false;
            this.load();
        },

        query: function(term, type = 'JCR-SQL2') {
            if (this.masked) {
                return;
            }

            this.store.proxy.setApi({read: CRX.ide.SearchPanel.QUERY_ENDPOINT});
            this.store.proxy.setUrl(CRX.ide.SearchPanel.QUERY_ENDPOINT, true);

            this.term = term;
            this.termType = type;
            this.paging = {start: 0};

            this.store.loaded = false;
            this.load();
        },

        navigateBack: function() {
            if (!this.paging || this.paging.start === undefined) {
                return;
            }
            this.paging.start -= this.QUERY_LIMIT;
            this.load();
        },

        navigateForward: function() {
            if (!this.paging || this.paging.start === undefined) {
                return;
            }
            this.paging.start += this.QUERY_LIMIT;
            this.load();
        },

        showMask: function() {
            this.mask.show();
            this.masked = true;
        },

        hideMask: function() {
            this.masked = false;
            this.mask.hide();
        },

        isSearchMode: function() {
            return this.store.proxy.url ===  CRX.ide.SearchPanel.SEARCH_ENDPOINT;
        },

        isQueryMode: function() {
            return this.store.proxy.url ===  CRX.ide.SearchPanel.QUERY_ENDPOINT;
        },

        load: function() {
            const searchPanel = this;
            const queryParams = searchPanel.isSearchMode()
                ? {query: searchPanel.term, start: searchPanel.paging.start, limit: this.QUERY_LIMIT}
                : {stmt: searchPanel.term, showResults: true, type: searchPanel.termType};

            if (!this.store.loaded) {
                this.showMask();
                this.store.load({
                    params: queryParams,
                    callback: function() {
                        searchPanel.loadCallback(searchPanel, this);
                    }
                });
            } else {
                this.store.clearFilter(true);
                this.store.filterBy(this.queryStorePagination, this);
                this.loadCallback(this, this.store);
            }
        },

        loadCallback: function(searchPanel, store) {
            searchPanel.hideMask();
            searchPanel.paging.total = store.getTotalCount() >= 0 || searchPanel.isQueryMode() ? store.getTotalCount() : Number.MAX_SAFE_INTEGER;

            const actualCount = searchPanel.isSearchMode() || searchPanel.paging.total === 0
                ? store.getCount()
                : Math.min(searchPanel.paging.total - searchPanel.paging.start, searchPanel.QUERY_LIMIT);

            const navBackward = searchPanel.topToolbar.items.get('search-nav-backward');
            const navForward = searchPanel.topToolbar.items.get('search-nav-forward');
            const navStatus = searchPanel.topToolbar.items.get('search-nav-status');
            navBackward.setDisabled(searchPanel.paging.start <= 1 || actualCount === 0);
            navForward.setDisabled(searchPanel.paging.start + actualCount >= searchPanel.paging.total);

            if (actualCount > 0) {
                const startValue = searchPanel.isQueryMode() ? searchPanel.paging.start + 1 : searchPanel.paging.start;
                const endValue = startValue + actualCount - 1;
                const totalValue = searchPanel.paging.total !== Number.MAX_SAFE_INTEGER ? ' of ' + searchPanel.paging.total : '';
                const forValue = searchPanel.isSearchMode()
                    ? `"<em>${searchPanel.truncateText(searchPanel.term, 30)}</em>"`
                    : `<u><em ext:qtip="${searchPanel.term.replace('"', '\\"')}">this query</em></u>`;

                navStatus.setText(`Showing ${startValue}&ndash;${endValue}${totalValue} for ${forValue}`);
            } else {
                const forValue = searchPanel.isSearchMode()
                    ? `Search "<em>${searchPanel.truncateText(searchPanel.term, 30)}</em>"`
                    : `Hover to see <u><em ext:qtip="${searchPanel.term.replace('"', '\\"')}">query</em></u>`;
                navStatus.setText(forValue);
            }

            if (searchPanel.isQueryMode() && !store.loaded) {
                store.loaded = true;
                store.filterBy(searchPanel.queryStorePagination, searchPanel);
            }

        },

        queryStorePagination: function(record) {
            const index = record.store.data.indexOf(record);
            return index >= this.paging.start && index < this.paging.start + this.QUERY_LIMIT;
        },

        handleException: function(proxy, type, response) {
            this.store.removeAll();
            this.loadCallback(this, this.store);
            let errorMessage = 'Could not perform query: ';
            if (type === 'response') {
                errorMessage += response.statusText || response.status
            } else if (response.errorMessage) {
                errorMessage = response.errorMessage;
            } else {
                errorMessage += 'unknown error';
            }
            Ext.Msg.show({
                title: 'Error',
                msg: errorMessage,
                width: 420,
                buttons: Ext.MessageBox.OK,
                icon: Ext.MessageBox.ERROR
            });
        },

        renderItem: function(value) {
            let iconType = CRX.NodetypeRegistry.getIconClass(value);
            if (iconType === 'unstructured') {
                if (/\.\w{3,4}$/.test(value)) {
                    iconType = 'file';
                } else if (!/jcr:content/i.test(value)) {
                    iconType = 'page';
                }
            }
            return `<span class="x-tree-node-icon ${iconType}">&nbsp;</span><span ext:qtip="${value}">${value}</span>`;
        },

        truncateText: function(text, len) {
            if (text.length < len) {
                return text;
            }
            return text.slice(0, len) + '...';
        }

    });

    CRX.ide.SearchPanel.SEARCH_ENDPOINT = 'search.jsp';
    CRX.ide.SearchPanel.QUERY_ENDPOINT = 'query.jsp';

    return CRX.ide.SearchPanel;
};



CRXB.util.registerSettingsDialog = function() {
    if (CRX.ide.SettingsDialog) {
        return;
    }

    CRX.ide.SettingsDialog = Ext.extend(Ext.Window, {
        title: 'Settings',
        modal: true,
        width: 420,
        height: 450,
        layout: 'fit',

        constructor: function(config) {
            this.omniboxAutoPattern = new Ext.form.TextField({
                id: 'omnibox-auto-pattern',
                fieldLabel: 'Auto address pattern'
            });

            this.omniboxAutoPrefix = new Ext.form.TextField({
                id: 'omnibox-auto-replacement',
                fieldLabel: 'Auto replacement'
            });

            this.searchPanelSize = new Ext.ux.SpinnerField({
                id: 'search-page-size',
                fieldLabel: 'Items per page',
                allowBlank: true,
                defaultValue: 30,
                minValue: 1
            });

            this.openInEditMode = new Ext.form.Checkbox({
                id: 'prefer-edit-mode',
                fieldLabel: 'Open pages in editmode',
            });

            this.allowDragging = new Ext.form.Checkbox({
                id: 'allow-dragging',
                fieldLabel: 'Allow dragging nodes',
            });

            this.defaultAcHandling = new Ext.form.ComboBox({
                id: 'default-ac-handling',
                fieldLabel: 'Access control handling',
                store: CrxPackager.AC_HANDLING_OPTIONS,
                triggerAction: 'all',
                defaultValue: CrxPackager.AC_HANDLING_OPTIONS[0],
                validator: function(value) {
                    return CrxPackager.AC_HANDLING_OPTIONS.indexOf(value) >= 0
                }
            });

            this.inMemPackageSize = new Ext.ux.SpinnerField({
                id: 'in-mem-package-size',
                fieldLabel: 'In-memory package size (Mb)',
                allowBlank: true,
                defaultValue: CrxPackager.MAX_BLOB_SIZE_MB,
                minValue: 1
            });

            Ext.applyIf(config, {
                items: {
                    xtype: 'panel',
                    layout: 'form',
                    bodyStyle: 'padding: 20px 12px 0 12px',
                    labelWidth: 140,
                    defaults: {
                        msgTarget: 'side',
                        anchor: '98%',
                    },
                    items: [
                        {
                            xtype: 'label',
                            cls: 'dialog-section',
                            text: 'Omnibox settings',
                            anchor: false,
                        },
                        this.omniboxAutoPattern,
                        this.omniboxAutoPrefix,
                        {
                            xtype: 'label',
                            cls: 'dialog-section',
                            text: 'Repository tree settings',
                            anchor: false,
                        },
                        this.openInEditMode,
                        this.allowDragging,
                        {
                            xtype: 'label',
                            cls: 'dialog-section',
                            text: 'Search panel settings',
                            anchor: false,
                        },
                        this.searchPanelSize,
                        {
                            xtype: 'label',
                            cls: 'dialog-section',
                            text: 'Packager settings',
                            anchor: false,
                        },
                        this.defaultAcHandling,
                        this.inMemPackageSize,
                    ],
                },
                buttonAlign: 'center',
                buttons: [
                    {
                        text: 'OK',
                        handler: () => {
                            this.save();
                            document.location.reload();
                        }
                    },
                    {
                        text: 'Cancel',
                        handler: () => this.close()
                    }
                ],
                keys: [
                    {
                        key: [10, 13],
                        alt: false,
                        ctrl: false,
                        shift: false,
                        fn: () => {
                            document.location.reload();
                        },
                        stopEvent: true
                    }
                ]
            });
            CRX.ide.SettingsDialog.superclass.constructor.call(this, config);
        },

        initComponent: function() {
            CRX.ide.SettingsDialog.superclass.initComponent.call(this);
            const panel = this.items.get(0);
            panel.items.each(function(item) {
                if (!item.setValue) {
                    return;
                }
                item.setValue(CRXB.settings.get(item.id) || item.defaultValue);
                item.originalValue = item.getValue();
            });
        },

        save: function() {
            if (!this.isDirty()) {
                return true;
            }
            const panel = this.items.get(0);
            const settings = {};
            panel.items.each(function(item) {
                if (!item.getValue) {
                    return;
                }
                settings[item.id] = item.getValue();
            });
            CRXB.settings.update(SettingsHolder.SETTINGS, settings).save();
        },

        isDirty: function() {
            let result = false;
            const panel = this.items.get(0);
            panel.items.each(function(item) {
                if (item.isDirty && item.isDirty()) {
                    result = true;
                }
            });
            return result;
        },

    });
    CRX.ide.SettingsDialog.getInstance = (function() {
        const id = Ext.id();
        return function() {
            return Ext.WindowMgr.get(id) || new CRX.ide.SettingsDialog({ id: id });
        }
    })();
};

CRXB.util.getSettingsDialogAction = function() {
    if (CRX.ide.SettingsDialogAction) {
        return CRX.ide.SettingsDialogAction;
    }

    CRXB.util.registerSettingsDialog();
    CRX.ide.SettingsDialogAction = new Ext.Action({
        text: 'Settings ...',
        iconCls: 'action-settings',
        handler: () => {
            CRX.ide.SettingsDialog.getInstance().show();
        }
    });

    return CRX.ide.SettingsDialogAction;
};

CRXB.util.getDragActions = function() {
    if (CRX.ide.AllowDragAction) {
        return [CRX.ide.AllowDragAction, CRX.ide.LockDragAction];
    }

    CRX.ide.AllowDragAction = new Ext.Action({
        text: 'Unlock for dragging',
        handler: () => {
            const node = CRXB.util.getCurrent('node');
            node.draggable = true;
            node.ui.elNode.classList.add('drag');
        }
    });
    CRX.ide.AllowDragAction.checkActive = function() {
        const currentNode = CRXB.util.getCurrent('node');
        const allowDragging = CRXB.settings.get('allow-dragging')
        const disabled = !currentNode
            || currentNode.draggable
            || allowDragging
            || currentNode === Ext.getCmp(CRX.ide.TREE_ID).getRootNode();
        this.setDisabled(disabled);
    };

    CRX.ide.LockDragAction = new Ext.Action({
        text: 'Lock for dragging',
        handler: (node) => {
            if (!node || node.getXType && (node.getXType() === 'menuitem')) {
                node = CRXB.util.getCurrent('node');
            }
            node.draggable = false;
            node.ui.elNode.classList.remove('drag');
        }
    });
    CRX.ide.LockDragAction.checkActive = function() {
        const currentNode = CRXB.util.getCurrent('node');
        const allowDragging = CRXB.settings.get('allow-dragging');
        const disabled = !currentNode
            || !currentNode.draggable
            || allowDragging
            || currentNode === Ext.getCmp(CRX.ide.TREE_ID).getRootNode();
        this.setDisabled(disabled);
    };

    return [CRX.ide.AllowDragAction, CRX.ide.LockDragAction];
};


CRXB.util.arrangeMenu = function(menu, order, exclude) {
    let position = 0;
    const flatOrder = order.flatMap(item => Array.isArray(item) ? item : [item]);
    for (let item of flatOrder) {
        if (typeof item === 'string' && !(item === '-' || item === '->' || item === ' ')) {
            const found = menu.findBy((mnu) => mnu.text === item || mnu.id === item || (mnu.baseAction && mnu.baseAction.text === item));
            if (found && found.length) {
                menu.insert(position++, found[0]);
            }
        } else if (typeof item === 'object') {
            const found = menu.findBy((mnu) => mnu === item || mnu.baseAction === item);
            if (found && found.length) {
                menu.insert(position++, found[0]);
            } else {
                menu.insert(position++, item);
            }
        } else if (item === '-' || item === '->' || item === ' ') {
            menu.insert(position++, item);
        }
    }
    while (menu.items.length > position) {
        const item = menu.items.get(position);
        if (!exclude || !exclude[item.text]) {
            menu.remove(position, true);
        } else {
            const op = exclude && exclude[item.text];
            if (op === 'hide') {
                item.hide();
            }
            position++;
        }
    }
};

CRXB.util.modifyMenuItem = function(menu, item, fn) {
    const itemArray =  Array.isArray(item) ? item : [item];
    const foundItems = [];
    for (let i of itemArray) {
        if (typeof i === 'string') {
            foundItems.push(...menu.findBy((mnu) => mnu.text === i || mnu.id === i || (mnu.baseAction && mnu.baseAction.text === i)));
        } else if (typeof i === 'object') {
            foundItems.push(...menu.findBy((mnu) => mnu === i || mnu.baseAction === i));
        }
    }
    foundItems.forEach(foundItem => fn(foundItem));
};

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

CRXB.util.getCurrentColorScheme = function(name, ignoreCustom) {
    const prefs = CRXB.settings.get(SettingsHolder.INSTANCE_PREFERENCES);
    const colorSchemeName = name ||  (prefs.colorScheme || {})[window.location.host] || 'Blue';
    const colorScheme = new CrxColorScheme(CRXB.settings.get('color-schemes')[colorSchemeName]);

    const customColors = prefs.customColors || {};
    const customScheme = customColors[colorSchemeName];
    if (customScheme && !ignoreCustom) {
        colorScheme.update(customScheme);
    }
    return colorScheme;
};

CRXB.util.getEnvironmentLabel = function() {
    const prefs = CRXB.settings.get(SettingsHolder.INSTANCE_PREFERENCES);
    return (prefs.environment || {})[window.location.host] || window.location.host;
};



CRXB.util.getOpenPageActions = function() {
    if (CRX.ide.OpenPageViewAction) {
        return [CRX.ide.OpenPageViewAction, CRX.ide.OpenPageEditAction];
    }

    CRX.ide.OpenPageViewAction = new Ext.Action({
        text: 'Open page',
        iconCls: 'action-link',
        handler: () => {
            const node = CRXB.util.getCurrent('node');
            const location = CRX.Util.getLaunchpadContextPath()
                + CRX.Util.getLocalWorkspacePath(node.getRealPath())
                + '.html?wcmmode=disabled';
            window.open(location);
        }
    });
    CRX.ide.OpenPageViewAction.checkActive = function() {
        const currentNode = CRXB.util.getCurrent('node');
        const isPage = currentNode.ui.iconNode.classList.contains('page');
        const disabled = !currentNode || !isPage || !CRXB.settings.get('prefer-edit-mode');
        this.setDisabled(disabled);
    };

    CRX.ide.OpenPageEditAction = new Ext.Action({
        text: 'Open in edit mode',
        iconCls: 'action-link',
        handler: () => {
            const node = CRXB.util.getCurrent('node');
            const location = CRX.Util.getLaunchpadContextPath().replace(/crx\/de\/?$/i, '')
                + '/editor.html'
                + CRX.Util.getLocalWorkspacePath(node.getRealPath()).replace(/\/$/, '')
                + '.html';
            window.open(location);
        }
    });
    CRX.ide.OpenPageEditAction.checkActive = function() {
        const currentNode = CRXB.util.getCurrent('node');
        const isPage = currentNode.ui.iconNode.classList.contains('page');
        const disabled = !currentNode || !isPage || CRXB.settings.get('prefer-edit-mode');
        this.setDisabled(disabled);
    };

    return [CRX.ide.OpenPageViewAction, CRX.ide.OpenPageEditAction];
};





CRXB.util.setLocation = function(value, options = {ensureVisible: true}) {
    const repositoryWrapper = Ext.getCmp('repository-wrapper');
    if (repositoryWrapper && repositoryWrapper.items.getCount() > 1 && options.ensureVisible) {
        options.scrollToPath = false;
        CRXB.util.loadPathAsync(value, options)
            .then((node) => {
                repositoryWrapper.setActiveTab(0);
                node.ui.anchor.scrollIntoView({
                    block: 'center',
                });
                node.ui.anchor.closest('.x-panel-body').scrollLeft = 0;
            })
            .catch(() => repositoryWrapper.setActiveTab(0));
    } else {
        CRXB.util.loadPath(value, options);
    }
};

CRXB.util.loadPath = function(path, options = {}) {
    const MAX_NODES_BEFORE_SHRINK = 750;
    const PAUSE_BEFORE_MODAL_MS = 300;

    if (options.scrollToPath === undefined) {
        options.scrollToPath = options.ensureVisible;
    }

    const repositoryTree = Ext.getCmp(CRX.ide.TREE_ID);

    path = (path.substr(0, 1) !== '/' ? '/' : '') + path.replace(/[^\w-,./]/g, v => encodeURIComponent(v));

    const checkButtonsTask = function(itemHolder) {
        if (!itemHolder.items || !itemHolder.items.each) {
            return;
        }
        itemHolder.items.each(item => {
            if (item.baseAction && item.baseAction.checkActive) {
                item.baseAction.checkActive.call(item);
            }
        })
    };

    let modalMask;
    const modalShowingTask = new Ext.util.DelayedTask(() => {
       if (Ext.MessageBox.isVisible()) {
           return;
       }
       modalMask = new Ext.LoadMask(Ext.getBody());
       modalMask.show();
    });
    modalShowingTask.delay(PAUSE_BEFORE_MODAL_MS);

    const expandTask = function() {
        repositoryTree.showPath(path, function(success, node) {
            modalShowingTask.cancel();
            if (modalMask) {
                modalMask.hide();
            }
            if (!success || !node) {
                console.error(`Could not load "${path}"`);
                if (options.cb) {
                    options.cb(success, node);
                }
                return;
            }
            const main = Ext.getCmp(CRX.ide.MAIN_ID);
            main.updatePath(node);
            main.updateAccessControl(node);
            main.updateReplication(node);
            main.showProperties(node);

            checkButtonsTask(Ext.getCmp(CRX.ide.TOOLBAR_ID));

            if (options.cb) {
                options.cb(success, node);
            }
            if (options.scrollToPath) {
                node.ui.anchor.scrollIntoView({
                    block: 'center',
                });
                node.ui.anchor.closest('.x-panel-body').scrollLeft = 0;
            }

            Ext.History.add(CRX.Util.convertTreeToJcrPath(node.getRawPath()));
        });
    };

    document.body.querySelectorAll('.x-tip').forEach(n => n.style.visibility = 'hidden');

    if (options.shrinkOthers && CRXB.util.getTreeCount() > MAX_NODES_BEFORE_SHRINK) {
        repositoryTree.getRootNode().reload(expandTask);
    } else {
        expandTask();
    }

};

CRXB.util.loadPathAsync = function(path, options = {}) {
    return new Promise((resolve, reject) => {
        const exCb = options.cb;
        options.cb = (success, node) => {
           if (success && node) {
               if (exCb) {
                   exCb(success, node);
               }
               resolve(node);
           } else {
               reject();
           }
        };
       CRXB.util.loadPath(path, options);
    });
};

CRXB.util.getCurrent = function(param) {
    const node = Ext.getCmp(CRX.ide.TREE_ID).getSelectionModel().getSelectedNode();
    const result = {node: node};
    if (node) {
        result.path = CRXB.util.nodeToJcrPath(node);
    }
    return param ? result[param] : result;
};

CRXB.util.nodeToJcrPath = function(node) {
    node = node || CRXB.util.getCurrent('node');
    if (!node) {
        return '';
    }
    let realPath = node.getRealPath();
    if (realPath.indexOf(CRX.ide.JCR_ROOT_NAME) > 0) {
        realPath = realPath.split(CRX.ide.JCR_ROOT_NAME)[1];
    }
    return realPath;
};

CRXB.util.findNearestCommon = function(node, path) {
    let currentNode = node;
    let currentPath = CRXB.util.nodeToJcrPath(currentNode);
    if (currentPath === path) {
        return currentNode;
    }
    while (path.indexOf(currentPath) !== 0 && currentNode.parentNode) {
        currentNode = currentNode.parentNode;
        currentPath = CRXB.util.nodeToJcrPath(currentNode);
    }
    if (currentNode === node && currentNode.parentNode) {
        return currentNode.parentNode;
    }
    return currentNode;
};

CRXB.util.sortNodes = function(n1, n2) {
    const text1 = (n1.text || '').toLowerCase();
    const text2 = (n2.text || '').toLowerCase();
    if (text1 === text2) {
        return 0;
    }
    if (text1 === 'jcr:content') {
        return -1;
    } else if (text2 === 'jcr:content') {
        return 1;
    }
    return text1 < text2 ? -1 : 1;
};

CRXB.util.getTreeCount = function() {
    const repositoryTree = Ext.getCmp(CRX.ide.TREE_ID);
    const rootNode = repositoryTree && repositoryTree.getRootNode();
    if (!rootNode) {
        return 0;
    }
    let count = 0;
    rootNode.cascade(function() {
       count++;
    });
    return count;
};

CRXB.util.save = async function(interactive) {
    const changedPaths = CRX.State.getChangedPaths("/" + CRX.Util.getWorkspace() + "/");

    const internal = async (url, diff) => {
        let response;
        try {
            response = await fetch(url, {
                method: 'post',
                headers:{
                    "Content-Type":"multipart/form-data; boundary=" + CRX.State.MULTIPART_BOUNDARY
                },
                body: diff
            });
            if (response.ok) {
                changedPaths.each(function(path) {
                    CRX.State.commitAllChanges(path);
                    CRX.State.removeTransientNode(path, false, true);
                    CRX.State.removeDeletedNode(path, true, false);
                });
            } else {
                const text = await response.text();
                response.responseXML = new window.DOMParser().parseFromString(text, 'text/xml');
                response.errorText = CRX.Util.getErrorMsgFromXml(response);
            }
        } catch (e) {
            response = response || {ok: 'false', status: 500, statusText: e || e.message};
        }
        if (!response.ok) {
            const errorMsg = `Could not save changes: ${response.status} ${response.errorText || response.statusText}`;
            console.error(errorMsg);
            if (interactive) {
                Ext.Msg.show({
                    title: 'Saving changes',
                    msg: errorMsg,
                    width: 420,
                    icon: Ext.Msg.ERROR,
                    buttons: Ext.Msg.OK
                });
            }
        }
    };

    const utf8Diff = CRX.State.getDiffMessage(changedPaths);
    const nonUtf8Diff = CRX.State.getNonUtf8ModifyMessage(changedPaths);

    if (utf8Diff) {
        await internal(CRX.Util.getSpiRootUrl(), utf8Diff);
    }
    if (nonUtf8Diff) {
        await internal(CRX.Util.getLaunchpadContextPath() + '/libs/crxde/data', nonUtf8Diff);
    }
};

CRXB.util.performSearch = function(value) {
    const repositoryWrapper = Ext.getCmp('repository-wrapper');
    if (repositoryWrapper.items.getCount() === 1) {
        repositoryWrapper.add(new CRX.ide.SearchPanel({endpoint: CRX.ide.SearchPanel.SEARCH_ENDPOINT}))
    }
    repositoryWrapper.setActiveTab(1);
    repositoryWrapper.items.get(1).search(value);
};


CRXB.util.performQuery = function(value, type) {
    const repositoryWrapper = Ext.getCmp('repository-wrapper');
    if (repositoryWrapper.items.getCount() === 1) {
        repositoryWrapper.add(new CRX.ide.SearchPanel({endpoint: CRX.ide.SearchPanel.QUERY_ENDPOINT}))
    }
    repositoryWrapper.setActiveTab(1);
    repositoryWrapper.items.get(1).query(value, type);
};

CRXB.util.getSortAction = function() {
    if (CRX.ide.SortAction) {
        return CRX.ide.SortAction;
    }
    CRX.ide.SortAction = new Ext.Action({
        text: 'Sort',
        iconCls: 'action-sorting-alpha',
        handler: (alphabetic = true) => {
            const current = CRXB.util.getCurrent();
            if (!current) {
                return;
            }
            const currentSortedNodes = GM_getValue('profile:sortedNodes') || [];
            let sortingChanged = false;
            if (alphabetic && currentSortedNodes.indexOf(current.path) < 0) {
                currentSortedNodes.push(current.path);
                current.node.ui.addClass('sorted');
                sortingChanged = true;
            } else if (!alphabetic && currentSortedNodes.indexOf(current.path) >= 0) {
                currentSortedNodes.splice(currentSortedNodes.indexOf(current.path), 1);
                current.node.ui.removeClass('sorted');
                sortingChanged = true;
            }
            if (sortingChanged) {
                GM_setValue('profile:sortedNodes', currentSortedNodes);
                Ext.getCmp(CRX.ide.TREE_ID).sorter.sortedNodes = currentSortedNodes;
                CRX.ide.RefreshAction.initialConfig.handler();
            }
        }
    });
    CRX.ide.SortAction.checkActive = function() {
        this.setDisabled(CRXB.util.getCurrent('node').ui.getEl().querySelector('div').classList.contains('sorted'));
    };
    return CRX.ide.SortAction;
};

CRXB.util.getUnsortAction = function() {
    if (CRX.ide.UnsortAction) {
        return CRX.ide.UnsortAction;
    }
    CRX.ide.UnsortAction = new Ext.Action({
        text: 'Unsort',
        iconCls: 'action-sorting-default',
        handler: () => CRX.ide.SortAction.execute(false)
    });
    CRX.ide.UnsortAction.checkActive = function() {
        this.setDisabled(!CRXB.util.getCurrent('node').ui.getEl().querySelector('div').classList.contains('sorted'));
    };
    return CRX.ide.UnsortAction;
};

CRXB.util.getUploadClipboardAction = function() {
    if (CRX.ide.UploadClipboardAction) {
        return CRX.ide.UploadClipboardAction;
    }

    CRX.ide.UploadClipboardAction = new Ext.Action({
        text: 'Install from Clipboard',
        iconCls: 'action-upload',
        handler: async (followSelectedNode) => {
            await CRXB.util.save();

            followSelectedNode = followSelectedNode === true;
            const selectedNode = CRXB.util.getCurrent('node');
            const storedNode = CRX.Clipboard.getData().data;


            const storedNodePath = CRXB.util.nodeToJcrPath(storedNode);
            const selectedNodePath = CRXB.util.nodeToJcrPath(selectedNode);
            const needsMove  = followSelectedNode
                && selectedNode
                && storedNodePath.indexOf(selectedNodePath) !== 0;

            const msg = new CrxProgressFacade('Import resource', 'Please wait');

            const processPackagerSuccess = async (status) => {
                msg.show(1, 'Finished');
                msg.hide(500);

                if (!status || !status.jcrPath) {
                    return;
                }
                CRXB.util.findNearestCommon(CRXB.util.getCurrent('node'), status.jcrPath).reload(() => {
                    CRXB.util.setLocation(status.jcrPath);
                });
            };

            const processPackagerFailure = (status) => {
                const errorMsg = typeof status === 'string'
                    ?  status
                    : `Importing of ${status.jcrPath} failed at "${status.stage}": ${status.httpStatus} ${status.message}`;
                console.error(errorMsg);
                Ext.Msg.show({
                    title: 'Error',
                    msg: errorMsg,
                    width: 420,
                    buttons: Ext.MessageBox.OK,
                    icon: Ext.MessageBox.ERROR
                });
            };

            const processPackagerPreInstall = async (status) => {
                if (!needsMove || !status.blob) {
                    return status;
                }
                const modifier = new CrxPackageModifier();
                status.blob = await modifier.modify(status.blob, selectedNodePath);
                return status;
            };

            const processPackagerStatus = (status) => msg.show(status.completion, status.stage + '... Please wait');

            const doImport = () => {
                const packager = new CrxPackager({
                    cleanUp: true,
                    success: processPackagerSuccess,
                    failure: processPackagerFailure,
                    status: processPackagerStatus,
                    preInstall: processPackagerPreInstall
                });
                packager.import(storedNode.propOrigin, storedNodePath);
            };

            Ext.Msg.show({
                title: 'Import content?',
                msg: `The node "<em>${storedNodePath}</em>" in clipboard is coming from another host (${storedNode.propOrigin}).<br><br>
                       Agree to try and import it as an AEM package?`,
                width: 420,
                icon: Ext.MessageBox.QUESTION,
                buttons: Ext.MessageBox.YESNO,
                fn: function(btn) {
                    if (btn === 'yes') {
                        doImport();
                    }
                }
            });
        }
    });

    CRX.ide.UploadClipboardAction.checkActive = function() {
        const storedNode = CRX.Clipboard.getData().data;
        const enableAction = storedNode && storedNode.propOrigin && storedNode.propOrigin !== document.location.origin;
        this.setDisabled(!enableAction);
    };

    return CRX.ide.UploadClipboardAction;
};



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
    .add('highlight-colors', ['None','Yellow','Peach','Orange','Pale Green','Green','Pink','Salmon','Lavender','Blue','Gray','Orchid','Violet','Tan',])
    .add('color-schemes', {'Blue': new CrxColorScheme({}), 'Ocean': new CrxColorScheme({"toolsBackground":"#1d9caf","toolsForeground":"#ebfffe","toolsHighlight":"#003f66","workspaceBackground":"#ffffff","workspaceShade":"#afe4e1","workspaceForeground":"#000000"}), 'Stormcloud': new CrxColorScheme({"toolsBackground":"#4977c1","toolsForeground":"#ffffff","toolsHighlight":"#2058b1","workspaceBackground":"#ffffff","workspaceShade":"#b3d0ff","workspaceForeground":"#000000"}), 'Green': new CrxColorScheme({"toolsBackground":"#6dbb5d","toolsForeground":"#ffffff","toolsHighlight":"#386b3a","workspaceBackground":"#f5fff7","workspaceShade":"#d0ecca","workspaceForeground":"#000000"}), 'Lime': new CrxColorScheme({"toolsBackground":"#88b030","toolsForeground":"#faffe5","toolsHighlight":"#426001","workspaceBackground":"#ffffff","workspaceShade":"#ddeea0","workspaceForeground":"#000000"}), 'Canary': new CrxColorScheme({"toolsBackground":"#dfc30c","toolsForeground":"#ffffff","toolsHighlight":"#c6bf01","workspaceBackground":"#ffffff","workspaceShade":"#fffdb8","workspaceForeground":"#2e0000"}), 'Peach': new CrxColorScheme({"toolsBackground":"#dc9450","toolsForeground":"#ffffff","toolsHighlight":"#813e04","workspaceBackground":"#fff9eb","workspaceShade":"#ffdec2","workspaceForeground":"#000000"}), 'Mango': new CrxColorScheme({"toolsBackground":"#deb429","toolsForeground":"#ffffff","toolsHighlight":"#744d17","workspaceBackground":"#fff7e5","workspaceShade":"#f5e5a0","workspaceForeground":"#000000"}), 'Pink': new CrxColorScheme({"toolsBackground":"#db7b7b","toolsForeground":"#ffffff","toolsHighlight":"#7c0e0e","workspaceBackground":"#ffffff","workspaceShade":"#fad3d3","workspaceForeground":"#000000"}), 'Fuchsia': new CrxColorScheme({"toolsBackground":"#b8569b","toolsForeground":"#ffffff","toolsHighlight":"#000074","workspaceBackground":"#ffffff","workspaceShade":"#d6c6f2","workspaceForeground":"#000000"}), 'Violet': new CrxColorScheme({"toolsBackground":"#a284f5","toolsForeground":"#ffffff","toolsHighlight":"#8207bb","workspaceBackground":"#ffffff","workspaceShade":"#e3c7ff","workspaceForeground":"#000000"}), 'Black and White': new CrxColorScheme({"toolsBackground":"#999999","toolsForeground":"#ffffff","toolsHighlight":"#3d3d3d","workspaceBackground":"#ffffff","workspaceShade":"#d4d4d4","workspaceForeground":"#000000"})})
    .add('favicon', 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 557 602"><path fill="%23111" d="M354 117c-13,-27 -61,-6 -74,27 -13,33 5,63 42,82 37,19 89,11 120,-42 27,-47 22,-164 -116,-183 0,0 0,0 -1,0 -180,-8 -268,124 -289,191 -6,20 -10,43 -9,68l-1 0c-15,0 -26,12 -26,26l0 240c0,15 12,26 26,26l64 0c15,0 26,-12 26,-26l0 -19c0,-15 -12,-26 -26,-26l-5 0c-15,0 -26,-12 -26,-26l0 -84c17,33 38,60 60,84 15,16 33,42 46,50l0 72c0,15 12,26 26,26l64 0c15,0 26,-12 26,-26l0 -19c0,-15 -12,-26 -26,-26l-5 0c-14,0 -26,-11 -26,-25l91 0 37 0 0 71c0,15 12,26 26,26l64 0c15,0 26,-12 26,-26l0 -19c0,-15 -12,-26 -26,-26l-5 0c-14,0 -26,-11 -26,-25l79 0c7,0 14,-5 15,-10 1,-3 0,-5 -2,-7l-33 -27 59 25c17,7 40,-20 27,-40 -12,-18 -28,-36 -41,-53 -1,-1 -1,-2 -1,-3 -4,-33 -32,-58 -66,-58 -1,0 -1,0 -2,0 -3,0 -5,-1 -6,-3 -15,-24 -56,-53 -90,-57 -22,-2 -53,11 -69,52 -1,3 -5,5 -8,4 -52,-10 -72,-109 -51,-166 14,-39 68,-83 106,-84 30,0 44,14 57,36 10,17 8,46 -14,53 -19,6 -40,-8 -35,-22 3,-10 30,-10 21,-28zm89 260c14,0 26,12 26,26 0,14 -12,26 -26,26 -14,0 -26,-12 -26,-26 0,-14 12,-26 26,-26z"/></svg>')
    .add('version', '0.1.6');

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
    .add('download', `html, body {color: \${COLOR_TOOLS_BG};background-color: \${COLOR_TOOLS_BG};padding: 0; margin: 0;position: relative;height: 100%; width: 100%;overflow: hidden;}body:after {position: absolute; display: block; content:''; top: 10%; left: 10%; width: 80%; height: 80%; z-index: 1;background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M528 288h-92.1l46.1-46.1c30.1-30.1 8.8-81.9-33.9-81.9h-64V48c0-26.5-21.5-48-48-48h-96c-26.5 0-48 21.5-48 48v112h-64c-42.6 0-64.2 51.7-33.9 81.9l46.1 46.1H48c-26.5 0-48 21.5-48 48v128c0 26.5 21.5 48 48 48h480c26.5 0 48-21.5 48-48V336c0-26.5-21.5-48-48-48zm-400-80h112V48h96v160h112L288 368 128 208zm400 256H48V336h140.1l65.9 65.9c18.8 18.8 49.1 18.7 67.9 0l65.9-65.9H528v128zm-88-64c0-13.3 10.7-24 24-24s24 10.7 24 24-10.7 24-24 24-24-10.7-24-24z"/></svg>');background-repeat: no-repeat;background-position: center;}`)
    .add(`/* ----Font---- */.x-tree-node,.x-grid3-row td, .x-grid3-summary-row td,.x-grid-empty,.ext-webkit .x-small-editor .x-form-field,.x-form-field,.x-btn button,.x-toolbar input,.x-toolbar .full-size-text,.ext-el-mask-msg div{font-size: \${FONT_SIZE};}/* --------------General layout-------------- */.x-border-layout-ct,.x-toolbar,ul.x-tab-strip-top {background-color: \${COLOR_TOOLS_BG};background-image: none;}#repository-wrapper {transform: translate(1px, -2px);}#repository-wrapper+.x-panel {transform: translate(-1px, -2px);}#properties .x-panel-tbar {transform: translateY(-3px);}/* --------Toolbars-------- */.x-toolbar, .x-panel-tbar .x-toolbar {padding: 0;}.x-toolbar.light {margin: 5px 0;}.x-toolbar .x-btn-over td,.x-toolbar .x-btn-menu-active td {background-image: none !important;background-color: \${COLOR_WORKSPACE_SHADE};transition: background-color 0.3s;}.x-toolbar .x-btn-over .x-btn-text,.x-toolbar .x-btn-menu-active .x-btn-text {color: \${COLOR_TOOLS_HIGH};}.x-toolbar .xtb-spacer {width: 16px;}.x-toolbar .x-btn-text {color: \${COLOR_TOOLS_FG};}.x-item-disabled * {color: \${COLOR_TOOLS_FG} !important;}.x-item-disabled>input {color: gray !important;}.x-toolbar.light .x-item-disabled {opacity: .2;}.x-btn-text-icon .x-btn-icon-small-left .x-btn-text {background-position: 4px center;padding-left: 24px;margin-right: 2px;text-transform: uppercase;}.x-toolbar .x-btn-mc em.x-btn-split {background-size: 11px;padding-right: 8px;}.x-toolbar div.xtb-text {padding: 2px;}#toolbar .x-btn-text {display: block;min-width: 40px;height: 38px;padding: 24px 0 2px 0;overflow: hidden;font-size: 11px;text-transform: uppercase;white-space: normal;background-position: top 3px center;background-repeat: no-repeat;background-size: 20px 20px;}#loginbutton .x-btn-text {padding: 0;word-break: break-all;text-align: left;}#loginbutton .x-btn-mc em.x-btn-split {padding-right: 16px;}#tools-wrapper .x-panel-bwrap,#tools-wrapper .x-panel-body,#tools-wrapper .x-panel-tbar,#custom-properties-toolbar {overflow: visible;}#custom-properties-toolbar .x-btn {box-shadow: 0px -2px 0px 0px \${COLOR_TOOLS_BG};padding: 0 0 3px 0;}#custom-properties-toolbar .x-btn.x-btn-over {background-color: \${COLOR_WORKSPACE_SHADE};box-shadow: 0px -2px 0px 0px \${COLOR_WORKSPACE_SHADE};}#properties .x-btn-text {font-size: 11px;transform: translateY(1px);}#addressbar .x-panel-body {background-color: \${COLOR_TOOLS_BG};}#addressbar .x-btn {height: 100%;}#addressbar .x-btn-mc em {padding: 0 3px;}#addressbar .x-btn-mc em.x-btn-split,#addressbar.x-btn-over .x-btn-mc em.x-btn-split {background-image: none !important;}#addressbar .x-btn:last-child em {padding-left: 1px;}#environment {display: block;height: 100%;line-height: 32px;padding: 0 3px 0 6px;background-color: \${COLOR_WORKSPACE_BG};color: \${COLOR_TOOLS_BG};text-transform: uppercase;}/* -----Menus----- */.x-menu {background-color: \${COLOR_TOOLS_BG};background-image: none !important;}.x-menu-detached {z-index: 20001 !important;}.x-menu-list {padding: 0;}.x-menu-list-item {font-size: 11px;text-transform: uppercase;margin: 0;padding: 1px 3px;}.x-menu.light,.invert-menu-bg .x-menu {background-color: \${COLOR_WORKSPACE_SHADE};}.x-menu.bookmarks img {transform: translateY(-1px);}.x-menu.bookmarks:not(.x-menu-detached) .x-menu-list-item {text-transform: none;font-size: \${FONT_SIZE};}.x-menu a.x-menu-item {color: \${COLOR_TOOLS_FG};}.x-menu.light a.x-menu-item,.invert-menu-bg .x-menu a.x-menu-item {color: \${COLOR_WORKSPACE_FG};}.x-menu.light .x-item-disabled *,.invert-menu-bg .x-menu .x-item-disabled * {color: \${COLOR_TOOLS_BG} !important;}.x-menu-item-active {margin: 0;padding: 1px 4px;}.x-menu-item-active,.x-menu-item-active a.x-menu-item {border: none;background-image: none;background-color: \${COLOR_WORKSPACE_SHADE};color: \${COLOR_TOOLS_HIGH};transition: background-color 0.3s;}.x-menu.light .x-menu-item-active,.x-menu.light .x-menu-item-active a.x-menu-item,.invert-menu-bg .x-menu .x-menu-item-active,.invert-menu-bg .x-menu .x-menu-item-active a.x-menu-item {background-color: \${COLOR_WORKSPACE_BG};color: \${COLOR_TOOLS_HIGH};}.x-menu-item-icon {background-repeat: no-repeat;}.x-menu.bookmarks.light .x-menu-item-icon,.invert-menu-bg .x-menu.bookmarks .x-menu-item-icon {border: 1px Solid \${COLOR_WORKSPACE_BG};}.x-menu .x-menu-sep {background-color: \${COLOR_WORKSPACE_SHADE};opacity: .5;}.x-menu.light .x-menu-sep,.invert-menu-bg .x-menu .x-menu-sep {background-color: \${COLOR_TOOLS_BG};}.x-menu-item-arrow {background-size: 6px;background-position: top 3px right 3px;}.x-menu-sep-li+.x-menu-sep-li,.hide-disabled .x-menu-list-item.x-item-disabled,.hide-disabled .x-menu-sep-li+.x-item-disabled+.x-menu-sep-li,.hide-disabled .x-menu-sep-li+.x-item-disabled+.x-item-disabled+.x-menu-sep-li {display: none;}.x-menu .x-menu-scroller {height: 9px;line-height: 9px;background-repeat: no-repeat;background-size: 10px;background-position: center;}.x-menu-scroller.x-menu-item-active {background-color: transparent !important;}/* ----Tabs---- */.x-tab-strip-top .x-tab-right,.x-tab-strip-top .x-tab-left,.x-tab-strip-top .x-tab-strip-inner {background-image: none;}ul.x-tab-strip li {background-color: \${COLOR_WORKSPACE_SHADE};border-radius: 3px 3px 0 0;margin: 0 2px 0 0;transform: translateY(-1px);box-shadow: 0 1px 0 0 \${COLOR_WORKSPACE_SHADE};font-size: 11px;font-weight: normal;}#repository-wrapper ul.x-tab-strip li:first-child {margin-left: 2px;}ul.x-tab-strip li.x-tab-strip-active {background-color: \${COLOR_WORKSPACE_BG};box-shadow: 0 1px 0 0 \${COLOR_WORKSPACE_BG};}.x-tab-panel-header, .x-tab-panel-footer {background-color: \${COLOR_WORKSPACE_BG};}.x-tab-strip span.x-tab-strip-text,.x-tab-strip-active span.x-tab-strip-text {font-weight: normal;color: \${COLOR_TOOLS_HIGH};}/*.x-tab-panel-header {padding: 0;}.x-tab-panel-body {padding: 3px 0 0 3px;}*/.x-tab-strip span.x-tab-strip-text {padding: 4px 10px 3px 10px;}.x-tab-strip-top .x-tab-strip-active .x-tab-right span.x-tab-strip-text {padding-bottom: 4px;}/* ------------Tools panels------------ */#tools-wrapper .x-panel-header,#repository .x-panel-header {display: none;}.x-panel-bbar,.x-panel-bbar .x-toolbar {background-color: \${COLOR_WORKSPACE_SHADE};}/* ---------------Repository tree--------------- */.x-tree-node a span,.x-tree-node-anchor span {margin-left: 1px;padding: 1px 4px 1px 2px;border-radius: 3px;}.x-tree-node-el.drag>.x-tree-node-anchor:after,.x-tree-node-el.sorted>.x-tree-node-anchor:after {display: inline-block;content: '';width: 1em; height: 1em;transform: translate(0, 2px);}#repository .x-form-field-wrap .x-form-twin-triggers .x-form-trigger {transform: translate(2px, 5px);}#repository>.x-panel-bwrap>.x-panel-body {overflow: hidden auto !important;}/* ----------Home panel---------- */.homepanel .x-panel-body {background-size: 300px;padding: 64px 0 10px 20px;transition: background-position 700ms, background-size 700ms;}.homepanel .x-panel-body.loaded {background-position: top 20px left 20px;background-size: 150px;}.homepanel #navmenu>.logoutButton {display: none;}.homepanel #navmenu {font-size: \${FONT_SIZE};line-height: 20px;height: 100%;overflow-y: scroll;overflow-x: hidden;}.homepanel #navmenu>li {display: table-row;}.homepanel #navmenu>li>a {display: table-cell;white-space: nowrap;padding-right: 20px;width: 60px;color: \${COLOR_TOOLS_BG};font-weight: bold;}.homepanel #navmenu>li>ul {display: table-cell;padding-bottom: 10px;}.homepanel #navmenu>li>ul>li {display: inline-block;margin-right: 5px;}.homepanel #navmenu a {text-decoration: none;}.homepanel #navmenu>li>ul>li a {color: \${COLOR_WORKSPACE_FG};padding: 1px 2px;}.homepanel #navmenu>li>ul>li a:hover {color: \${COLOR_TOOLS_HIGH};background-color: \${COLOR_WORKSPACE_SHADE};border-radius: 3px;transition: background-color 0.3s;}.homepanel #navmenu .logLink {text-transform: capitalize;}.homepanel #navmenu .logLink em {color: \${COLOR_TOOLS_HIGH};}#crxb-version {position: absolute;top: 10px;right: 20px;color: \${COLOR_WORKSPACE_SHADE};font-weight: bold;font-size: .9em;}/* ----------------Properties panel---------------- */.x-tree-node .x-tree-selected,.x-grid3-row-selected,.x-grid3-cell-selected {background-color: \${COLOR_WORKSPACE_SHADE} !important;}/* ------------Search panel------------ */#repository-wrapper .x-toolbar .full-size-text {color: \${COLOR_TOOLS_HIGH};}#repository-wrapper .x-toolbar .full-size-text em {cursor: pointer;}#search-results .x-grid3-row {border: none;}#search-results .x-grid3-cell-inner {padding: 2px 3px 3px 3px;}#search-results .x-grid3-header {display: none;}#search-results span.x-tree-node-icon {display: inline-block;width: 16px;margin-right: 5px;background-position: center;background-repeat: no-repeat;}/* --------------Dialog windows------------- */.x-tab-panel .x-panel-tbar .x-toolbar,.x-window .x-toolbar,.x-window .x-toolbar .x-btn {background-color: \${COLOR_WORKSPACE_BG};}.x-tab-panel .x-toolbar button,.x-window .x-toolbar .x-btn button {color: \${COLOR_TOOLS_HIGH};padding: 5px;box-sizing: content-box;background-size: 16px;}.x-window .x-panel-tbar,.x-tab-panel .x-panel-tbar,#editors .x-panel-bbar {margin-top: 2px;}.x-window .x-toolbar .xtb-sep {display: none;}.x-window-body.x-border-layout-ct {background-color: \${COLOR_WORKSPACE_BG};}.x-window-tl .x-window-header {color: \${COLOR_TOOLS_FG};line-height: 26px;padding: 0 0 0 4px;text-transform: uppercase;font-weight: normal;}.x-window-tr, .x-window-tc, .x-window-tl {background-image: none;height: 26px;background-color: \${COLOR_TOOLS_BG};}.x-window-mr, .x-window-mc, .x-window-ml {background-image: none;background-color: \${COLOR_WORKSPACE_BG} !important;}.x-window-br, .x-window-bc, .x-window-bl {background-image: none;background-color: \${COLOR_WORKSPACE_BG};}.x-window-dlg .x-window-body {padding: 20px 10px 10px 10px;}.x-window-footer {padding-top: 10px;}.x-window .x-btn {background-color: \${COLOR_TOOLS_BG};padding: 2px 4px 4px 4px;}.x-window .x-toolbar .x-btn {padding: 0;}.x-window .x-btn td {background-image: none !important;}.x-window .x-btn button {color: \${COLOR_TOOLS_FG};}.x-window .x-btn.x-btn-over button {color: \${COLOR_TOOLS_HIGH};}.x-window .x-btn.x-btn-over {background-color: \${COLOR_WORKSPACE_SHADE};}.x-window-header .x-tool-close {margin-top: 5px;}.x-window-dlg em {font-weight: normal;color: \${COLOR_TOOLS_HIGH};}.x-window .dialog-section {display:block;margin: 16px 0;font-weight: bold;color: \${COLOR_TOOLS_BG};}.x-window .dialog-section:first-child {margin-top: 0;}/* ------Inputs------ */#repository-path,#repository .x-form-text {padding: 3px 5px;border-radius: 0;background-image: none;}input[type="color"] {border: none;background-image: none;}.x-form-file+table tr:nth-child(1),.x-form-file+table tr:nth-child(3) {display: none;}.x-window-body>.x-panel.multifield:first-child {margin: 10px;}.x-panel.multifield .x-panel-body {padding: 0 0 5px 0 !important;}.x-panel.multifield .x-box-inner {width: auto !important;}.x-panel.multifield .x-btn.x-box-item {min-width: 40px;}.x-panel.multifield .x-btn.x-box-item tr:nth-child(1),.x-panel.multifield .x-btn.x-box-item tr:nth-child(3) {display: none;}.x-panel,.x-tab-panel-header,.x-tab-panel-footer,.x-panel-body,.x-tab-panel-body,ul.x-tab-strip-top,.x-panel-noborder .x-panel-tbar-noborder .x-toolbar,.x-panel-noborder .x-panel-bbar-noborder .x-toolbar,.x-trigger-wrap-focus .x-form-trigger,.x-window-mc,.x-window .x-toolbar,.x-menu,.x-menu-sep,#repository-path,#repository .x-form-text{border: none;}/* --------Progress-------- */.x-progress-wrap {border: none;}.x-progress-inner {background: \${COLOR_WORKSPACE_SHADE};}.x-progress-bar {background: \${COLOR_TOOLS_BG};border: none;}.x-progress-text {color: \${COLOR_TOOLS_FG};}/* --------Tooltips-------- */.x-tip, .x-tip div {background-image: none !important;background-color: \${COLOR_WORKSPACE_SHADE} !important;}.invert-menu-bg .x-tip, .invert-menu-bg .x-tip div {background-color: \${COLOR_WORKSPACE_BG} !important;}.x-tip .x-tip-body {font-size: \${FONT_SIZE};padding: 10px;word-break: break-word;}/* -----Masks----- */.ext-el-mask-msg,.x-mask-loading div,.ext-el-mask-msg div {border: none;background-color: \${COLOR_TOOLS_BG};color: \${COLOR_TOOLS_FG};}.x-mask-loading div {padding: 5px 10px 5px 38px;}.ext-el-mask-msg {background-image: none;padding: 7px;}.ext-el-mask {background-color: \${COLOR_WORKSPACE_SHADE};opacity: .7;}/* -------Shadows------- */.x-shadow {display: none !important;}.x-window {box-shadow: 0 0 4px 0 rgba(0, 0, 0, 0.5);}.x-menu-detached {box-shadow: 0 0 2px 0 rgba(0, 0, 0, 0.5);}/* ----------Scrollbars---------- */* {scrollbar-width: auto;scrollbar-color: \${COLOR_WORKSPACE_SHADE} \${COLOR_WORKSPACE_BG};}*::-webkit-scrollbar {width: 10px;height: 10px;}*::-webkit-scrollbar-track {background: \${COLOR_WORKSPACE_BG};}*::-webkit-scrollbar-thumb {background-color: \${COLOR_WORKSPACE_SHADE};border-radius: 2px;}`)
    .add(`/* ----------Tree icons---------- */.x-tree-lines .x-tree-elbow,.x-tree-lines .x-tree-elbow-line {background-image: none;}.x-tree-lines .x-tree-elbow-plus,.x-tree-lines .x-tree-elbow-end-plus {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" shape-rendering="crispEdges" d="M352 240v32c0 6.6-5.4 12-12 12h-88v88c0 6.6-5.4 12-12 12h-32c-6.6 0-12-5.4-12-12v-88h-88c-6.6 0-12-5.4-12-12v-32c0-6.6 5.4-12 12-12h88v-88c0-6.6 5.4-12 12-12h32c6.6 0 12 5.4 12 12v88h88c6.6 0 12 5.4 12 12zm96-160v352c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V80c0-26.5 21.5-48 48-48h352c26.5 0 48 21.5 48 48zm-48 346V86c0-3.3-2.7-6-6-6H54c-3.3 0-6 2.7-6 6v340c0 3.3 2.7 6 6 6h340c3.3 0 6-2.7 6-6z"></path></svg>');}.x-tree-lines .x-tree-elbow-minus,.x-tree-lines .x-tree-elbow-end-minus {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" shape-rendering="crispEdges" d="M108 284c-6.6 0-12-5.4-12-12v-32c0-6.6 5.4-12 12-12h232c6.6 0 12 5.4 12 12v32c0 6.6-5.4 12-12 12H108zM448 80v352c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V80c0-26.5 21.5-48 48-48h352c26.5 0 48 21.5 48 48zm-48 346V86c0-3.3-2.7-6-6-6H54c-3.3 0-6 2.7-6 6v340c0 3.3 2.7 6 6 6h340c3.3 0 6-2.7 6-6z"></path></svg>');}.x-tree-node-icon.folder,.x-tree-root-ct>.x-tree-node>.x-tree-node-el .x-tree-node-icon.unstructured {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M464 128H272l-64-64H48C21.49 64 0 85.49 0 112v288c0 26.51 21.49 48 48 48h416c26.51 0 48-21.49 48-48V176c0-26.51-21.49-48-48-48z"></path></svg>');background-size: 16px;}.x-tree-elbow-end-minus+.x-tree-node-icon.folder,.x-tree-elbow-minus+.x-tree-node-icon.folder,.x-tree-root-ct>.x-tree-node>.x-tree-node-el .x-tree-elbow-minus+.x-tree-node-icon.unstructured,.x-tree-root-ct>.x-tree-node>.x-tree-node-el .x-tree-elbow-end-minus+.x-tree-node-icon.unstructured {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M572.694 292.093L500.27 416.248A63.997 63.997 0 0 1 444.989 448H45.025c-18.523 0-30.064-20.093-20.731-36.093l72.424-124.155A64 64 0 0 1 152 256h399.964c18.523 0 30.064 20.093 20.73 36.093zM152 224h328v-48c0-26.51-21.49-48-48-48H272l-64-64H48C21.49 64 0 85.49 0 112v278.046l69.077-118.418C86.214 242.25 117.989 224 152 224z"></path></svg>');}.x-tree-node-icon.unstructured {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M488.6 250.2L392 214V105.5c0-15-9.3-28.4-23.4-33.7l-100-37.5c-8.1-3.1-17.1-3.1-25.3 0l-100 37.5c-14.1 5.3-23.4 18.7-23.4 33.7V214l-96.6 36.2C9.3 255.5 0 268.9 0 283.9V394c0 13.6 7.7 26.1 19.9 32.2l100 50c10.1 5.1 22.1 5.1 32.2 0l103.9-52 103.9 52c10.1 5.1 22.1 5.1 32.2 0l100-50c12.2-6.1 19.9-18.6 19.9-32.2V283.9c0-15-9.3-28.4-23.4-33.7zM358 214.8l-85 31.9v-68.2l85-37v73.3zM154 104.1l102-38.2 102 38.2v.6l-102 41.4-102-41.4v-.6zm84 291.1l-85 42.5v-79.1l85-38.8v75.4zm0-112l-102 41.4-102-41.4v-.6l102-38.2 102 38.2v.6zm240 112l-85 42.5v-79.1l85-38.8v75.4zm0-112l-102 41.4-102-41.4v-.6l102-38.2 102 38.2v.6z"></path></svg>');background-size: 15px;}.x-tree-node-icon.page {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" shape-rendering="crispEdges" d="M224 136V0H24C10.7 0 0 10.7 0 24v464c0 13.3 10.7 24 24 24h336c13.3 0 24-10.7 24-24V160H248c-13.2 0-24-10.8-24-24zm64 236c0 6.6-5.4 12-12 12H108c-6.6 0-12-5.4-12-12v-8c0-6.6 5.4-12 12-12h168c6.6 0 12 5.4 12 12v8zm0-64c0 6.6-5.4 12-12 12H108c-6.6 0-12-5.4-12-12v-8c0-6.6 5.4-12 12-12h168c6.6 0 12 5.4 12 12v8zm0-72v8c0 6.6-5.4 12-12 12H108c-6.6 0-12-5.4-12-12v-8c0-6.6 5.4-12 12-12h168c6.6 0 12 5.4 12 12zm96-114.1v6.1H256V0h6.1c6.4 0 12.5 2.5 17 7l97.9 98c4.5 4.5 7 10.6 7 16.9z"></path></svg>');opacity: .7;background-size: 12px;}.x-tree-node-icon.file {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" shape-rendering="crispEdges" d="M224 136V0H24C10.7 0 0 10.7 0 24v464c0 13.3 10.7 24 24 24h336c13.3 0 24-10.7 24-24V160H248c-13.2 0-24-10.8-24-24zm160-14.1v6.1H256V0h6.1c6.4 0 12.5 2.5 17 7l97.9 98c4.5 4.5 7 10.6 7 16.9z"></path></svg>');opacity: .7;background-size: 12px;}.x-tree-node-icon.dialog {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" shape-rendering="crispEdges" d="M464 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h416c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zm0 394c0 3.3-2.7 6-6 6H54c-3.3 0-6-2.7-6-6V192h416v234z"></path></svg>');opacity: .7;background-size: 13px;}.x-tree-lines .x-tree-elbow-plus,.x-tree-lines .x-tree-elbow-end-plus,.x-tree-lines .x-tree-elbow-minus,.x-tree-lines .x-tree-elbow-end-minus {background-size: 11px;background-position: center;transform: translateX(-2px);}/* --------------Window buttons-------------- */.x-form-field-wrap .x-form-clear-trigger,.x-tool.x-tool-close {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 352 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M242.72 256l100.07-100.07c12.28-12.28 12.28-32.19 0-44.48l-22.24-22.24c-12.28-12.28-32.19-12.28-44.48 0L176 189.28 75.93 89.21c-12.28-12.28-32.19-12.28-44.48 0L9.21 111.45c-12.28 12.28-12.28 32.19 0 44.48L109.28 256 9.21 356.07c-12.28 12.28-12.28 32.19 0 44.48l22.24 22.24c12.28 12.28 32.2 12.28 44.48 0L176 322.72l100.07 100.07c12.28 12.28 32.2 12.28 44.48 0l22.24-22.24c12.28-12.28 12.28-32.19 0-44.48L242.72 256z"></path></svg>');background-position: 0 0;background-size: 12px;}.x-tool.x-tool-close.x-tool-close-over {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 352 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M242.72 256l100.07-100.07c12.28-12.28 12.28-32.19 0-44.48l-22.24-22.24c-12.28-12.28-32.19-12.28-44.48 0L176 189.28 75.93 89.21c-12.28-12.28-32.19-12.28-44.48 0L9.21 111.45c-12.28 12.28-12.28 32.19 0 44.48L109.28 256 9.21 356.07c-12.28 12.28-12.28 32.19 0 44.48l22.24 22.24c12.28 12.28 32.2 12.28 44.48 0L176 322.72l100.07 100.07c12.28 12.28 32.2 12.28 44.48 0l22.24-22.24c12.28-12.28 12.28-32.19 0-44.48L242.72 256z"></path></svg>');}/* ------------Window icons------------ */.x-window-dlg .ext-mb-question {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M504 256c0 136.997-111.043 248-248 248S8 392.997 8 256C8 119.083 119.043 8 256 8s248 111.083 248 248zM262.655 90c-54.497 0-89.255 22.957-116.549 63.758-3.536 5.286-2.353 12.415 2.715 16.258l34.699 26.31c5.205 3.947 12.621 3.008 16.665-2.122 17.864-22.658 30.113-35.797 57.303-35.797 20.429 0 45.698 13.148 45.698 32.958 0 14.976-12.363 22.667-32.534 33.976C247.128 238.528 216 254.941 216 296v4c0 6.627 5.373 12 12 12h56c6.627 0 12-5.373 12-12v-1.333c0-28.462 83.186-29.647 83.186-106.667 0-58.002-60.165-102-116.531-102zM256 338c-25.365 0-46 20.635-46 46 0 25.364 20.635 46 46 46s46-20.636 46-46c0-25.365-20.635-46-46-46z"></path></svg>');}.x-form-invalid-icon,.x-window-dlg .ext-mb-error {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23E57C7C" d="M256 8C119 8 8 119 8 256s111 248 248 248 248-111 248-248S393 8 256 8zm121.6 313.1c4.7 4.7 4.7 12.3 0 17L338 377.6c-4.7 4.7-12.3 4.7-17 0L256 312l-65.1 65.6c-4.7 4.7-12.3 4.7-17 0L134.4 338c-4.7-4.7-4.7-12.3 0-17l65.6-65-65.6-65.1c-4.7-4.7-4.7-12.3 0-17l39.6-39.6c4.7-4.7 12.3-4.7 17 0l65 65.7 65.1-65.6c4.7-4.7 12.3-4.7 17 0l39.6 39.6c4.7 4.7 4.7 12.3 0 17L312 256l65.6 65.1z"></path></svg>');}.x-window-dlg .ext-mb-info {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M256 8C119.043 8 8 119.083 8 256c0 136.997 111.043 248 248 248s248-111.003 248-248C504 119.083 392.957 8 256 8zm0 110c23.196 0 42 18.804 42 42s-18.804 42-42 42-42-18.804-42-42 18.804-42 42-42zm56 254c0 6.627-5.373 12-12 12h-88c-6.627 0-12-5.373-12-12v-24c0-6.627 5.373-12 12-12h12v-64h-12c-6.627 0-12-5.373-12-12v-24c0-6.627 5.373-12 12-12h64c6.627 0 12 5.373 12 12v100h12c6.627 0 12 5.373 12 12v24z"></path></svg>');}/* -----------Menu arrows----------- */.x-toolbar .x-btn-mc em.x-btn-split,.x-menu .x-menu-scroller-bottom {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M31.3 192h257.3c17.8 0 26.7 21.5 14.1 34.1L174.1 354.8c-7.8 7.8-20.5 7.8-28.3 0L17.2 226.1C4.6 213.5 13.5 192 31.3 192z"></path></svg>') !important;background-repeat: no-repeat;}.x-toolbar .x-btn-over .x-btn-mc em.x-btn-split,.x-toolbar .x-btn-menu-active .x-btn-mc em.x-btn-split,.x-menu.light .x-menu-scroller-bottom {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 404.308 404.309"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M0,101.08h404.308L202.151,303.229L0,101.08z"/></svg>') !important;}.x-menu .x-menu-scroller-top {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M288.662 352H31.338c-17.818 0-26.741-21.543-14.142-34.142l128.662-128.662c7.81-7.81 20.474-7.81 28.284 0l128.662 128.662c12.6 12.599 3.676 34.142-14.142 34.142z"></path></svg>');background-repeat: no-repeat;}.x-menu.light .x-menu-scroller-top {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M288.662 352H31.338c-17.818 0-26.741-21.543-14.142-34.142l128.662-128.662c7.81-7.81 20.474-7.81 28.284 0l128.662 128.662c12.6 12.599 3.676 34.142-14.142 34.142z"></path></svg>');}.x-menu-item-arrow {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M0 384.662V127.338c0-17.818 21.543-26.741 34.142-14.142l128.662 128.662c7.81 7.81 7.81 20.474 0 28.284L34.142 398.804C21.543 411.404 0 402.48 0 384.662z"></path></svg>');}.x-menu.light .x-menu-item-arrow,.invert-menu-bg .x-menu .x-menu-item-arrow,.x-menu-item-active a.x-menu-item-arrow {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M0 384.662V127.338c0-17.818 21.543-26.741 34.142-14.142l128.662 128.662c7.81 7.81 7.81 20.474 0 28.284L34.142 398.804C21.543 411.404 0 402.48 0 384.662z"></path></svg>');}.x-menu.light .x-menu-item-active a.x-menu-item-arrow {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M0 384.662V127.338c0-17.818 21.543-26.741 34.142-14.142l128.662 128.662c7.81 7.81 7.81 20.474 0 28.284L34.142 398.804C21.543 411.404 0 402.48 0 384.662z"></path></svg>');}/* Loading spinner */.x-mask-loading div {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><g><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M10.625,64a5.375,5.375 0 1,0 10.75,0a5.375,5.375 0 1,0 -10.75,0M9.562,64a6.438,6.438 0 1,0 12.876,0a6.438,6.438 0 1,0 -12.876,0" transform="rotate(45 64 64)"/><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M7.937,64a8.063,8.063 0 1,0 16.126,0a8.063,8.063 0 1,0 -16.126,0" transform="rotate(90 64 64)"/><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M5.937,64a10.063,10.063 0 1,0 20.126,0a10.063,10.063 0 1,0 -20.126,0" transform="rotate(135 64 64)"/><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M5.25,64a10.75,10.75 0 1,0 21.5,0a10.75,10.75 0 1,0 -21.5,0" transform="rotate(180 64 64)"/><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M3.469,64a12.531,12.531 0 1,0 25.062,0a12.531,12.531 0 1,0 -25.062,0" transform="rotate(225 64 64)"/><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M1.656,64a14.344,14.344 0 1,0 28.688,0a14.344,14.344 0 1,0 -28.688,0" transform="rotate(270 64 64)"/><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M0,64a16,16 0 1,0 32,0a16,16 0 1,0 -32,0" transform="rotate(315 64 64)"/><animateTransform attributeName="transform" type="rotate" values="0 64 64;45 64 64;90 64 64;135 64 64;180 64 64;225 64 64;270 64 64;315 64 64" calcMode="discrete" dur="700ms" repeatCount="indefinite"></animateTransform></g></svg>');background-size: 24px 24px;background-position-y: center;}`)
    .add('splash', `html, body {height: 100%;position: relative;margin: 0;background-color: \${COLOR_WORKSPACE_BG};}#loading {position: absolute;top: 50%;left: 50%;transform: translate(-50%, -50%);width: 400px;height: 100px;}#loading,.homepanel .x-panel-body {background: no-repeat center url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4941 899"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M2522 0l180 229 180 -229 311 0 -343 409 392 474 -311 0 -229 -278 -229 278 -637 0 -245 -311 -212 0 0 311 -262 0 0 -883 637 0c164,0 327,114 327,278 0,131 -82,213 -196,262l262 343 392 -458 -357 -425 341 0zm1314 205c-17,-34 -76,-8 -92,33 -16,41 6,79 52,102 46,23 111,13 149,-53 33,-58 27,-203 -144,-227 0,0 -1,0 -1,0 -224,-9 -333,154 -359,236 -8,25 -13,53 -12,84l-1 0c-18,0 -33,15 -33,33l0 298c0,18 15,33 33,33l79 0c18,0 33,-15 33,-33l0 -24c0,-18 -15,-33 -33,-33l-7 0c-18,0 -33,-15 -33,-33l0 -104c21,41 47,75 75,104 18,19 41,51 57,62l0 90c0,18 15,33 33,33l79 0c18,0 33,-15 33,-33l0 -24c0,-18 -15,-33 -33,-33l-7 0c-18,0 -32,-14 -33,-32l113 0 46 0 0 88c0,18 15,33 33,33l79 0c18,0 33,-15 33,-33l0 -24c0,-18 -15,-33 -33,-33l-7 0c-18,0 -32,-14 -33,-32l98 0c8,0 17,-6 19,-12 1,-3 0,-7 -3,-9l-40 -33 73 31c21,9 50,-25 33,-49 -15,-22 -34,-45 -51,-66 -1,-1 -2,-3 -2,-4 -5,-40 -39,-72 -81,-72 -1,0 -1,0 -2,0 -3,0 -6,-1 -8,-4 -18,-29 -69,-66 -112,-70 -28,-3 -66,13 -86,65 -2,4 -6,6 -10,5 -65,-13 -89,-135 -64,-206 17,-49 85,-103 131,-104 37,-1 55,18 71,44 13,21 10,57 -17,65 -24,8 -50,-9 -44,-27 4,-13 38,-13 26,-35zm111 323c18,0 32,15 32,32 0,18 -15,32 -32,32 -18,0 -32,-15 -32,-32 0,-18 14,-32 32,-32zm-3946 -85c-9,307 208,441 506,441 264,0 471,-105 542,-290l-304 0c-50,58 -128,94 -217,93 -196,0 -251,-139 -250,-247 1,-107 57,-264 249,-269 94,-2 195,59 245,117l275 0c-66,-186 -257,-288 -539,-288 -298,0 -498,134 -506,442zm1378 -83l294 0c49,0 131,-16 131,-82 0,-65 -82,-82 -131,-82l-294 0 0 163zm1962 -360l375 0c278,0 458,131 458,458 0,278 -180,441 -458,441l-376 0 1 -899zm898 0l670 0 0 98 -539 0 0 275 409 0 0 98 -409 0 0 313 572 0 0 98 -703 0 0 -883z"/></svg>');}#loading:after {display: inline-block;content: '';background: no-repeat center url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 16"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" fill-opacity=".42" d="M6.4 4.8A3.2 3.2 0 113.2 8a3.2 3.2 0 013.2-3.2zm12.8 0A3.2 3.2 0 1116 8a3.2 3.2 0 013.2-3.2zm12.8 0A3.2 3.2 0 1128.8 8 3.2 3.2 0 0132 4.8zm12.8 0A3.2 3.2 0 1141.6 8a3.2 3.2 0 013.2-3.2zm12.8 0A3.2 3.2 0 1154.4 8a3.2 3.2 0 013.2-3.2zm12.8 0A3.2 3.2 0 1167.2 8a3.2 3.2 0 013.2-3.2zm12.8 0A3.2 3.2 0 1180 8a3.2 3.2 0 013.2-3.2zm12.8 0A3.2 3.2 0 1192.8 8 3.2 3.2 0 0196 4.8zm12.8 0a3.2 3.2 0 11-3.2 3.2 3.2 3.2 0 013.2-3.2zm12.8 0a3.2 3.2 0 11-3.2 3.2 3.2 3.2 0 013.2-3.2z"/><g><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M-42.7 3.84A4.16 4.16 0 01-38.54 8a4.16 4.16 0 01-4.16 4.16A4.16 4.16 0 01-46.86 8a4.16 4.16 0 014.16-4.16zm12.8-.64A4.8 4.8 0 01-25.1 8a4.8 4.8 0 01-4.8 4.8A4.8 4.8 0 01-34.7 8a4.8 4.8 0 014.8-4.8zm12.8-.64A5.44 5.44 0 01-11.66 8a5.44 5.44 0 01-5.44 5.44A5.44 5.44 0 01-22.54 8a5.44 5.44 0 015.44-5.44z"/><animateTransform attributeName="transform" type="translate" values="23 0;36 0;49 0;62 0;74.5 0;87.5 0;100 0;113 0;125.5 0;138.5 0;151.5 0;164.5 0;178 0" calcMode="discrete" dur="1690ms" repeatCount="indefinite"/></g></svg>');width: 400px;height: 24px;transform: translate(0, 97px);}#history-form,#load-indicator {display: none;}`)
    .add(`.x-btn-text.action-access, .x-menu-item .action-access {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M512 176.001C512 273.203 433.202 352 336 352c-11.22 0-22.19-1.062-32.827-3.069l-24.012 27.014A23.999 23.999 0 01261.223 384H224v40c0 13.255-10.745 24-24 24h-40v40c0 13.255-10.745 24-24 24H24c-13.255 0-24-10.745-24-24v-78.059c0-6.365 2.529-12.47 7.029-16.971l161.802-161.802C163.108 213.814 160 195.271 160 176 160 78.798 238.797.001 335.999 0 433.488-.001 512 78.511 512 176.001zM336 128c0 26.51 21.49 48 48 48s48-21.49 48-48-21.49-48-48-48-48 21.49-48 48z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-access, .x-window .x-toolbar .x-btn-text.action-access, .x-menu.light .x-menu-item-icon.action-access, .invert-menu-bg .x-menu-item-icon.action-access {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M512 176.001C512 273.203 433.202 352 336 352c-11.22 0-22.19-1.062-32.827-3.069l-24.012 27.014A23.999 23.999 0 01261.223 384H224v40c0 13.255-10.745 24-24 24h-40v40c0 13.255-10.745 24-24 24H24c-13.255 0-24-10.745-24-24v-78.059c0-6.365 2.529-12.47 7.029-16.971l161.802-161.802C163.108 213.814 160 195.271 160 176 160 78.798 238.797.001 335.999 0 433.488-.001 512 78.511 512 176.001zM336 128c0 26.51 21.49 48 48 48s48-21.49 48-48-21.49-48-48-48-48 21.49-48 48z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-access, .x-toolbar .x-btn-menu-active .x-btn-text.action-access, .x-menu-item-active .x-menu-item-icon.action-access, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-access {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M512 176.001C512 273.203 433.202 352 336 352c-11.22 0-22.19-1.062-32.827-3.069l-24.012 27.014A23.999 23.999 0 01261.223 384H224v40c0 13.255-10.745 24-24 24h-40v40c0 13.255-10.745 24-24 24H24c-13.255 0-24-10.745-24-24v-78.059c0-6.365 2.529-12.47 7.029-16.971l161.802-161.802C163.108 213.814 160 195.271 160 176 160 78.798 238.797.001 335.999 0 433.488-.001 512 78.511 512 176.001zM336 128c0 26.51 21.49 48 48 48s48-21.49 48-48-21.49-48-48-48-48 21.49-48 48z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-add, .x-menu-item .action-add {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zm-32 252c0 6.6-5.4 12-12 12h-92v92c0 6.6-5.4 12-12 12h-56c-6.6 0-12-5.4-12-12v-92H92c-6.6 0-12-5.4-12-12v-56c0-6.6 5.4-12 12-12h92v-92c0-6.6 5.4-12 12-12h56c6.6 0 12 5.4 12 12v92h92c6.6 0 12 5.4 12 12v56z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-create, .x-menu-item .action-create {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zm-32 252c0 6.6-5.4 12-12 12h-92v92c0 6.6-5.4 12-12 12h-56c-6.6 0-12-5.4-12-12v-92H92c-6.6 0-12-5.4-12-12v-56c0-6.6 5.4-12 12-12h92v-92c0-6.6 5.4-12 12-12h56c6.6 0 12 5.4 12 12v92h92c6.6 0 12 5.4 12 12v56z"/></svg>')!important;}`)
    .add(`.x-btn-text.register, .x-menu-item .register {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zm-32 252c0 6.6-5.4 12-12 12h-92v92c0 6.6-5.4 12-12 12h-56c-6.6 0-12-5.4-12-12v-92H92c-6.6 0-12-5.4-12-12v-56c0-6.6 5.4-12 12-12h92v-92c0-6.6 5.4-12 12-12h56c6.6 0 12 5.4 12 12v92h92c6.6 0 12 5.4 12 12v56z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-add, .x-window .x-toolbar .x-btn-text.action-add, .x-menu.light .x-menu-item-icon.action-add, .invert-menu-bg .x-menu-item-icon.action-add {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zm-32 252c0 6.6-5.4 12-12 12h-92v92c0 6.6-5.4 12-12 12h-56c-6.6 0-12-5.4-12-12v-92H92c-6.6 0-12-5.4-12-12v-56c0-6.6 5.4-12 12-12h92v-92c0-6.6 5.4-12 12-12h56c6.6 0 12 5.4 12 12v92h92c6.6 0 12 5.4 12 12v56z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-create, .x-window .x-toolbar .x-btn-text.action-create, .x-menu.light .x-menu-item-icon.action-create, .invert-menu-bg .x-menu-item-icon.action-create {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zm-32 252c0 6.6-5.4 12-12 12h-92v92c0 6.6-5.4 12-12 12h-56c-6.6 0-12-5.4-12-12v-92H92c-6.6 0-12-5.4-12-12v-56c0-6.6 5.4-12 12-12h92v-92c0-6.6 5.4-12 12-12h56c6.6 0 12 5.4 12 12v92h92c6.6 0 12 5.4 12 12v56z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.register, .x-window .x-toolbar .x-btn-text.register, .x-menu.light .x-menu-item-icon.register, .invert-menu-bg .x-menu-item-icon.register {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zm-32 252c0 6.6-5.4 12-12 12h-92v92c0 6.6-5.4 12-12 12h-56c-6.6 0-12-5.4-12-12v-92H92c-6.6 0-12-5.4-12-12v-56c0-6.6 5.4-12 12-12h92v-92c0-6.6 5.4-12 12-12h56c6.6 0 12 5.4 12 12v92h92c6.6 0 12 5.4 12 12v56z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-add, .x-toolbar .x-btn-menu-active .x-btn-text.action-add, .x-menu-item-active .x-menu-item-icon.action-add, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-add {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zm-32 252c0 6.6-5.4 12-12 12h-92v92c0 6.6-5.4 12-12 12h-56c-6.6 0-12-5.4-12-12v-92H92c-6.6 0-12-5.4-12-12v-56c0-6.6 5.4-12 12-12h92v-92c0-6.6 5.4-12 12-12h56c6.6 0 12 5.4 12 12v92h92c6.6 0 12 5.4 12 12v56z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-create, .x-toolbar .x-btn-menu-active .x-btn-text.action-create, .x-menu-item-active .x-menu-item-icon.action-create, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-create {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zm-32 252c0 6.6-5.4 12-12 12h-92v92c0 6.6-5.4 12-12 12h-56c-6.6 0-12-5.4-12-12v-92H92c-6.6 0-12-5.4-12-12v-56c0-6.6 5.4-12 12-12h92v-92c0-6.6 5.4-12 12-12h56c6.6 0 12 5.4 12 12v92h92c6.6 0 12 5.4 12 12v56z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.register, .x-toolbar .x-btn-menu-active .x-btn-text.register, .x-menu-item-active .x-menu-item-icon.register, .x-menu.light .x-menu-item-active .x-menu-item-icon.register {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zm-32 252c0 6.6-5.4 12-12 12h-92v92c0 6.6-5.4 12-12 12h-56c-6.6 0-12-5.4-12-12v-92H92c-6.6 0-12-5.4-12-12v-56c0-6.6 5.4-12 12-12h92v-92c0-6.6 5.4-12 12-12h56c6.6 0 12 5.4 12 12v92h92c6.6 0 12 5.4 12 12v56z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-backward, .x-menu-item .action-backward {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M223.7 239l136-136c9.4-9.4 24.6-9.4 33.9 0l22.6 22.6c9.4 9.4 9.4 24.6 0 33.9L319.9 256l96.4 96.4c9.4 9.4 9.4 24.6 0 33.9L393.7 409c-9.4 9.4-24.6 9.4-33.9 0l-136-136c-9.5-9.4-9.5-24.6-.1-34zm-192 34l136 136c9.4 9.4 24.6 9.4 33.9 0l22.6-22.6c9.4-9.4 9.4-24.6 0-33.9L127.9 256l96.4-96.4c9.4-9.4 9.4-24.6 0-33.9L201.7 103c-9.4-9.4-24.6-9.4-33.9 0l-136 136c-9.5 9.4-9.5 24.6-.1 34z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-backward, .x-window .x-toolbar .x-btn-text.action-backward, .x-menu.light .x-menu-item-icon.action-backward, .invert-menu-bg .x-menu-item-icon.action-backward {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M223.7 239l136-136c9.4-9.4 24.6-9.4 33.9 0l22.6 22.6c9.4 9.4 9.4 24.6 0 33.9L319.9 256l96.4 96.4c9.4 9.4 9.4 24.6 0 33.9L393.7 409c-9.4 9.4-24.6 9.4-33.9 0l-136-136c-9.5-9.4-9.5-24.6-.1-34zm-192 34l136 136c9.4 9.4 24.6 9.4 33.9 0l22.6-22.6c9.4-9.4 9.4-24.6 0-33.9L127.9 256l96.4-96.4c9.4-9.4 9.4-24.6 0-33.9L201.7 103c-9.4-9.4-24.6-9.4-33.9 0l-136 136c-9.5 9.4-9.5 24.6-.1 34z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-backward, .x-toolbar .x-btn-menu-active .x-btn-text.action-backward, .x-menu-item-active .x-menu-item-icon.action-backward, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-backward {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M223.7 239l136-136c9.4-9.4 24.6-9.4 33.9 0l22.6 22.6c9.4 9.4 9.4 24.6 0 33.9L319.9 256l96.4 96.4c9.4 9.4 9.4 24.6 0 33.9L393.7 409c-9.4 9.4-24.6 9.4-33.9 0l-136-136c-9.5-9.4-9.5-24.6-.1-34zm-192 34l136 136c9.4 9.4 24.6 9.4 33.9 0l22.6-22.6c9.4-9.4 9.4-24.6 0-33.9L127.9 256l96.4-96.4c9.4-9.4 9.4-24.6 0-33.9L201.7 103c-9.4-9.4-24.6-9.4-33.9 0l-136 136c-9.5 9.4-9.5 24.6-.1 34z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-copy, .x-menu-item .action-copy {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M433.941 65.941l-51.882-51.882A48 48 0 00348.118 0H176c-26.51 0-48 21.49-48 48v48H48c-26.51 0-48 21.49-48 48v320c0 26.51 21.49 48 48 48h224c26.51 0 48-21.49 48-48v-48h80c26.51 0 48-21.49 48-48V99.882a48 48 0 00-14.059-33.941zM266 464H54a6 6 0 01-6-6V150a6 6 0 016-6h74v224c0 26.51 21.49 48 48 48h96v42a6 6 0 01-6 6zm128-96H182a6 6 0 01-6-6V54a6 6 0 016-6h106v88c0 13.255 10.745 24 24 24h88v202a6 6 0 01-6 6zm6-256h-64V48h9.632c1.591 0 3.117.632 4.243 1.757l48.368 48.368a6 6 0 011.757 4.243V112z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-copy, .x-window .x-toolbar .x-btn-text.action-copy, .x-menu.light .x-menu-item-icon.action-copy, .invert-menu-bg .x-menu-item-icon.action-copy {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M433.941 65.941l-51.882-51.882A48 48 0 00348.118 0H176c-26.51 0-48 21.49-48 48v48H48c-26.51 0-48 21.49-48 48v320c0 26.51 21.49 48 48 48h224c26.51 0 48-21.49 48-48v-48h80c26.51 0 48-21.49 48-48V99.882a48 48 0 00-14.059-33.941zM266 464H54a6 6 0 01-6-6V150a6 6 0 016-6h74v224c0 26.51 21.49 48 48 48h96v42a6 6 0 01-6 6zm128-96H182a6 6 0 01-6-6V54a6 6 0 016-6h106v88c0 13.255 10.745 24 24 24h88v202a6 6 0 01-6 6zm6-256h-64V48h9.632c1.591 0 3.117.632 4.243 1.757l48.368 48.368a6 6 0 011.757 4.243V112z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-copy, .x-toolbar .x-btn-menu-active .x-btn-text.action-copy, .x-menu-item-active .x-menu-item-icon.action-copy, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-copy {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M433.941 65.941l-51.882-51.882A48 48 0 00348.118 0H176c-26.51 0-48 21.49-48 48v48H48c-26.51 0-48 21.49-48 48v320c0 26.51 21.49 48 48 48h224c26.51 0 48-21.49 48-48v-48h80c26.51 0 48-21.49 48-48V99.882a48 48 0 00-14.059-33.941zM266 464H54a6 6 0 01-6-6V150a6 6 0 016-6h74v224c0 26.51 21.49 48 48 48h96v42a6 6 0 01-6 6zm128-96H182a6 6 0 01-6-6V54a6 6 0 016-6h106v88c0 13.255 10.745 24 24 24h88v202a6 6 0 01-6 6zm6-256h-64V48h9.632c1.591 0 3.117.632 4.243 1.757l48.368 48.368a6 6 0 011.757 4.243V112z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-create-file, .x-menu-item .action-create-file {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M369.9 97.9L286 14A48 48 0 00252.1-.1H48A48.16 48.16 0 000 48v416a48 48 0 0048 48h288a48 48 0 0048-48V131.9a48.23 48.23 0 00-14.1-34zM256 51.9l76.1 76.1H256zM336 464H48V48h160v104a23.94 23.94 0 0024 24h104zM215 223.75a16 16 0 00-16-16h-16a16 16 0 00-16 16v56.5h-55.5a16 16 0 00-16 16v16a16 16 0 0016 16H167v56a16 16 0 0016 16h16a16 16 0 0016-16v-56h56.5a16 16 0 0016-16v-16a16 16 0 00-16-16H215z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-create-file, .x-window .x-toolbar .x-btn-text.action-create-file, .x-menu.light .x-menu-item-icon.action-create-file, .invert-menu-bg .x-menu-item-icon.action-create-file {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M369.9 97.9L286 14A48 48 0 00252.1-.1H48A48.16 48.16 0 000 48v416a48 48 0 0048 48h288a48 48 0 0048-48V131.9a48.23 48.23 0 00-14.1-34zM256 51.9l76.1 76.1H256zM336 464H48V48h160v104a23.94 23.94 0 0024 24h104zM215 223.75a16 16 0 00-16-16h-16a16 16 0 00-16 16v56.5h-55.5a16 16 0 00-16 16v16a16 16 0 0016 16H167v56a16 16 0 0016 16h16a16 16 0 0016-16v-56h56.5a16 16 0 0016-16v-16a16 16 0 00-16-16H215z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-create-file, .x-toolbar .x-btn-menu-active .x-btn-text.action-create-file, .x-menu-item-active .x-menu-item-icon.action-create-file, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-create-file {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M369.9 97.9L286 14A48 48 0 00252.1-.1H48A48.16 48.16 0 000 48v416a48 48 0 0048 48h288a48 48 0 0048-48V131.9a48.23 48.23 0 00-14.1-34zM256 51.9l76.1 76.1H256zM336 464H48V48h160v104a23.94 23.94 0 0024 24h104zM215 223.75a16 16 0 00-16-16h-16a16 16 0 00-16 16v56.5h-55.5a16 16 0 00-16 16v16a16 16 0 0016 16H167v56a16 16 0 0016 16h16a16 16 0 0016-16v-56h56.5a16 16 0 0016-16v-16a16 16 0 00-16-16H215z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-create-folder, .x-menu-item .action-create-folder {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M464 128H272l-54.63-54.63A32 32 0 00194.74 64H48a48 48 0 00-48 48v288a48 48 0 0048 48h416a48 48 0 0048-48V176a48 48 0 00-48-48zm0 272H48V112h140.12l54.63 54.63a32 32 0 0022.63 9.37H464zM247.5 208a16 16 0 00-16 16v40H192a16 16 0 00-16 16v16a16 16 0 0016 16h39.5v40a16 16 0 0016 16h16a16 16 0 0016-16v-40H320a16 16 0 0016-16v-16a16 16 0 00-16-16h-40.5v-40a16 16 0 00-16-16z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-create-folder, .x-window .x-toolbar .x-btn-text.action-create-folder, .x-menu.light .x-menu-item-icon.action-create-folder, .invert-menu-bg .x-menu-item-icon.action-create-folder {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M464 128H272l-54.63-54.63A32 32 0 00194.74 64H48a48 48 0 00-48 48v288a48 48 0 0048 48h416a48 48 0 0048-48V176a48 48 0 00-48-48zm0 272H48V112h140.12l54.63 54.63a32 32 0 0022.63 9.37H464zM247.5 208a16 16 0 00-16 16v40H192a16 16 0 00-16 16v16a16 16 0 0016 16h39.5v40a16 16 0 0016 16h16a16 16 0 0016-16v-40H320a16 16 0 0016-16v-16a16 16 0 00-16-16h-40.5v-40a16 16 0 00-16-16z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-create-folder, .x-toolbar .x-btn-menu-active .x-btn-text.action-create-folder, .x-menu-item-active .x-menu-item-icon.action-create-folder, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-create-folder {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M464 128H272l-54.63-54.63A32 32 0 00194.74 64H48a48 48 0 00-48 48v288a48 48 0 0048 48h416a48 48 0 0048-48V176a48 48 0 00-48-48zm0 272H48V112h140.12l54.63 54.63a32 32 0 0022.63 9.37H464zM247.5 208a16 16 0 00-16 16v40H192a16 16 0 00-16 16v16a16 16 0 0016 16h39.5v40a16 16 0 0016 16h16a16 16 0 0016-16v-40H320a16 16 0 0016-16v-16a16 16 0 00-16-16h-40.5v-40a16 16 0 00-16-16z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-delete, .x-menu-item .action-delete {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M268 416h24a12 12 0 0012-12V188a12 12 0 00-12-12h-24a12 12 0 00-12 12v216a12 12 0 0012 12zM432 80h-82.41l-34-56.7A48 48 0 00274.41 0H173.59a48 48 0 00-41.16 23.3L98.41 80H16A16 16 0 000 96v16a16 16 0 0016 16h16v336a48 48 0 0048 48h288a48 48 0 0048-48V128h16a16 16 0 0016-16V96a16 16 0 00-16-16zM171.84 50.91A6 6 0 01177 48h94a6 6 0 015.15 2.91L293.61 80H154.39zM368 464H80V128h288zm-212-48h24a12 12 0 0012-12V188a12 12 0 00-12-12h-24a12 12 0 00-12 12v216a12 12 0 0012 12z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-delete, .x-window .x-toolbar .x-btn-text.action-delete, .x-menu.light .x-menu-item-icon.action-delete, .invert-menu-bg .x-menu-item-icon.action-delete {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M268 416h24a12 12 0 0012-12V188a12 12 0 00-12-12h-24a12 12 0 00-12 12v216a12 12 0 0012 12zM432 80h-82.41l-34-56.7A48 48 0 00274.41 0H173.59a48 48 0 00-41.16 23.3L98.41 80H16A16 16 0 000 96v16a16 16 0 0016 16h16v336a48 48 0 0048 48h288a48 48 0 0048-48V128h16a16 16 0 0016-16V96a16 16 0 00-16-16zM171.84 50.91A6 6 0 01177 48h94a6 6 0 015.15 2.91L293.61 80H154.39zM368 464H80V128h288zm-212-48h24a12 12 0 0012-12V188a12 12 0 00-12-12h-24a12 12 0 00-12 12v216a12 12 0 0012 12z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-delete, .x-toolbar .x-btn-menu-active .x-btn-text.action-delete, .x-menu-item-active .x-menu-item-icon.action-delete, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-delete {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M268 416h24a12 12 0 0012-12V188a12 12 0 00-12-12h-24a12 12 0 00-12 12v216a12 12 0 0012 12zM432 80h-82.41l-34-56.7A48 48 0 00274.41 0H173.59a48 48 0 00-41.16 23.3L98.41 80H16A16 16 0 000 96v16a16 16 0 0016 16h16v336a48 48 0 0048 48h288a48 48 0 0048-48V128h16a16 16 0 0016-16V96a16 16 0 00-16-16zM171.84 50.91A6 6 0 01177 48h94a6 6 0 015.15 2.91L293.61 80H154.39zM368 464H80V128h288zm-212-48h24a12 12 0 0012-12V188a12 12 0 00-12-12h-24a12 12 0 00-12 12v216a12 12 0 0012 12z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-download, .x-menu-item .action-download {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M528 288h-92.1l46.1-46.1c30.1-30.1 8.8-81.9-33.9-81.9h-64V48c0-26.5-21.5-48-48-48h-96c-26.5 0-48 21.5-48 48v112h-64c-42.6 0-64.2 51.7-33.9 81.9l46.1 46.1H48c-26.5 0-48 21.5-48 48v128c0 26.5 21.5 48 48 48h480c26.5 0 48-21.5 48-48V336c0-26.5-21.5-48-48-48zm-400-80h112V48h96v160h112L288 368 128 208zm400 256H48V336h140.1l65.9 65.9c18.8 18.8 49.1 18.7 67.9 0l65.9-65.9H528v128zm-88-64c0-13.3 10.7-24 24-24s24 10.7 24 24-10.7 24-24 24-24-10.7-24-24z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-download, .x-window .x-toolbar .x-btn-text.action-download, .x-menu.light .x-menu-item-icon.action-download, .invert-menu-bg .x-menu-item-icon.action-download {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M528 288h-92.1l46.1-46.1c30.1-30.1 8.8-81.9-33.9-81.9h-64V48c0-26.5-21.5-48-48-48h-96c-26.5 0-48 21.5-48 48v112h-64c-42.6 0-64.2 51.7-33.9 81.9l46.1 46.1H48c-26.5 0-48 21.5-48 48v128c0 26.5 21.5 48 48 48h480c26.5 0 48-21.5 48-48V336c0-26.5-21.5-48-48-48zm-400-80h112V48h96v160h112L288 368 128 208zm400 256H48V336h140.1l65.9 65.9c18.8 18.8 49.1 18.7 67.9 0l65.9-65.9H528v128zm-88-64c0-13.3 10.7-24 24-24s24 10.7 24 24-10.7 24-24 24-24-10.7-24-24z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-download, .x-toolbar .x-btn-menu-active .x-btn-text.action-download, .x-menu-item-active .x-menu-item-icon.action-download, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-download {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M528 288h-92.1l46.1-46.1c30.1-30.1 8.8-81.9-33.9-81.9h-64V48c0-26.5-21.5-48-48-48h-96c-26.5 0-48 21.5-48 48v112h-64c-42.6 0-64.2 51.7-33.9 81.9l46.1 46.1H48c-26.5 0-48 21.5-48 48v128c0 26.5 21.5 48 48 48h480c26.5 0 48-21.5 48-48V336c0-26.5-21.5-48-48-48zm-400-80h112V48h96v160h112L288 368 128 208zm400 256H48V336h140.1l65.9 65.9c18.8 18.8 49.1 18.7 67.9 0l65.9-65.9H528v128zm-88-64c0-13.3 10.7-24 24-24s24 10.7 24 24-10.7 24-24 24-24-10.7-24-24z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-drag, .x-menu-item .action-drag {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M384 320H256c-17.67 0-32 14.33-32 32v128c0 17.67 14.33 32 32 32h128c17.67 0 32-14.33 32-32V352c0-17.67-14.33-32-32-32zM192 32c0-17.67-14.33-32-32-32H32C14.33 0 0 14.33 0 32v128c0 17.67 14.33 32 32 32h95.72l73.16 128.04C211.98 300.98 232.4 288 256 288h.28L192 175.51V128h224V64H192V32zM608 0H480c-17.67 0-32 14.33-32 32v128c0 17.67 14.33 32 32 32h128c17.67 0 32-14.33 32-32V32c0-17.67-14.33-32-32-32z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-drag, .x-window .x-toolbar .x-btn-text.action-drag, .x-menu.light .x-menu-item-icon.action-drag, .invert-menu-bg .x-menu-item-icon.action-drag {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M384 320H256c-17.67 0-32 14.33-32 32v128c0 17.67 14.33 32 32 32h128c17.67 0 32-14.33 32-32V352c0-17.67-14.33-32-32-32zM192 32c0-17.67-14.33-32-32-32H32C14.33 0 0 14.33 0 32v128c0 17.67 14.33 32 32 32h95.72l73.16 128.04C211.98 300.98 232.4 288 256 288h.28L192 175.51V128h224V64H192V32zM608 0H480c-17.67 0-32 14.33-32 32v128c0 17.67 14.33 32 32 32h128c17.67 0 32-14.33 32-32V32c0-17.67-14.33-32-32-32z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-drag, .x-toolbar .x-btn-menu-active .x-btn-text.action-drag, .x-menu-item-active .x-menu-item-icon.action-drag, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-drag {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M384 320H256c-17.67 0-32 14.33-32 32v128c0 17.67 14.33 32 32 32h128c17.67 0 32-14.33 32-32V352c0-17.67-14.33-32-32-32zM192 32c0-17.67-14.33-32-32-32H32C14.33 0 0 14.33 0 32v128c0 17.67 14.33 32 32 32h95.72l73.16 128.04C211.98 300.98 232.4 288 256 288h.28L192 175.51V128h224V64H192V32zM608 0H480c-17.67 0-32 14.33-32 32v128c0 17.67 14.33 32 32 32h128c17.67 0 32-14.33 32-32V32c0-17.67-14.33-32-32-32z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-edit, .x-menu-item .action-edit {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M402.6 83.2l90.2 90.2c3.8 3.8 3.8 10 0 13.8L274.4 405.6l-92.8 10.3c-12.4 1.4-22.9-9.1-21.5-21.5l10.3-92.8L388.8 83.2c3.8-3.8 10-3.8 13.8 0zm162-22.9l-48.8-48.8c-15.2-15.2-39.9-15.2-55.2 0l-35.4 35.4c-3.8 3.8-3.8 10 0 13.8l90.2 90.2c3.8 3.8 10 3.8 13.8 0l35.4-35.4c15.2-15.3 15.2-40 0-55.2zM384 346.2V448H64V128h229.8c3.2 0 6.2-1.3 8.5-3.5l40-40c7.6-7.6 2.2-20.5-8.5-20.5H48C21.5 64 0 85.5 0 112v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V306.2c0-10.7-12.9-16-20.5-8.5l-40 40c-2.2 2.3-3.5 5.3-3.5 8.5z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-edit, .x-window .x-toolbar .x-btn-text.action-edit, .x-menu.light .x-menu-item-icon.action-edit, .invert-menu-bg .x-menu-item-icon.action-edit {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M402.6 83.2l90.2 90.2c3.8 3.8 3.8 10 0 13.8L274.4 405.6l-92.8 10.3c-12.4 1.4-22.9-9.1-21.5-21.5l10.3-92.8L388.8 83.2c3.8-3.8 10-3.8 13.8 0zm162-22.9l-48.8-48.8c-15.2-15.2-39.9-15.2-55.2 0l-35.4 35.4c-3.8 3.8-3.8 10 0 13.8l90.2 90.2c3.8 3.8 10 3.8 13.8 0l35.4-35.4c15.2-15.3 15.2-40 0-55.2zM384 346.2V448H64V128h229.8c3.2 0 6.2-1.3 8.5-3.5l40-40c7.6-7.6 2.2-20.5-8.5-20.5H48C21.5 64 0 85.5 0 112v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V306.2c0-10.7-12.9-16-20.5-8.5l-40 40c-2.2 2.3-3.5 5.3-3.5 8.5z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-edit, .x-toolbar .x-btn-menu-active .x-btn-text.action-edit, .x-menu-item-active .x-menu-item-icon.action-edit, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-edit {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M402.6 83.2l90.2 90.2c3.8 3.8 3.8 10 0 13.8L274.4 405.6l-92.8 10.3c-12.4 1.4-22.9-9.1-21.5-21.5l10.3-92.8L388.8 83.2c3.8-3.8 10-3.8 13.8 0zm162-22.9l-48.8-48.8c-15.2-15.2-39.9-15.2-55.2 0l-35.4 35.4c-3.8 3.8-3.8 10 0 13.8l90.2 90.2c3.8 3.8 10 3.8 13.8 0l35.4-35.4c15.2-15.3 15.2-40 0-55.2zM384 346.2V448H64V128h229.8c3.2 0 6.2-1.3 8.5-3.5l40-40c7.6-7.6 2.2-20.5-8.5-20.5H48C21.5 64 0 85.5 0 112v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V306.2c0-10.7-12.9-16-20.5-8.5l-40 40c-2.2 2.3-3.5 5.3-3.5 8.5z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-favorites, .x-menu-item .action-favorites {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M0 512V48C0 21.49 21.49 0 48 0h288c26.51 0 48 21.49 48 48v464L192 400 0 512z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-favorites, .x-window .x-toolbar .x-btn-text.action-favorites, .x-menu.light .x-menu-item-icon.action-favorites, .invert-menu-bg .x-menu-item-icon.action-favorites {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M0 512V48C0 21.49 21.49 0 48 0h288c26.51 0 48 21.49 48 48v464L192 400 0 512z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-favorites, .x-toolbar .x-btn-menu-active .x-btn-text.action-favorites, .x-menu-item-active .x-menu-item-icon.action-favorites, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-favorites {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M0 512V48C0 21.49 21.49 0 48 0h288c26.51 0 48 21.49 48 48v464L192 400 0 512z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-forward, .x-menu-item .action-forward {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M224.3 273l-136 136c-9.4 9.4-24.6 9.4-33.9 0l-22.6-22.6c-9.4-9.4-9.4-24.6 0-33.9l96.4-96.4-96.4-96.4c-9.4-9.4-9.4-24.6 0-33.9L54.3 103c9.4-9.4 24.6-9.4 33.9 0l136 136c9.5 9.4 9.5 24.6.1 34zm192-34l-136-136c-9.4-9.4-24.6-9.4-33.9 0l-22.6 22.6c-9.4 9.4-9.4 24.6 0 33.9l96.4 96.4-96.4 96.4c-9.4 9.4-9.4 24.6 0 33.9l22.6 22.6c9.4 9.4 24.6 9.4 33.9 0l136-136c9.4-9.2 9.4-24.4 0-33.8z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-forward, .x-window .x-toolbar .x-btn-text.action-forward, .x-menu.light .x-menu-item-icon.action-forward, .invert-menu-bg .x-menu-item-icon.action-forward {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M224.3 273l-136 136c-9.4 9.4-24.6 9.4-33.9 0l-22.6-22.6c-9.4-9.4-9.4-24.6 0-33.9l96.4-96.4-96.4-96.4c-9.4-9.4-9.4-24.6 0-33.9L54.3 103c9.4-9.4 24.6-9.4 33.9 0l136 136c9.5 9.4 9.5 24.6.1 34zm192-34l-136-136c-9.4-9.4-24.6-9.4-33.9 0l-22.6 22.6c-9.4 9.4-9.4 24.6 0 33.9l96.4 96.4-96.4 96.4c-9.4 9.4-9.4 24.6 0 33.9l22.6 22.6c9.4 9.4 24.6 9.4 33.9 0l136-136c9.4-9.2 9.4-24.4 0-33.8z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-forward, .x-toolbar .x-btn-menu-active .x-btn-text.action-forward, .x-menu-item-active .x-menu-item-icon.action-forward, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-forward {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M224.3 273l-136 136c-9.4 9.4-24.6 9.4-33.9 0l-22.6-22.6c-9.4-9.4-9.4-24.6 0-33.9l96.4-96.4-96.4-96.4c-9.4-9.4-9.4-24.6 0-33.9L54.3 103c9.4-9.4 24.6-9.4 33.9 0l136 136c9.5 9.4 9.5 24.6.1 34zm192-34l-136-136c-9.4-9.4-24.6-9.4-33.9 0l-22.6 22.6c-9.4 9.4-9.4 24.6 0 33.9l96.4 96.4-96.4 96.4c-9.4 9.4-9.4 24.6 0 33.9l22.6 22.6c9.4 9.4 24.6 9.4 33.9 0l136-136c9.4-9.2 9.4-24.4 0-33.8z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-highlight, .x-menu-item .action-highlight {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23FF0" d="M0 0h256v256H0z"/><path fill="%230CF" d="M257 0h256v256H257z"/><path fill="%233C3" d="M0 257h256v256H0z"/><path fill="%23F9C" d="M257 257h256v256H257z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-highlight, .x-window .x-toolbar .x-btn-text.action-highlight, .x-menu.light .x-menu-item-icon.action-highlight, .invert-menu-bg .x-menu-item-icon.action-highlight {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23FF0" d="M0 0h256v256H0z"/><path fill="%230CF" d="M257 0h256v256H257z"/><path fill="%233C3" d="M0 257h256v256H0z"/><path fill="%23F9C" d="M257 257h256v256H257z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-highlight, .x-toolbar .x-btn-menu-active .x-btn-text.action-highlight, .x-menu-item-active .x-menu-item-icon.action-highlight, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-highlight {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23FF0" d="M0 0h256v256H0z"/><path fill="%230CF" d="M257 0h256v256H257z"/><path fill="%233C3" d="M0 257h256v256H0z"/><path fill="%23F9C" d="M257 257h256v256H257z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-link, .x-menu-item .action-link {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M432 320h-32a16 16 0 00-16 16v112H64V128h144a16 16 0 0016-16V80a16 16 0 00-16-16H48a48 48 0 00-48 48v352a48 48 0 0048 48h352a48 48 0 0048-48V336a16 16 0 00-16-16zM488 0H360c-21.37 0-32.05 25.91-17 41l35.73 35.73L135 320.37a24 24 0 000 34L157.67 377a24 24 0 0034 0l243.61-243.68L471 169c15 15 41 4.5 41-17V24a24 24 0 00-24-24z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-link, .x-window .x-toolbar .x-btn-text.action-link, .x-menu.light .x-menu-item-icon.action-link, .invert-menu-bg .x-menu-item-icon.action-link {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M432 320h-32a16 16 0 00-16 16v112H64V128h144a16 16 0 0016-16V80a16 16 0 00-16-16H48a48 48 0 00-48 48v352a48 48 0 0048 48h352a48 48 0 0048-48V336a16 16 0 00-16-16zM488 0H360c-21.37 0-32.05 25.91-17 41l35.73 35.73L135 320.37a24 24 0 000 34L157.67 377a24 24 0 0034 0l243.61-243.68L471 169c15 15 41 4.5 41-17V24a24 24 0 00-24-24z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-link, .x-toolbar .x-btn-menu-active .x-btn-text.action-link, .x-menu-item-active .x-menu-item-icon.action-link, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-link {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M432 320h-32a16 16 0 00-16 16v112H64V128h144a16 16 0 0016-16V80a16 16 0 00-16-16H48a48 48 0 00-48 48v352a48 48 0 0048 48h352a48 48 0 0048-48V336a16 16 0 00-16-16zM488 0H360c-21.37 0-32.05 25.91-17 41l35.73 35.73L135 320.37a24 24 0 000 34L157.67 377a24 24 0 0034 0l243.61-243.68L471 169c15 15 41 4.5 41-17V24a24 24 0 00-24-24z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-mixin, .x-menu-item .action-mixin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M114.57 76.07a45.71 45.71 0 00-67.51-6.41c-17.58 16.18-19 43.52-4.75 62.77l91.78 123-92.33 124.15c-14.23 19.25-13.11 46.59 4.74 62.77a45.71 45.71 0 0067.5-6.41L242.89 262.7a12.14 12.14 0 000-14.23zm355.67 303.51l-92.33-124.13 91.78-123c14.22-19.25 12.83-46.59-4.75-62.77a45.71 45.71 0 00-67.51 6.41l-128 172.12a12.14 12.14 0 000 14.23L398 435.94a45.71 45.71 0 0067.51 6.41c17.84-16.18 18.96-43.52 4.73-62.77z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-mixin, .x-window .x-toolbar .x-btn-text.action-mixin, .x-menu.light .x-menu-item-icon.action-mixin, .invert-menu-bg .x-menu-item-icon.action-mixin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M114.57 76.07a45.71 45.71 0 00-67.51-6.41c-17.58 16.18-19 43.52-4.75 62.77l91.78 123-92.33 124.15c-14.23 19.25-13.11 46.59 4.74 62.77a45.71 45.71 0 0067.5-6.41L242.89 262.7a12.14 12.14 0 000-14.23zm355.67 303.51l-92.33-124.13 91.78-123c14.22-19.25 12.83-46.59-4.75-62.77a45.71 45.71 0 00-67.51 6.41l-128 172.12a12.14 12.14 0 000 14.23L398 435.94a45.71 45.71 0 0067.51 6.41c17.84-16.18 18.96-43.52 4.73-62.77z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-mixin, .x-toolbar .x-btn-menu-active .x-btn-text.action-mixin, .x-menu-item-active .x-menu-item-icon.action-mixin, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-mixin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M114.57 76.07a45.71 45.71 0 00-67.51-6.41c-17.58 16.18-19 43.52-4.75 62.77l91.78 123-92.33 124.15c-14.23 19.25-13.11 46.59 4.74 62.77a45.71 45.71 0 0067.5-6.41L242.89 262.7a12.14 12.14 0 000-14.23zm355.67 303.51l-92.33-124.13 91.78-123c14.22-19.25 12.83-46.59-4.75-62.77a45.71 45.71 0 00-67.51 6.41l-128 172.12a12.14 12.14 0 000 14.23L398 435.94a45.71 45.71 0 0067.51 6.41c17.84-16.18 18.96-43.52 4.73-62.77z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-move, .x-menu-item .action-move {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M448 344v112a23.94 23.94 0 01-24 24H312c-21.39 0-32.09-25.9-17-41l36.2-36.2L224 295.6 116.77 402.9 153 439c15.09 15.1 4.39 41-17 41H24a23.94 23.94 0 01-24-24V344c0-21.4 25.89-32.1 41-17l36.19 36.2L184.46 256 77.18 148.7 41 185c-15.1 15.1-41 4.4-41-17V56a23.94 23.94 0 0124-24h112c21.39 0 32.09 25.9 17 41l-36.2 36.2L224 216.4l107.23-107.3L295 73c-15.09-15.1-4.39-41 17-41h112a23.94 23.94 0 0124 24v112c0 21.4-25.89 32.1-41 17l-36.19-36.2L263.54 256l107.28 107.3L407 327.1c15.1-15.2 41-4.5 41 16.9z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-move, .x-window .x-toolbar .x-btn-text.action-move, .x-menu.light .x-menu-item-icon.action-move, .invert-menu-bg .x-menu-item-icon.action-move {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M448 344v112a23.94 23.94 0 01-24 24H312c-21.39 0-32.09-25.9-17-41l36.2-36.2L224 295.6 116.77 402.9 153 439c15.09 15.1 4.39 41-17 41H24a23.94 23.94 0 01-24-24V344c0-21.4 25.89-32.1 41-17l36.19 36.2L184.46 256 77.18 148.7 41 185c-15.1 15.1-41 4.4-41-17V56a23.94 23.94 0 0124-24h112c21.39 0 32.09 25.9 17 41l-36.2 36.2L224 216.4l107.23-107.3L295 73c-15.09-15.1-4.39-41 17-41h112a23.94 23.94 0 0124 24v112c0 21.4-25.89 32.1-41 17l-36.19-36.2L263.54 256l107.28 107.3L407 327.1c15.1-15.2 41-4.5 41 16.9z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-move, .x-toolbar .x-btn-menu-active .x-btn-text.action-move, .x-menu-item-active .x-menu-item-icon.action-move, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-move {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M448 344v112a23.94 23.94 0 01-24 24H312c-21.39 0-32.09-25.9-17-41l36.2-36.2L224 295.6 116.77 402.9 153 439c15.09 15.1 4.39 41-17 41H24a23.94 23.94 0 01-24-24V344c0-21.4 25.89-32.1 41-17l36.19 36.2L184.46 256 77.18 148.7 41 185c-15.1 15.1-41 4.4-41-17V56a23.94 23.94 0 0124-24h112c21.39 0 32.09 25.9 17 41l-36.2 36.2L224 216.4l107.23-107.3L295 73c-15.09-15.1-4.39-41 17-41h112a23.94 23.94 0 0124 24v112c0 21.4-25.89 32.1-41 17l-36.19-36.2L263.54 256l107.28 107.3L407 327.1c15.1-15.2 41-4.5 41 16.9z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-nodetree, .x-menu-item .action-nodetree {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" class="svg-inline--fa fa-folder-tree fa-w-18 fa-9x"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M544 32H432L400 0h-80a32 32 0 00-32 32v160a32 32 0 0032 32h224a32 32 0 0032-32V64a32 32 0 00-32-32zm0 288H432l-32-32h-80a32 32 0 00-32 32v160a32 32 0 0032 32h224a32 32 0 0032-32V352a32 32 0 00-32-32zM64 16A16 16 0 0048 0H16A16 16 0 000 16v400a32 32 0 0032 32h224v-64H64V160h192V96H64z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-nodetree, .x-window .x-toolbar .x-btn-text.action-nodetree, .x-menu.light .x-menu-item-icon.action-nodetree, .invert-menu-bg .x-menu-item-icon.action-nodetree {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" class="svg-inline--fa fa-folder-tree fa-w-18 fa-9x"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M544 32H432L400 0h-80a32 32 0 00-32 32v160a32 32 0 0032 32h224a32 32 0 0032-32V64a32 32 0 00-32-32zm0 288H432l-32-32h-80a32 32 0 00-32 32v160a32 32 0 0032 32h224a32 32 0 0032-32V352a32 32 0 00-32-32zM64 16A16 16 0 0048 0H16A16 16 0 000 16v400a32 32 0 0032 32h224v-64H64V160h192V96H64z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-nodetree, .x-toolbar .x-btn-menu-active .x-btn-text.action-nodetree, .x-menu-item-active .x-menu-item-icon.action-nodetree, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-nodetree {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" class="svg-inline--fa fa-folder-tree fa-w-18 fa-9x"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M544 32H432L400 0h-80a32 32 0 00-32 32v160a32 32 0 0032 32h224a32 32 0 0032-32V64a32 32 0 00-32-32zm0 288H432l-32-32h-80a32 32 0 00-32 32v160a32 32 0 0032 32h224a32 32 0 0032-32V352a32 32 0 00-32-32zM64 16A16 16 0 0048 0H16A16 16 0 000 16v400a32 32 0 0032 32h224v-64H64V160h192V96H64z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-paste, .x-menu-item .action-paste {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M336 64h-80c0-35.3-28.7-64-64-64s-64 28.7-64 64H48C21.5 64 0 85.5 0 112v352c0 26.5 21.5 48 48 48h288c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48zM192 40c13.3 0 24 10.7 24 24s-10.7 24-24 24-24-10.7-24-24 10.7-24 24-24zm144 418c0 3.3-2.7 6-6 6H54c-3.3 0-6-2.7-6-6V118c0-3.3 2.7-6 6-6h42v36c0 6.6 5.4 12 12 12h168c6.6 0 12-5.4 12-12v-36h42c3.3 0 6 2.7 6 6z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-paste, .x-window .x-toolbar .x-btn-text.action-paste, .x-menu.light .x-menu-item-icon.action-paste, .invert-menu-bg .x-menu-item-icon.action-paste {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M336 64h-80c0-35.3-28.7-64-64-64s-64 28.7-64 64H48C21.5 64 0 85.5 0 112v352c0 26.5 21.5 48 48 48h288c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48zM192 40c13.3 0 24 10.7 24 24s-10.7 24-24 24-24-10.7-24-24 10.7-24 24-24zm144 418c0 3.3-2.7 6-6 6H54c-3.3 0-6-2.7-6-6V118c0-3.3 2.7-6 6-6h42v36c0 6.6 5.4 12 12 12h168c6.6 0 12-5.4 12-12v-36h42c3.3 0 6 2.7 6 6z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-paste, .x-toolbar .x-btn-menu-active .x-btn-text.action-paste, .x-menu-item-active .x-menu-item-icon.action-paste, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-paste {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M336 64h-80c0-35.3-28.7-64-64-64s-64 28.7-64 64H48C21.5 64 0 85.5 0 112v352c0 26.5 21.5 48 48 48h288c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48zM192 40c13.3 0 24 10.7 24 24s-10.7 24-24 24-24-10.7-24-24 10.7-24 24-24zm144 418c0 3.3-2.7 6-6 6H54c-3.3 0-6-2.7-6-6V118c0-3.3 2.7-6 6-6h42v36c0 6.6 5.4 12 12 12h168c6.6 0 12-5.4 12-12v-36h42c3.3 0 6 2.7 6 6z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-query-sql, .x-menu-item .action-query-sql {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M505 442.7L405.3 343c-4.5-4.5-10.6-7-17-7H372c27.6-35.3 44-79.7 44-128C416 93.1 322.9 0 208 0S0 93.1 0 208s93.1 208 208 208c48.3 0 92.7-16.4 128-44v16.3c0 6.4 2.5 12.5 7 17l99.7 99.7c9.4 9.4 24.6 9.4 33.9 0l28.3-28.3c9.4-9.4 9.4-24.6.1-34zM208 336c-70.7 0-128-57.2-128-128 0-70.7 57.2-128 128-128 70.7 0 128 57.2 128 128 0 70.7-57.2 128-128 128z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-query-sql, .x-window .x-toolbar .x-btn-text.action-query-sql, .x-menu.light .x-menu-item-icon.action-query-sql, .invert-menu-bg .x-menu-item-icon.action-query-sql {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M505 442.7L405.3 343c-4.5-4.5-10.6-7-17-7H372c27.6-35.3 44-79.7 44-128C416 93.1 322.9 0 208 0S0 93.1 0 208s93.1 208 208 208c48.3 0 92.7-16.4 128-44v16.3c0 6.4 2.5 12.5 7 17l99.7 99.7c9.4 9.4 24.6 9.4 33.9 0l28.3-28.3c9.4-9.4 9.4-24.6.1-34zM208 336c-70.7 0-128-57.2-128-128 0-70.7 57.2-128 128-128 70.7 0 128 57.2 128 128 0 70.7-57.2 128-128 128z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-query-sql, .x-toolbar .x-btn-menu-active .x-btn-text.action-query-sql, .x-menu-item-active .x-menu-item-icon.action-query-sql, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-query-sql {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M505 442.7L405.3 343c-4.5-4.5-10.6-7-17-7H372c27.6-35.3 44-79.7 44-128C416 93.1 322.9 0 208 0S0 93.1 0 208s93.1 208 208 208c48.3 0 92.7-16.4 128-44v16.3c0 6.4 2.5 12.5 7 17l99.7 99.7c9.4 9.4 24.6 9.4 33.9 0l28.3-28.3c9.4-9.4 9.4-24.6.1-34zM208 336c-70.7 0-128-57.2-128-128 0-70.7 57.2-128 128-128 70.7 0 128 57.2 128 128 0 70.7-57.2 128-128 128z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-query-xpath, .x-menu-item .action-query-xpath {background-image: url('data:image/svg+xml;utf8,')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-query-xpath, .x-window .x-toolbar .x-btn-text.action-query-xpath, .x-menu.light .x-menu-item-icon.action-query-xpath, .invert-menu-bg .x-menu-item-icon.action-query-xpath {background-image: url('data:image/svg+xml;utf8,')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-query-xpath, .x-toolbar .x-btn-menu-active .x-btn-text.action-query-xpath, .x-menu-item-active .x-menu-item-icon.action-query-xpath, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-query-xpath {background-image: url('data:image/svg+xml;utf8,')!important;}`)
    .add(`.x-btn-text.action-refresh, .x-menu-item .action-refresh {background-image: url('data:image/svg+xml;utf8,<svg aria-hidden="true" data-prefix="fas" data-icon="sync-alt" class="svg-inline--fa fa-sync-alt fa-w-16" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M370.72 133.28C339.458 104.008 298.888 87.962 255.848 88c-77.458.068-144.328 53.178-162.791 126.85-1.344 5.363-6.122 9.15-11.651 9.15H24.103c-7.498 0-13.194-6.807-11.807-14.176C33.933 94.924 134.813 8 256 8c66.448 0 126.791 26.136 171.315 68.685L463.03 40.97C478.149 25.851 504 36.559 504 57.941V192c0 13.255-10.745 24-24 24H345.941c-21.382 0-32.09-25.851-16.971-40.971l41.75-41.749zM32 296h134.059c21.382 0 32.09 25.851 16.971 40.971l-41.75 41.75c31.262 29.273 71.835 45.319 114.876 45.28 77.418-.07 144.315-53.144 162.787-126.849 1.344-5.363 6.122-9.15 11.651-9.15h57.304c7.498 0 13.194 6.807 11.807 14.176C478.067 417.076 377.187 504 256 504c-66.448 0-126.791-26.136-171.315-68.685L48.97 471.03C33.851 486.149 8 475.441 8 454.059V320c0-13.255 10.745-24 24-24z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-refresh, .x-window .x-toolbar .x-btn-text.action-refresh, .x-menu.light .x-menu-item-icon.action-refresh, .invert-menu-bg .x-menu-item-icon.action-refresh {background-image: url('data:image/svg+xml;utf8,<svg aria-hidden="true" data-prefix="fas" data-icon="sync-alt" class="svg-inline--fa fa-sync-alt fa-w-16" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M370.72 133.28C339.458 104.008 298.888 87.962 255.848 88c-77.458.068-144.328 53.178-162.791 126.85-1.344 5.363-6.122 9.15-11.651 9.15H24.103c-7.498 0-13.194-6.807-11.807-14.176C33.933 94.924 134.813 8 256 8c66.448 0 126.791 26.136 171.315 68.685L463.03 40.97C478.149 25.851 504 36.559 504 57.941V192c0 13.255-10.745 24-24 24H345.941c-21.382 0-32.09-25.851-16.971-40.971l41.75-41.749zM32 296h134.059c21.382 0 32.09 25.851 16.971 40.971l-41.75 41.75c31.262 29.273 71.835 45.319 114.876 45.28 77.418-.07 144.315-53.144 162.787-126.849 1.344-5.363 6.122-9.15 11.651-9.15h57.304c7.498 0 13.194 6.807 11.807 14.176C478.067 417.076 377.187 504 256 504c-66.448 0-126.791-26.136-171.315-68.685L48.97 471.03C33.851 486.149 8 475.441 8 454.059V320c0-13.255 10.745-24 24-24z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-refresh, .x-toolbar .x-btn-menu-active .x-btn-text.action-refresh, .x-menu-item-active .x-menu-item-icon.action-refresh, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-refresh {background-image: url('data:image/svg+xml;utf8,<svg aria-hidden="true" data-prefix="fas" data-icon="sync-alt" class="svg-inline--fa fa-sync-alt fa-w-16" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M370.72 133.28C339.458 104.008 298.888 87.962 255.848 88c-77.458.068-144.328 53.178-162.791 126.85-1.344 5.363-6.122 9.15-11.651 9.15H24.103c-7.498 0-13.194-6.807-11.807-14.176C33.933 94.924 134.813 8 256 8c66.448 0 126.791 26.136 171.315 68.685L463.03 40.97C478.149 25.851 504 36.559 504 57.941V192c0 13.255-10.745 24-24 24H345.941c-21.382 0-32.09-25.851-16.971-40.971l41.75-41.749zM32 296h134.059c21.382 0 32.09 25.851 16.971 40.971l-41.75 41.75c31.262 29.273 71.835 45.319 114.876 45.28 77.418-.07 144.315-53.144 162.787-126.849 1.344-5.363 6.122-9.15 11.651-9.15h57.304c7.498 0 13.194 6.807 11.807 14.176C478.067 417.076 377.187 504 256 504c-66.448 0-126.791-26.136-171.315-68.685L48.97 471.03C33.851 486.149 8 475.441 8 454.059V320c0-13.255 10.745-24 24-24z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-replicate, .x-menu-item .action-replicate {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M464 0c26.51 0 48 21.49 48 48v288c0 26.51-21.49 48-48 48H176c-26.51 0-48-21.49-48-48V48c0-26.51 21.49-48 48-48h288M176 416c-44.112 0-80-35.888-80-80V128H48c-26.51 0-48 21.49-48 48v288c0 26.51 21.49 48 48 48h288c26.51 0 48-21.49 48-48v-48H176z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-replicate, .x-window .x-toolbar .x-btn-text.action-replicate, .x-menu.light .x-menu-item-icon.action-replicate, .invert-menu-bg .x-menu-item-icon.action-replicate {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M464 0c26.51 0 48 21.49 48 48v288c0 26.51-21.49 48-48 48H176c-26.51 0-48-21.49-48-48V48c0-26.51 21.49-48 48-48h288M176 416c-44.112 0-80-35.888-80-80V128H48c-26.51 0-48 21.49-48 48v288c0 26.51 21.49 48 48 48h288c26.51 0 48-21.49 48-48v-48H176z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-replicate, .x-toolbar .x-btn-menu-active .x-btn-text.action-replicate, .x-menu-item-active .x-menu-item-icon.action-replicate, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-replicate {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M464 0c26.51 0 48 21.49 48 48v288c0 26.51-21.49 48-48 48H176c-26.51 0-48-21.49-48-48V48c0-26.51 21.49-48 48-48h288M176 416c-44.112 0-80-35.888-80-80V128H48c-26.51 0-48 21.49-48 48v288c0 26.51 21.49 48 48 48h288c26.51 0 48-21.49 48-48v-48H176z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-revert, .x-menu-item .action-revert {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M504 255.531c.253 136.64-111.18 248.372-247.82 248.468-59.015.042-113.223-20.53-155.822-54.911-11.077-8.94-11.905-25.541-1.839-35.607l11.267-11.267c8.609-8.609 22.353-9.551 31.891-1.984C173.062 425.135 212.781 440 256 440c101.705 0 184-82.311 184-184 0-101.705-82.311-184-184-184-48.814 0-93.149 18.969-126.068 49.932l50.754 50.754c10.08 10.08 2.941 27.314-11.313 27.314H24c-8.837 0-16-7.163-16-16V38.627c0-14.254 17.234-21.393 27.314-11.314l49.372 49.372C129.209 34.136 189.552 8 256 8c136.81 0 247.747 110.78 248 247.531zm-180.912 78.784l9.823-12.63c8.138-10.463 6.253-25.542-4.21-33.679L288 256.349V152c0-13.255-10.745-24-24-24h-16c-13.255 0-24 10.745-24 24v135.651l65.409 50.874c10.463 8.137 25.541 6.253 33.679-4.21z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-revert, .x-window .x-toolbar .x-btn-text.action-revert, .x-menu.light .x-menu-item-icon.action-revert, .invert-menu-bg .x-menu-item-icon.action-revert {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M504 255.531c.253 136.64-111.18 248.372-247.82 248.468-59.015.042-113.223-20.53-155.822-54.911-11.077-8.94-11.905-25.541-1.839-35.607l11.267-11.267c8.609-8.609 22.353-9.551 31.891-1.984C173.062 425.135 212.781 440 256 440c101.705 0 184-82.311 184-184 0-101.705-82.311-184-184-184-48.814 0-93.149 18.969-126.068 49.932l50.754 50.754c10.08 10.08 2.941 27.314-11.313 27.314H24c-8.837 0-16-7.163-16-16V38.627c0-14.254 17.234-21.393 27.314-11.314l49.372 49.372C129.209 34.136 189.552 8 256 8c136.81 0 247.747 110.78 248 247.531zm-180.912 78.784l9.823-12.63c8.138-10.463 6.253-25.542-4.21-33.679L288 256.349V152c0-13.255-10.745-24-24-24h-16c-13.255 0-24 10.745-24 24v135.651l65.409 50.874c10.463 8.137 25.541 6.253 33.679-4.21z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-revert, .x-toolbar .x-btn-menu-active .x-btn-text.action-revert, .x-menu-item-active .x-menu-item-icon.action-revert, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-revert {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M504 255.531c.253 136.64-111.18 248.372-247.82 248.468-59.015.042-113.223-20.53-155.822-54.911-11.077-8.94-11.905-25.541-1.839-35.607l11.267-11.267c8.609-8.609 22.353-9.551 31.891-1.984C173.062 425.135 212.781 440 256 440c101.705 0 184-82.311 184-184 0-101.705-82.311-184-184-184-48.814 0-93.149 18.969-126.068 49.932l50.754 50.754c10.08 10.08 2.941 27.314-11.313 27.314H24c-8.837 0-16-7.163-16-16V38.627c0-14.254 17.234-21.393 27.314-11.314l49.372 49.372C129.209 34.136 189.552 8 256 8c136.81 0 247.747 110.78 248 247.531zm-180.912 78.784l9.823-12.63c8.138-10.463 6.253-25.542-4.21-33.679L288 256.349V152c0-13.255-10.745-24-24-24h-16c-13.255 0-24 10.745-24 24v135.651l65.409 50.874c10.463 8.137 25.541 6.253 33.679-4.21z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-save, .x-menu-item .action-save {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488.446 488.446"><g fill="%23\${COLOR_TOOLS_FG_NOHASH}"><path d="M153.029 90.223h182.404c5.427 0 9.873-4.43 9.873-9.869V0H143.137v80.354c0 5.439 4.434 9.869 9.892 9.869z"/><path d="M480.817 122.864L377.88 19.494v60.859c0 23.404-19.043 42.447-42.447 42.447H153.029c-23.409 0-42.447-19.043-42.447-42.447V0H44.823C20.068 0 .002 20.07.002 44.808v398.831c0 24.736 20.066 44.808 44.821 44.808h398.813c24.74 0 44.808-20.068 44.808-44.808V141.325a26.134 26.134 0 00-7.627-18.461zm-68.356 262.802c0 14.434-11.703 26.154-26.168 26.154H102.137c-14.451 0-26.153-11.722-26.153-26.154V249.303c0-14.43 11.702-26.148 26.153-26.148h284.156c14.465 0 26.168 11.72 26.168 26.148v136.363z"/><path d="M356.497 265.131H131.949c-9.008 0-16.294 7.273-16.294 16.28s7.286 16.28 16.294 16.28h224.549c8.988 0 16.277-7.273 16.277-16.28s-7.288-16.28-16.278-16.28zM323.936 330.264H164.508c-8.994 0-16.28 7.273-16.28 16.28 0 8.989 7.286 16.28 16.28 16.28h159.427c8.994 0 16.281-7.291 16.281-16.28.001-9.007-7.286-16.28-16.28-16.28z"/></g></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-save, .x-window .x-toolbar .x-btn-text.action-save, .x-menu.light .x-menu-item-icon.action-save, .invert-menu-bg .x-menu-item-icon.action-save {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488.446 488.446"><g fill="%23\${COLOR_TOOLS_BG_NOHASH}"><path d="M153.029 90.223h182.404c5.427 0 9.873-4.43 9.873-9.869V0H143.137v80.354c0 5.439 4.434 9.869 9.892 9.869z"/><path d="M480.817 122.864L377.88 19.494v60.859c0 23.404-19.043 42.447-42.447 42.447H153.029c-23.409 0-42.447-19.043-42.447-42.447V0H44.823C20.068 0 .002 20.07.002 44.808v398.831c0 24.736 20.066 44.808 44.821 44.808h398.813c24.74 0 44.808-20.068 44.808-44.808V141.325a26.134 26.134 0 00-7.627-18.461zm-68.356 262.802c0 14.434-11.703 26.154-26.168 26.154H102.137c-14.451 0-26.153-11.722-26.153-26.154V249.303c0-14.43 11.702-26.148 26.153-26.148h284.156c14.465 0 26.168 11.72 26.168 26.148v136.363z"/><path d="M356.497 265.131H131.949c-9.008 0-16.294 7.273-16.294 16.28s7.286 16.28 16.294 16.28h224.549c8.988 0 16.277-7.273 16.277-16.28s-7.288-16.28-16.278-16.28zM323.936 330.264H164.508c-8.994 0-16.28 7.273-16.28 16.28 0 8.989 7.286 16.28 16.28 16.28h159.427c8.994 0 16.281-7.291 16.281-16.28.001-9.007-7.286-16.28-16.28-16.28z"/></g></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-save, .x-toolbar .x-btn-menu-active .x-btn-text.action-save, .x-menu-item-active .x-menu-item-icon.action-save, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-save {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488.446 488.446"><g fill="%23\${COLOR_TOOLS_HIGH_NOHASH}"><path d="M153.029 90.223h182.404c5.427 0 9.873-4.43 9.873-9.869V0H143.137v80.354c0 5.439 4.434 9.869 9.892 9.869z"/><path d="M480.817 122.864L377.88 19.494v60.859c0 23.404-19.043 42.447-42.447 42.447H153.029c-23.409 0-42.447-19.043-42.447-42.447V0H44.823C20.068 0 .002 20.07.002 44.808v398.831c0 24.736 20.066 44.808 44.821 44.808h398.813c24.74 0 44.808-20.068 44.808-44.808V141.325a26.134 26.134 0 00-7.627-18.461zm-68.356 262.802c0 14.434-11.703 26.154-26.168 26.154H102.137c-14.451 0-26.153-11.722-26.153-26.154V249.303c0-14.43 11.702-26.148 26.153-26.148h284.156c14.465 0 26.168 11.72 26.168 26.148v136.363z"/><path d="M356.497 265.131H131.949c-9.008 0-16.294 7.273-16.294 16.28s7.286 16.28 16.294 16.28h224.549c8.988 0 16.277-7.273 16.277-16.28s-7.288-16.28-16.278-16.28zM323.936 330.264H164.508c-8.994 0-16.28 7.273-16.28 16.28 0 8.989 7.286 16.28 16.28 16.28h159.427c8.994 0 16.281-7.291 16.281-16.28.001-9.007-7.286-16.28-16.28-16.28z"/></g></svg>')!important;}`)
    .add(`.x-btn-text.action-settings, .x-menu-item .action-settings {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M487.4 315.7l-42.6-24.6c4.3-23.2 4.3-47 0-70.2l42.6-24.6c4.9-2.8 7.1-8.6 5.5-14-11.1-35.6-30-67.8-54.7-94.6-3.8-4.1-10-5.1-14.8-2.3L380.8 110c-17.9-15.4-38.5-27.3-60.8-35.1V25.8c0-5.6-3.9-10.5-9.4-11.7-36.7-8.2-74.3-7.8-109.2 0-5.5 1.2-9.4 6.1-9.4 11.7V75c-22.2 7.9-42.8 19.8-60.8 35.1L88.7 85.5c-4.9-2.8-11-1.9-14.8 2.3-24.7 26.7-43.6 58.9-54.7 94.6-1.7 5.4.6 11.2 5.5 14L67.3 221c-4.3 23.2-4.3 47 0 70.2l-42.6 24.6c-4.9 2.8-7.1 8.6-5.5 14 11.1 35.6 30 67.8 54.7 94.6 3.8 4.1 10 5.1 14.8 2.3l42.6-24.6c17.9 15.4 38.5 27.3 60.8 35.1v49.2c0 5.6 3.9 10.5 9.4 11.7 36.7 8.2 74.3 7.8 109.2 0 5.5-1.2 9.4-6.1 9.4-11.7v-49.2c22.2-7.9 42.8-19.8 60.8-35.1l42.6 24.6c4.9 2.8 11 1.9 14.8-2.3 24.7-26.7 43.6-58.9 54.7-94.6 1.5-5.5-.7-11.3-5.6-14.1zM256 336c-44.1 0-80-35.9-80-80s35.9-80 80-80 80 35.9 80 80-35.9 80-80 80z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-settings, .x-window .x-toolbar .x-btn-text.action-settings, .x-menu.light .x-menu-item-icon.action-settings, .invert-menu-bg .x-menu-item-icon.action-settings {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M487.4 315.7l-42.6-24.6c4.3-23.2 4.3-47 0-70.2l42.6-24.6c4.9-2.8 7.1-8.6 5.5-14-11.1-35.6-30-67.8-54.7-94.6-3.8-4.1-10-5.1-14.8-2.3L380.8 110c-17.9-15.4-38.5-27.3-60.8-35.1V25.8c0-5.6-3.9-10.5-9.4-11.7-36.7-8.2-74.3-7.8-109.2 0-5.5 1.2-9.4 6.1-9.4 11.7V75c-22.2 7.9-42.8 19.8-60.8 35.1L88.7 85.5c-4.9-2.8-11-1.9-14.8 2.3-24.7 26.7-43.6 58.9-54.7 94.6-1.7 5.4.6 11.2 5.5 14L67.3 221c-4.3 23.2-4.3 47 0 70.2l-42.6 24.6c-4.9 2.8-7.1 8.6-5.5 14 11.1 35.6 30 67.8 54.7 94.6 3.8 4.1 10 5.1 14.8 2.3l42.6-24.6c17.9 15.4 38.5 27.3 60.8 35.1v49.2c0 5.6 3.9 10.5 9.4 11.7 36.7 8.2 74.3 7.8 109.2 0 5.5-1.2 9.4-6.1 9.4-11.7v-49.2c22.2-7.9 42.8-19.8 60.8-35.1l42.6 24.6c4.9 2.8 11 1.9 14.8-2.3 24.7-26.7 43.6-58.9 54.7-94.6 1.5-5.5-.7-11.3-5.6-14.1zM256 336c-44.1 0-80-35.9-80-80s35.9-80 80-80 80 35.9 80 80-35.9 80-80 80z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-settings, .x-toolbar .x-btn-menu-active .x-btn-text.action-settings, .x-menu-item-active .x-menu-item-icon.action-settings, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-settings {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M487.4 315.7l-42.6-24.6c4.3-23.2 4.3-47 0-70.2l42.6-24.6c4.9-2.8 7.1-8.6 5.5-14-11.1-35.6-30-67.8-54.7-94.6-3.8-4.1-10-5.1-14.8-2.3L380.8 110c-17.9-15.4-38.5-27.3-60.8-35.1V25.8c0-5.6-3.9-10.5-9.4-11.7-36.7-8.2-74.3-7.8-109.2 0-5.5 1.2-9.4 6.1-9.4 11.7V75c-22.2 7.9-42.8 19.8-60.8 35.1L88.7 85.5c-4.9-2.8-11-1.9-14.8 2.3-24.7 26.7-43.6 58.9-54.7 94.6-1.7 5.4.6 11.2 5.5 14L67.3 221c-4.3 23.2-4.3 47 0 70.2l-42.6 24.6c-4.9 2.8-7.1 8.6-5.5 14 11.1 35.6 30 67.8 54.7 94.6 3.8 4.1 10 5.1 14.8 2.3l42.6-24.6c17.9 15.4 38.5 27.3 60.8 35.1v49.2c0 5.6 3.9 10.5 9.4 11.7 36.7 8.2 74.3 7.8 109.2 0 5.5-1.2 9.4-6.1 9.4-11.7v-49.2c22.2-7.9 42.8-19.8 60.8-35.1l42.6 24.6c4.9 2.8 11 1.9 14.8-2.3 24.7-26.7 43.6-58.9 54.7-94.6 1.5-5.5-.7-11.3-5.6-14.1zM256 336c-44.1 0-80-35.9-80-80s35.9-80 80-80 80 35.9 80 80-35.9 80-80 80z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-sorting-alpha, .x-menu-item .action-sorting-alpha {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M8 4h8a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2zM8 19h20a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2zM8 34h32a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-sorting-alpha, .x-window .x-toolbar .x-btn-text.action-sorting-alpha, .x-menu.light .x-menu-item-icon.action-sorting-alpha, .invert-menu-bg .x-menu-item-icon.action-sorting-alpha {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M8 4h8a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2zM8 19h20a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2zM8 34h32a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-sorting-alpha, .x-toolbar .x-btn-menu-active .x-btn-text.action-sorting-alpha, .x-menu-item-active .x-menu-item-icon.action-sorting-alpha, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-sorting-alpha {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M8 4h8a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2zM8 19h20a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2zM8 34h32a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-sorting-default, .x-menu-item .action-sorting-default {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M8 4h32a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2zM8 19h8a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2zM8 34h20a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-sorting-default, .x-window .x-toolbar .x-btn-text.action-sorting-default, .x-menu.light .x-menu-item-icon.action-sorting-default, .invert-menu-bg .x-menu-item-icon.action-sorting-default {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M8 4h32a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2zM8 19h8a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2zM8 34h20a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-sorting-default, .x-toolbar .x-btn-menu-active .x-btn-text.action-sorting-default, .x-menu-item-active .x-menu-item-icon.action-sorting-default, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-sorting-default {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M8 4h32a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2zM8 19h8a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2zM8 34h20a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-tools, .x-menu-item .action-tools {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M501.1 395.7L384 278.6c-23.1-23.1-57.6-27.6-85.4-13.9L192 158.1V96L64 0 0 64l96 128h62.1l106.6 106.6c-13.6 27.8-9.2 62.3 13.9 85.4l117.1 117.1c14.6 14.6 38.2 14.6 52.7 0l52.7-52.7c14.5-14.6 14.5-38.2 0-52.7zM331.7 225c28.3 0 54.9 11 74.9 31l19.4 19.4c15.8-6.9 30.8-16.5 43.8-29.5 37.1-37.1 49.7-89.3 37.9-136.7-2.2-9-13.5-12.1-20.1-5.5l-74.4 74.4-67.9-11.3L334 98.9l74.4-74.4c6.6-6.6 3.4-17.9-5.7-20.2-47.4-11.7-99.6.9-136.6 37.9-28.5 28.5-41.9 66.1-41.2 103.6l82.1 82.1c8.1-1.9 16.5-2.9 24.7-2.9zm-103.9 82l-56.7-56.7L18.7 402.8c-25 25-25 65.5 0 90.5s65.5 25 90.5 0l123.6-123.6c-7.6-19.9-9.9-41.6-5-62.7zM64 472c-13.2 0-24-10.8-24-24 0-13.3 10.7-24 24-24s24 10.7 24 24c0 13.2-10.7 24-24 24z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-tools, .x-window .x-toolbar .x-btn-text.action-tools, .x-menu.light .x-menu-item-icon.action-tools, .invert-menu-bg .x-menu-item-icon.action-tools {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M501.1 395.7L384 278.6c-23.1-23.1-57.6-27.6-85.4-13.9L192 158.1V96L64 0 0 64l96 128h62.1l106.6 106.6c-13.6 27.8-9.2 62.3 13.9 85.4l117.1 117.1c14.6 14.6 38.2 14.6 52.7 0l52.7-52.7c14.5-14.6 14.5-38.2 0-52.7zM331.7 225c28.3 0 54.9 11 74.9 31l19.4 19.4c15.8-6.9 30.8-16.5 43.8-29.5 37.1-37.1 49.7-89.3 37.9-136.7-2.2-9-13.5-12.1-20.1-5.5l-74.4 74.4-67.9-11.3L334 98.9l74.4-74.4c6.6-6.6 3.4-17.9-5.7-20.2-47.4-11.7-99.6.9-136.6 37.9-28.5 28.5-41.9 66.1-41.2 103.6l82.1 82.1c8.1-1.9 16.5-2.9 24.7-2.9zm-103.9 82l-56.7-56.7L18.7 402.8c-25 25-25 65.5 0 90.5s65.5 25 90.5 0l123.6-123.6c-7.6-19.9-9.9-41.6-5-62.7zM64 472c-13.2 0-24-10.8-24-24 0-13.3 10.7-24 24-24s24 10.7 24 24c0 13.2-10.7 24-24 24z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-tools, .x-toolbar .x-btn-menu-active .x-btn-text.action-tools, .x-menu-item-active .x-menu-item-icon.action-tools, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-tools {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M501.1 395.7L384 278.6c-23.1-23.1-57.6-27.6-85.4-13.9L192 158.1V96L64 0 0 64l96 128h62.1l106.6 106.6c-13.6 27.8-9.2 62.3 13.9 85.4l117.1 117.1c14.6 14.6 38.2 14.6 52.7 0l52.7-52.7c14.5-14.6 14.5-38.2 0-52.7zM331.7 225c28.3 0 54.9 11 74.9 31l19.4 19.4c15.8-6.9 30.8-16.5 43.8-29.5 37.1-37.1 49.7-89.3 37.9-136.7-2.2-9-13.5-12.1-20.1-5.5l-74.4 74.4-67.9-11.3L334 98.9l74.4-74.4c6.6-6.6 3.4-17.9-5.7-20.2-47.4-11.7-99.6.9-136.6 37.9-28.5 28.5-41.9 66.1-41.2 103.6l82.1 82.1c8.1-1.9 16.5-2.9 24.7-2.9zm-103.9 82l-56.7-56.7L18.7 402.8c-25 25-25 65.5 0 90.5s65.5 25 90.5 0l123.6-123.6c-7.6-19.9-9.9-41.6-5-62.7zM64 472c-13.2 0-24-10.8-24-24 0-13.3 10.7-24 24-24s24 10.7 24 24c0 13.2-10.7 24-24 24z"/></svg>')!important;}`)
    .add(`.x-btn-text.action-upload, .x-menu-item .action-upload {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M528 288H384v-32h64c42.6 0 64.2-51.7 33.9-81.9l-160-160c-18.8-18.8-49.1-18.7-67.9 0l-160 160c-30.1 30.1-8.7 81.9 34 81.9h64v32H48c-26.5 0-48 21.5-48 48v128c0 26.5 21.5 48 48 48h480c26.5 0 48-21.5 48-48V336c0-26.5-21.5-48-48-48zm-400-80L288 48l160 160H336v160h-96V208H128zm400 256H48V336h144v32c0 26.5 21.5 48 48 48h96c26.5 0 48-21.5 48-48v-32h144v128zm-40-64c0 13.3-10.7 24-24 24s-24-10.7-24-24 10.7-24 24-24 24 10.7 24 24z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.action-upload, .x-window .x-toolbar .x-btn-text.action-upload, .x-menu.light .x-menu-item-icon.action-upload, .invert-menu-bg .x-menu-item-icon.action-upload {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M528 288H384v-32h64c42.6 0 64.2-51.7 33.9-81.9l-160-160c-18.8-18.8-49.1-18.7-67.9 0l-160 160c-30.1 30.1-8.7 81.9 34 81.9h64v32H48c-26.5 0-48 21.5-48 48v128c0 26.5 21.5 48 48 48h480c26.5 0 48-21.5 48-48V336c0-26.5-21.5-48-48-48zm-400-80L288 48l160 160H336v160h-96V208H128zm400 256H48V336h144v32c0 26.5 21.5 48 48 48h96c26.5 0 48-21.5 48-48v-32h144v128zm-40-64c0 13.3-10.7 24-24 24s-24-10.7-24-24 10.7-24 24-24 24 10.7 24 24z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.action-upload, .x-toolbar .x-btn-menu-active .x-btn-text.action-upload, .x-menu-item-active .x-menu-item-icon.action-upload, .x-menu.light .x-menu-item-active .x-menu-item-icon.action-upload {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M528 288H384v-32h64c42.6 0 64.2-51.7 33.9-81.9l-160-160c-18.8-18.8-49.1-18.7-67.9 0l-160 160c-30.1 30.1-8.7 81.9 34 81.9h64v32H48c-26.5 0-48 21.5-48 48v128c0 26.5 21.5 48 48 48h480c26.5 0 48-21.5 48-48V336c0-26.5-21.5-48-48-48zm-400-80L288 48l160 160H336v160h-96V208H128zm400 256H48V336h144v32c0 26.5 21.5 48 48 48h96c26.5 0 48-21.5 48-48v-32h144v128zm-40-64c0 13.3-10.7 24-24 24s-24-10.7-24-24 10.7-24 24-24 24 10.7 24 24z"/></svg>')!important;}`)
    .add(`.x-btn-text.nav-damadmin, .x-menu-item .nav-damadmin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M512 144v288c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V144c0-26.5 21.5-48 48-48h88l12.3-32.9c7-18.7 24.9-31.1 44.9-31.1h125.5c20 0 37.9 12.4 44.9 31.1L376 96h88c26.5 0 48 21.5 48 48zM376 288c0-66.2-53.8-120-120-120s-120 53.8-120 120 53.8 120 120 120 120-53.8 120-120zm-32 0c0 48.5-39.5 88-88 88s-88-39.5-88-88 39.5-88 88-88 88 39.5 88 88z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.nav-damadmin, .x-window .x-toolbar .x-btn-text.nav-damadmin, .x-menu.light .x-menu-item-icon.nav-damadmin, .invert-menu-bg .x-menu-item-icon.nav-damadmin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M512 144v288c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V144c0-26.5 21.5-48 48-48h88l12.3-32.9c7-18.7 24.9-31.1 44.9-31.1h125.5c20 0 37.9 12.4 44.9 31.1L376 96h88c26.5 0 48 21.5 48 48zM376 288c0-66.2-53.8-120-120-120s-120 53.8-120 120 53.8 120 120 120 120-53.8 120-120zm-32 0c0 48.5-39.5 88-88 88s-88-39.5-88-88 39.5-88 88-88 88 39.5 88 88z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.nav-damadmin, .x-toolbar .x-btn-menu-active .x-btn-text.nav-damadmin, .x-menu-item-active .x-menu-item-icon.nav-damadmin, .x-menu.light .x-menu-item-active .x-menu-item-icon.nav-damadmin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M512 144v288c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V144c0-26.5 21.5-48 48-48h88l12.3-32.9c7-18.7 24.9-31.1 44.9-31.1h125.5c20 0 37.9 12.4 44.9 31.1L376 96h88c26.5 0 48 21.5 48 48zM376 288c0-66.2-53.8-120-120-120s-120 53.8-120 120 53.8 120 120 120 120-53.8 120-120zm-32 0c0 48.5-39.5 88-88 88s-88-39.5-88-88 39.5-88 88-88 88 39.5 88 88z"/></svg>')!important;}`)
    .add(`.x-btn-text.nav-miscadmin, .x-menu-item .nav-miscadmin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M502.63 214.63l-45.25-45.25c-6-6-14.14-9.37-22.63-9.37H384V80c0-26.51-21.49-48-48-48H176c-26.51 0-48 21.49-48 48v80H77.25c-8.49 0-16.62 3.37-22.63 9.37L9.37 214.63c-6 6-9.37 14.14-9.37 22.63V320h128v-16c0-8.84 7.16-16 16-16h32c8.84 0 16 7.16 16 16v16h128v-16c0-8.84 7.16-16 16-16h32c8.84 0 16 7.16 16 16v16h128v-82.75c0-8.48-3.37-16.62-9.37-22.62zM320 160H192V96h128v64zm64 208c0 8.84-7.16 16-16 16h-32c-8.84 0-16-7.16-16-16v-16H192v16c0 8.84-7.16 16-16 16h-32c-8.84 0-16-7.16-16-16v-16H0v96c0 17.67 14.33 32 32 32h448c17.67 0 32-14.33 32-32v-96H384v16z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.nav-miscadmin, .x-window .x-toolbar .x-btn-text.nav-miscadmin, .x-menu.light .x-menu-item-icon.nav-miscadmin, .invert-menu-bg .x-menu-item-icon.nav-miscadmin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M502.63 214.63l-45.25-45.25c-6-6-14.14-9.37-22.63-9.37H384V80c0-26.51-21.49-48-48-48H176c-26.51 0-48 21.49-48 48v80H77.25c-8.49 0-16.62 3.37-22.63 9.37L9.37 214.63c-6 6-9.37 14.14-9.37 22.63V320h128v-16c0-8.84 7.16-16 16-16h32c8.84 0 16 7.16 16 16v16h128v-16c0-8.84 7.16-16 16-16h32c8.84 0 16 7.16 16 16v16h128v-82.75c0-8.48-3.37-16.62-9.37-22.62zM320 160H192V96h128v64zm64 208c0 8.84-7.16 16-16 16h-32c-8.84 0-16-7.16-16-16v-16H192v16c0 8.84-7.16 16-16 16h-32c-8.84 0-16-7.16-16-16v-16H0v96c0 17.67 14.33 32 32 32h448c17.67 0 32-14.33 32-32v-96H384v16z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.nav-miscadmin, .x-toolbar .x-btn-menu-active .x-btn-text.nav-miscadmin, .x-menu-item-active .x-menu-item-icon.nav-miscadmin, .x-menu.light .x-menu-item-active .x-menu-item-icon.nav-miscadmin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M502.63 214.63l-45.25-45.25c-6-6-14.14-9.37-22.63-9.37H384V80c0-26.51-21.49-48-48-48H176c-26.51 0-48 21.49-48 48v80H77.25c-8.49 0-16.62 3.37-22.63 9.37L9.37 214.63c-6 6-9.37 14.14-9.37 22.63V320h128v-16c0-8.84 7.16-16 16-16h32c8.84 0 16 7.16 16 16v16h128v-16c0-8.84 7.16-16 16-16h32c8.84 0 16 7.16 16 16v16h128v-82.75c0-8.48-3.37-16.62-9.37-22.62zM320 160H192V96h128v64zm64 208c0 8.84-7.16 16-16 16h-32c-8.84 0-16-7.16-16-16v-16H192v16c0 8.84-7.16 16-16 16h-32c-8.84 0-16-7.16-16-16v-16H0v96c0 17.67 14.33 32 32 32h448c17.67 0 32-14.33 32-32v-96H384v16z"/></svg>')!important;}`)
    .add(`.x-btn-text.nav-package, .x-menu-item .nav-package {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M425.7 256c-16.9 0-32.8-9-41.4-23.4L320 126l-64.2 106.6c-8.7 14.5-24.6 23.5-41.5 23.5-4.5 0-9-.6-13.3-1.9L64 215v278c0 14.7 10 27.5 24.2 31l216.2 54.1c10.2 2.5 20.9 2.5 31 0L551.8 524c14.2-3.6 24.2-16.4 24.2-31V215l-137 39.1c-4.3 1.3-8.8 1.9-13.3 1.9zm212.6-112.2L586.8 41c-3.1-6.2-9.8-9.8-16.7-8.9L320 64l91.7 152.1c3.8 6.3 11.4 9.3 18.5 7.3l197.9-56.5c9.9-2.9 14.7-13.9 10.2-23.1zM53.2 41L1.7 143.8c-4.6 9.2.3 20.2 10.1 23l197.9 56.5c7.1 2 14.7-1 18.5-7.3L320 64 69.8 32.1c-6.9-.8-13.5 2.7-16.6 8.9z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.nav-package, .x-window .x-toolbar .x-btn-text.nav-package, .x-menu.light .x-menu-item-icon.nav-package, .invert-menu-bg .x-menu-item-icon.nav-package {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M425.7 256c-16.9 0-32.8-9-41.4-23.4L320 126l-64.2 106.6c-8.7 14.5-24.6 23.5-41.5 23.5-4.5 0-9-.6-13.3-1.9L64 215v278c0 14.7 10 27.5 24.2 31l216.2 54.1c10.2 2.5 20.9 2.5 31 0L551.8 524c14.2-3.6 24.2-16.4 24.2-31V215l-137 39.1c-4.3 1.3-8.8 1.9-13.3 1.9zm212.6-112.2L586.8 41c-3.1-6.2-9.8-9.8-16.7-8.9L320 64l91.7 152.1c3.8 6.3 11.4 9.3 18.5 7.3l197.9-56.5c9.9-2.9 14.7-13.9 10.2-23.1zM53.2 41L1.7 143.8c-4.6 9.2.3 20.2 10.1 23l197.9 56.5c7.1 2 14.7-1 18.5-7.3L320 64 69.8 32.1c-6.9-.8-13.5 2.7-16.6 8.9z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.nav-package, .x-toolbar .x-btn-menu-active .x-btn-text.nav-package, .x-menu-item-active .x-menu-item-icon.nav-package, .x-menu.light .x-menu-item-active .x-menu-item-icon.nav-package {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M425.7 256c-16.9 0-32.8-9-41.4-23.4L320 126l-64.2 106.6c-8.7 14.5-24.6 23.5-41.5 23.5-4.5 0-9-.6-13.3-1.9L64 215v278c0 14.7 10 27.5 24.2 31l216.2 54.1c10.2 2.5 20.9 2.5 31 0L551.8 524c14.2-3.6 24.2-16.4 24.2-31V215l-137 39.1c-4.3 1.3-8.8 1.9-13.3 1.9zm212.6-112.2L586.8 41c-3.1-6.2-9.8-9.8-16.7-8.9L320 64l91.7 152.1c3.8 6.3 11.4 9.3 18.5 7.3l197.9-56.5c9.9-2.9 14.7-13.9 10.2-23.1zM53.2 41L1.7 143.8c-4.6 9.2.3 20.2 10.1 23l197.9 56.5c7.1 2 14.7-1 18.5-7.3L320 64 69.8 32.1c-6.9-.8-13.5 2.7-16.6 8.9z"/></svg>')!important;}`)
    .add(`.x-btn-text.nav-siteadmin, .x-menu-item .nav-siteadmin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 496 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M336.5 160C322 70.7 287.8 8 248 8s-74 62.7-88.5 152h177zM152 256c0 22.2 1.2 43.5 3.3 64h185.3c2.1-20.5 3.3-41.8 3.3-64s-1.2-43.5-3.3-64H155.3c-2.1 20.5-3.3 41.8-3.3 64zm324.7-96c-28.6-67.9-86.5-120.4-158-141.6 24.4 33.8 41.2 84.7 50 141.6h108zM177.2 18.4C105.8 39.6 47.8 92.1 19.3 160h108c8.7-56.9 25.5-107.8 49.9-141.6zM487.4 192H372.7c2.1 21 3.3 42.5 3.3 64s-1.2 43-3.3 64h114.6c5.5-20.5 8.6-41.8 8.6-64s-3.1-43.5-8.5-64zM120 256c0-21.5 1.2-43 3.3-64H8.6C3.2 212.5 0 233.8 0 256s3.2 43.5 8.6 64h114.6c-2-21-3.2-42.5-3.2-64zm39.5 96c14.5 89.3 48.7 152 88.5 152s74-62.7 88.5-152h-177zm159.3 141.6c71.4-21.2 129.4-73.7 158-141.6h-108c-8.8 56.9-25.6 107.8-50 141.6zM19.3 352c28.6 67.9 86.5 120.4 158 141.6-24.4-33.8-41.2-84.7-50-141.6h-108z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.nav-siteadmin, .x-window .x-toolbar .x-btn-text.nav-siteadmin, .x-menu.light .x-menu-item-icon.nav-siteadmin, .invert-menu-bg .x-menu-item-icon.nav-siteadmin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 496 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M336.5 160C322 70.7 287.8 8 248 8s-74 62.7-88.5 152h177zM152 256c0 22.2 1.2 43.5 3.3 64h185.3c2.1-20.5 3.3-41.8 3.3-64s-1.2-43.5-3.3-64H155.3c-2.1 20.5-3.3 41.8-3.3 64zm324.7-96c-28.6-67.9-86.5-120.4-158-141.6 24.4 33.8 41.2 84.7 50 141.6h108zM177.2 18.4C105.8 39.6 47.8 92.1 19.3 160h108c8.7-56.9 25.5-107.8 49.9-141.6zM487.4 192H372.7c2.1 21 3.3 42.5 3.3 64s-1.2 43-3.3 64h114.6c5.5-20.5 8.6-41.8 8.6-64s-3.1-43.5-8.5-64zM120 256c0-21.5 1.2-43 3.3-64H8.6C3.2 212.5 0 233.8 0 256s3.2 43.5 8.6 64h114.6c-2-21-3.2-42.5-3.2-64zm39.5 96c14.5 89.3 48.7 152 88.5 152s74-62.7 88.5-152h-177zm159.3 141.6c71.4-21.2 129.4-73.7 158-141.6h-108c-8.8 56.9-25.6 107.8-50 141.6zM19.3 352c28.6 67.9 86.5 120.4 158 141.6-24.4-33.8-41.2-84.7-50-141.6h-108z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.nav-siteadmin, .x-toolbar .x-btn-menu-active .x-btn-text.nav-siteadmin, .x-menu-item-active .x-menu-item-icon.nav-siteadmin, .x-menu.light .x-menu-item-active .x-menu-item-icon.nav-siteadmin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 496 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M336.5 160C322 70.7 287.8 8 248 8s-74 62.7-88.5 152h177zM152 256c0 22.2 1.2 43.5 3.3 64h185.3c2.1-20.5 3.3-41.8 3.3-64s-1.2-43.5-3.3-64H155.3c-2.1 20.5-3.3 41.8-3.3 64zm324.7-96c-28.6-67.9-86.5-120.4-158-141.6 24.4 33.8 41.2 84.7 50 141.6h108zM177.2 18.4C105.8 39.6 47.8 92.1 19.3 160h108c8.7-56.9 25.5-107.8 49.9-141.6zM487.4 192H372.7c2.1 21 3.3 42.5 3.3 64s-1.2 43-3.3 64h114.6c5.5-20.5 8.6-41.8 8.6-64s-3.1-43.5-8.5-64zM120 256c0-21.5 1.2-43 3.3-64H8.6C3.2 212.5 0 233.8 0 256s3.2 43.5 8.6 64h114.6c-2-21-3.2-42.5-3.2-64zm39.5 96c14.5 89.3 48.7 152 88.5 152s74-62.7 88.5-152h-177zm159.3 141.6c71.4-21.2 129.4-73.7 158-141.6h-108c-8.8 56.9-25.6 107.8-50 141.6zM19.3 352c28.6 67.9 86.5 120.4 158 141.6-24.4-33.8-41.2-84.7-50-141.6h-108z"/></svg>')!important;}`)
    .add(`.x-btn-text.nav-useradmin, .x-menu-item .nav-useradmin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M224 256c70.7 0 128-57.3 128-128S294.7 0 224 0 96 57.3 96 128s57.3 128 128 128zm89.6 32h-16.7c-22.2 10.2-46.9 16-72.9 16s-50.6-5.8-72.9-16h-16.7C60.2 288 0 348.2 0 422.4V464c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48v-41.6c0-74.2-60.2-134.4-134.4-134.4z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.nav-useradmin, .x-window .x-toolbar .x-btn-text.nav-useradmin, .x-menu.light .x-menu-item-icon.nav-useradmin, .invert-menu-bg .x-menu-item-icon.nav-useradmin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M224 256c70.7 0 128-57.3 128-128S294.7 0 224 0 96 57.3 96 128s57.3 128 128 128zm89.6 32h-16.7c-22.2 10.2-46.9 16-72.9 16s-50.6-5.8-72.9-16h-16.7C60.2 288 0 348.2 0 422.4V464c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48v-41.6c0-74.2-60.2-134.4-134.4-134.4z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.nav-useradmin, .x-toolbar .x-btn-menu-active .x-btn-text.nav-useradmin, .x-menu-item-active .x-menu-item-icon.nav-useradmin, .x-menu.light .x-menu-item-active .x-menu-item-icon.nav-useradmin {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M224 256c70.7 0 128-57.3 128-128S294.7 0 224 0 96 57.3 96 128s57.3 128 128 128zm89.6 32h-16.7c-22.2 10.2-46.9 16-72.9 16s-50.6-5.8-72.9-16h-16.7C60.2 288 0 348.2 0 422.4V464c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48v-41.6c0-74.2-60.2-134.4-134.4-134.4z"/></svg>')!important;}`)
    .add(`.x-btn-text.query, .x-menu-item .query {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_FG_NOHASH}" d="M505 442.7L405.3 343c-4.5-4.5-10.6-7-17-7H372c27.6-35.3 44-79.7 44-128C416 93.1 322.9 0 208 0S0 93.1 0 208s93.1 208 208 208c48.3 0 92.7-16.4 128-44v16.3c0 6.4 2.5 12.5 7 17l99.7 99.7c9.4 9.4 24.6 9.4 33.9 0l28.3-28.3c9.4-9.4 9.4-24.6.1-34zM208 336c-70.7 0-128-57.2-128-128 0-70.7 57.2-128 128-128 70.7 0 128 57.2 128 128 0 70.7-57.2 128-128 128z"/></svg>')!important;}`)
    .add(`.x-toolbar.light .x-btn-text.query, .x-window .x-toolbar .x-btn-text.query, .x-menu.light .x-menu-item-icon.query, .invert-menu-bg .x-menu-item-icon.query {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M505 442.7L405.3 343c-4.5-4.5-10.6-7-17-7H372c27.6-35.3 44-79.7 44-128C416 93.1 322.9 0 208 0S0 93.1 0 208s93.1 208 208 208c48.3 0 92.7-16.4 128-44v16.3c0 6.4 2.5 12.5 7 17l99.7 99.7c9.4 9.4 24.6 9.4 33.9 0l28.3-28.3c9.4-9.4 9.4-24.6.1-34zM208 336c-70.7 0-128-57.2-128-128 0-70.7 57.2-128 128-128 70.7 0 128 57.2 128 128 0 70.7-57.2 128-128 128z"/></svg>')!important;}`)
    .add(`.x-toolbar .x-btn-over .x-btn-text.query, .x-toolbar .x-btn-menu-active .x-btn-text.query, .x-menu-item-active .x-menu-item-icon.query, .x-menu.light .x-menu-item-active .x-menu-item-icon.query {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23\${COLOR_TOOLS_HIGH_NOHASH}" d="M505 442.7L405.3 343c-4.5-4.5-10.6-7-17-7H372c27.6-35.3 44-79.7 44-128C416 93.1 322.9 0 208 0S0 93.1 0 208s93.1 208 208 208c48.3 0 92.7-16.4 128-44v16.3c0 6.4 2.5 12.5 7 17l99.7 99.7c9.4 9.4 24.6 9.4 33.9 0l28.3-28.3c9.4-9.4 9.4-24.6.1-34zM208 336c-70.7 0-128-57.2-128-128 0-70.7 57.2-128 128-128 70.7 0 128 57.2 128 128 0 70.7-57.2 128-128 128z"/></svg>')!important;}`)
    .add(`.highlight-yellow>.x-tree-node-anchor span {background-color:#FFFF00;} .x-menu-item-icon.action-highlight-yellow {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23FFFF00" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.highlight-peach>.x-tree-node-anchor span {background-color:#FFDAB9;} .x-menu-item-icon.action-highlight-peach {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23FFDAB9" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.highlight-orange>.x-tree-node-anchor span {background-color:#FFC989;} .x-menu-item-icon.action-highlight-orange {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23FFC989" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.highlight-pale-green>.x-tree-node-anchor span {background-color:#B4FFB4;} .x-menu-item-icon.action-highlight-pale-green {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23B4FFB4" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.highlight-green>.x-tree-node-anchor span {background-color:#7FFF00;} .x-menu-item-icon.action-highlight-green {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%237FFF00" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.highlight-pink>.x-tree-node-anchor span {background-color:#FFB6C1;} .x-menu-item-icon.action-highlight-pink {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23FFB6C1" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.highlight-salmon>.x-tree-node-anchor span {background-color:#FA8072;} .x-menu-item-icon.action-highlight-salmon {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23FA8072" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.highlight-lavender>.x-tree-node-anchor span {background-color:#DFDFFF;} .x-menu-item-icon.action-highlight-lavender {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23DFDFFF" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.highlight-blue>.x-tree-node-anchor span {background-color:#ADD8FF;} .x-menu-item-icon.action-highlight-blue {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23ADD8FF" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.highlight-gray>.x-tree-node-anchor span {background-color:#CCCCCC;} .x-menu-item-icon.action-highlight-gray {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23CCCCCC" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.highlight-orchid>.x-tree-node-anchor span {background-color:#F9B0F9;} .x-menu-item-icon.action-highlight-orchid {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23F9B0F9" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.highlight-violet>.x-tree-node-anchor span {background-color:#EE82EE;} .x-menu-item-icon.action-highlight-violet {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23EE82EE" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.highlight-tan>.x-tree-node-anchor span {background-color:#D2B48C;} .x-menu-item-icon.action-highlight-tan {background: no-repeat url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23D2B48C" d="M0 0 h512 v512 h-512 Z"/></svg>');}`)
    .add(`.x-tree-node-el.sorted>.x-tree-node-anchor:after {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M8 4h8a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2zM8 19h20a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2zM8 34h32a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2z"/></svg>');}`)
    .add(`.x-tree-node-el.drag>.x-tree-node-anchor:after {background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="%23\${COLOR_TOOLS_BG_NOHASH}" d="M448 344v112a23.94 23.94 0 01-24 24H312c-21.39 0-32.09-25.9-17-41l36.2-36.2L224 295.6 116.77 402.9 153 439c15.09 15.1 4.39 41-17 41H24a23.94 23.94 0 01-24-24V344c0-21.4 25.89-32.1 41-17l36.19 36.2L184.46 256 77.18 148.7 41 185c-15.1 15.1-41 4.4-41-17V56a23.94 23.94 0 0124-24h112c21.39 0 32.09 25.9 17 41l-36.2 36.2L224 216.4l107.23-107.3L295 73c-15.09-15.1-4.39-41 17-41h112a23.94 23.94 0 0124 24v112c0 21.4-25.89 32.1-41 17l-36.19-36.2L263.54 256l107.28 107.3L407 327.1c15.1-15.2 41-4.5 41 16.9z"/></svg>');}`);

CRXB.flows.common = function () {
    CRXB.tweaks.applyStyles('splash');

    const regulator = new CrxRegulator();
    regulator.blockExternal(/(BuildInfoPanel|DebugTrackingAction|ImportSiteAction|PreferencesDialog)\.js/);
    regulator.blockExternal(/extjs-theme\/css\/xtheme-crx|xtheme-blue/);

    const tweaker = new CrxTweaker();
    tweaker
        .add(CRXB.tweaks.modifyMainPanel)
        .add(CRXB.tweaks.modifyRepositoryTree)
        .add(CRXB.tweaks.modifyPropertyPanel)
        .add(CRXB.tweaks.insertLandingPage, 'repository')

        .add(CRXB.tweaks.convertAddressBarToOmnibox, 'crxde')
        .add(CRXB.tweaks.addFavorites, 'crxde')
        .add(CRXB.tweaks.addEnvironmentLabel, 'crxde')

        .add(CRXB.tweaks.openPageInEditMode)

        .add(CRXB.tweaks.modifyDeleteAction)
        .add(CRXB.tweaks.copyPasteCommonActions, 'repository')
        .add(CRXB.tweaks.copyPasteRepositoryTree, 'repository')
        .add(CRXB.tweaks.copyPastePropertiesGrid, 'properties')

        .add(CRXB.tweaks.modifyMenus, ['repository', 'properties'])
        .add(CRXB.tweaks.modifyKeyMappings, ['repository', 'properties'])

        .add(() => CRXB.util.registerPreferencesDialog())
        .add(CRXB.tweaks.applyStyles);

    document.addEventListener("DOMContentLoaded", () => {
        regulator.dispose();
        if (typeof Ext !== typeof undefined) {
            tweaker.execute(Ext);
        } else {
            CRXB.tweaks.redirectToLoginPage();
        }
    });
};

CRXB.flows.downloadPackage = function() {
    const path = new URLSearchParams(location.search).get('path');
    const parent = window.opener || window.parent;
    const packager = new CrxPackager({
        cleanUp: true,
        storeBlob: true,
        status: (status) =>  {
            parent.postMessage({from: 'download-package', msg: 'status', status: status}, '*')
        },
        success: (status) =>  {
            parent.postMessage({from: 'download-package', msg: 'success', status: status}, '*')
        },
        failure: (status) =>  {
            parent.postMessage({from: 'download-package', msg: 'failure', status: status}, '*')
        }
    });
    if (path) {
        packager.download(path);
    }
    CRXB.tweaks.applyStyles('download');
};

CRXB.tweaks.copyPasteCommonActions = function() {

    const loadFromGmStore = function(value) {
        if (!value || (value.type !== 'property' && value.type !== 'node')) {
            return;
        }
        const gmData = Ext.decode(value.data);
        if (value.type === 'property') {
            CRX.Clipboard.setData(gmData, 'property');
            CRX.ide.PastePropertyAction.setDisabled(false);
        } else if (value.type === 'node') {
            gmData.getRealPath = () => gmData.propRealPath;
            gmData.getPrimaryType = () => gmData.attributes.primaryType;
            gmData.isTransient = () => gmData.propIsTransient;
            CRX.Clipboard.setData(gmData, 'node');
            CRX.ide.PasteNodeAction.setDisabled(false);
        }
    };

    GM_addValueChangeListener('clipboard', function(name, old_value, new_value, remote) {
        if (!remote) {
            return;
        }
        loadFromGmStore(new_value);
    });
    loadFromGmStore(GM_getValue('clipboard'));
};


CRXB.tweaks.copyPasteRepositoryTree = function() {


    CRXB.util.extendAction(CRX.ide.CopyNodeAction, (base) => {
        base();

        const allowedJsonKeys = {
            allowed: ['attributes', 'id', 'name', 'primaryType', 'propIsTransient', 'propRealPath', 'propOrigin', 'text']};

        const storedNode = CRX.Clipboard.getData().data;
        storedNode.propRealPath = storedNode.getRealPath();
        storedNode.propIsTransient = storedNode.isTransient();
        storedNode.propOrigin = document.location.origin;

        GM_setValue('clipboard', {type: 'node', data: CRXB.util.stringify(storedNode, allowedJsonKeys), timestamp: new Date().getTime()});
        CRX.ide.PasteNodeAction.setDisabled(false);
    });


    CRXB.util.extendAction(CRX.ide.PasteNodeAction, async (base) => {


        if (!CRX.Clipboard.hasData('node') && (GM_getValue('clipboard') || {}).type === 'node') {
            GM_setValue('clipboard', null);
        }
        if (!CRX.Clipboard.hasData('node')) {
            return;
        }

        const storedNode = CRX.Clipboard.getData().data;
        if (storedNode.propOrigin && storedNode.propOrigin !== document.location.origin) {

            await CRXB.util.getUploadClipboardAction().execute(true);

        } else {

            base();
            if (storedNode.getRealPath()) {
                Ext.getCmp(CRX.ide.TREE_ID).expandPath(CRXB.util.getCurrent('node').getPath()); 
            }
        }
    });
};

CRXB.tweaks.copyPastePropertiesGrid = function() {
    CRXB.util.extendAction(CRX.ide.CopyPropertyAction, (base) => {
        document.execCommand('copy');
        base();
        const allowedJsonKeys = {
            allowed: ['id', 'data', 'name', 'type', 'value', 'length',
                'isProtected', 'isMandatory', 'isMultiple', 'isAutoCreated', 'isFullTextSearchable', 'isQueryOrderable']};
        GM_setValue('clipboard', {type: 'property', data: CRXB.util.stringify(CRX.Clipboard.getData().data, allowedJsonKeys), timestamp: new Date().getTime()});
        CRX.ide.PastePropertyAction.setDisabled(false);
    });

    CRXB.util.extendAction(CRX.ide.PastePropertyAction,  (base) => {
        const propGrid = Ext.getCmp(CRX.ide.PROPERTIES_ID);

        if (!CRX.Clipboard.hasData('property')) {
            return;
        }
        const records = CRX.Clipboard.getData().data;
        const errors = [];
        records.forEach(record => {
            const nameValidation = propGrid.validatePropertyName(record.data.name);
            const typeValidation =  propGrid.validatePropertyType(record.data.type, record.data.name);
            const validationInfo = [nameValidation, typeValidation]
                .filter(i => i !== true)
                .filter((v, i, self) => self.indexOf(v) === i)
                .join(' ');
            if (validationInfo) {
                errors.push({name: record.data.name, info: validationInfo});
            }
        });
        base();
        propGrid.fireEvent('selectionchange');
        if (errors.length === 1) {
            Ext.Msg.show({
                buttons: Ext.MessageBox.OK,
                title: 'Insert Property',
                msg: `Could not add property ${errors[0].name}: ${errors[0].info}`,
                icon: Ext.MessageBox.ERROR
            });
        } else if (errors.length) {
            errors.forEach(err => console.error(`Could not add property ${err.name}: ${err.info}`));
            Ext.Msg.show({
                buttons: Ext.MessageBox.OK,
                title: 'Add Property',
                msg: 'There were errors adding properties for this node: see browser log',
                icon: Ext.MessageBox.ERROR
            });
        }
    });
};

CRXB.tweaks.modifyDeleteAction = function() {

    CRXB.util.extendAction(CRX.ide.DeleteNodeAction, (base) => {
        const targetNode = Ext.getCmp(CRX.ide.TREE_ID).getSelectionModel().getSelectedNode();
        if (!targetNode || targetNode.getDepth() === 0) {
            return
        }
        const nextSelected = targetNode.nextSibling || targetNode.previousSibling || targetNode.parentNode;
        base();
        if (nextSelected) {
            nextSelected.select();
        }
    });

    CRXB.util.extendAction(CRX.ide.DeletePropertyAction, (base) => {
        const targetNode = Ext.getCmp(CRX.ide.TREE_ID).getSelectionModel().getSelectedNode();
        const grid = Ext.getCmp(CRX.ide.PROPERTIES_ID);
        const records = grid.getSelectionModel().getSelections();

        if (records.length === 0) {
            return;
        }

        const leadingPos = grid.getStore().find('name', records[0].id) - 1;
        const trailingPos = grid.getStore().find('name', records[records.length - 1].id) + 1;
        const nextSelectedPos = trailingPos < grid.getStore().getCount()
            ? trailingPos - records.length
            : (leadingPos >= 0 ? leadingPos : -1);

        base();

        if (nextSelectedPos > -1) {
            grid.getSelectionModel().selectRow(nextSelectedPos);
        }
    });

};

CRXB.tweaks.addEnvironmentLabel = function () {

    const mainPanel = Ext.getCmp(CRX.ide.MAIN_ID);
    const addressPanel = mainPanel.items[1].items[0];

    const envLabel = new Ext.form.Label({
        id: 'environment',
        text: CRXB.util.getEnvironmentLabel() + ' ›'
    });

    addressPanel.items.unshift(envLabel);
    Ext.reg('environment', envLabel);
};

CRXB.tweaks.addFavorites = function () {

    CRX.ide.FavMenu = new Ext.menu.Menu({
        cls: 'bookmarks light'
    });

    const mainPanel = Ext.getCmp(CRX.ide.MAIN_ID);
    const addressPanel = mainPanel.items[1].items[0];
    addressPanel.items.push(new Ext.Toolbar.SplitButton({
        iconCls: 'action-favorites',
        width: 16,
        menu: CRX.ide.FavMenu,
        handler: function() {
            this.showMenu();
        }
    }));

    const resetMenu = function(bookmarkedNodes) {
        bookmarkedNodes = bookmarkedNodes || GM_getValue('profile:bookmarkedNodes') || {};
        CRX.ide.FavMenu.removeAll(true);
        Object.keys(bookmarkedNodes).sort().forEach(k => {
            CRX.ide.FavMenu.add(new Ext.menu.Item({
                text: k,
                iconCls: 'action-highlight-' + bookmarkedNodes[k].toLowerCase().replace(/\s+/g, '-'),
                handler: () => CRXB.util.setLocation(k)
            }));
        });
    };

    GM_addValueChangeListener('profile:bookmarkedNodes', function(name, old_value, new_value) {
        resetMenu(new_value);
    });

    resetMenu();
};

CRXB.tweaks.modifyKeyMappings = function() {
    const globalKeyMap = CRX.Util.getGlobalKeyMap();
    [
        'global.search',
        'global.movenode',
        'global.copynode',
        'global.pastenode',
        'global.overlaynode',
    ].forEach(binding => globalKeyMap.bindings.remove(globalKeyMap.bindings.get(binding)));

    globalKeyMap.addBinding({
        name: 'global.revert',
        desc: 'Revert all',
        key: 'z',
        ctrl: true,
        stopEvent: false,
        fn: function(code, event) {
            if (!event.target || (event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA')) {
                CRX.ide.executeShortcut(CRX.ide.RevertAllAction);
            } else {
                document.execCommand('undo', false, null);
            }
        }
    });

    const repository = Ext.getCmp(CRX.ide.TREE_ID);
    repository.on('afterrender', function() {
        repository.keyMap.disable();
        delete repository.keyMaps;
        CRX.ide.RepositoryKeyMap = new Ext.KeyMap(repository.el.dom.querySelector('.x-panel-body'), [
            {
                name: 'delete',
                desc: 'Delete selected node',
                key: 46,
                scope: this,
                stopEvent: true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.DeleteNodeAction); }
            },
            {
                name: 'movenode',
                desc: 'Move selected node',
                key: 117,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.MoveNodeAction); }
            },
            {
                name: 'copynode',
                desc: 'Copy selected node',
                key: 'c',
                ctrl:true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.CopyNodeAction); }
            },
            {
                name: 'copynode.alt',
                desc: 'Copy selected node',
                key: 45,
                ctrl:true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.CopyNodeAction); }
            },
            {
                name: 'pastenode',
                desc: 'Paste node from clipboard',
                key: 'v',
                ctrl:true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.PasteNodeAction); }
            },
            {
                name: 'pastenode',
                desc: 'Paste node from clipboard',
                key: 45,
                shift: true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.PasteNodeAction); }
            }
        ]);
    });

    const grid = Ext.getCmp(CRX.ide.PROPERTIES_ID);
    grid.on('afterrender', function() {
        grid.bodyKeyMap.disable();
        delete grid.bodyKeyMap;
        CRX.ide.PropertyGridKeyMap = new Ext.KeyMap(grid.el.dom, [
            {
                name: 'deleteproperty',
                desc: 'Delete selected property',
                key: 46,
                scope: this,
                stopEvent: true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.DeletePropertyAction); }
            },
            {
                name: 'copyproperty',
                desc: 'Copy selected property',
                key: 'c',
                ctrl:true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.CopyPropertyAction); }
            },
            {
                name: 'copyproperty.alt',
                desc: 'Copy selected property',
                key: 45,
                ctrl:true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.CopyPropertyAction); }
            },
            {
                name: 'pasteproperty',
                desc: 'Paste property from clipboard',
                key: 'v',
                ctrl:true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.PastePropertyAction); }
            },
            {
                name: 'pasteproperty',
                desc: 'Paste property from clipboard',
                key: 45,
                shift: true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.PastePropertyAction); }
            }
        ]);
    });
};

CRXB.tweaks.insertLandingPage = function() {

    const homePanel = Ext.getCmp(CRX.ide.EDITORS_ID).items.get(0);
    homePanel.cls = 'homepanel';
    homePanel.title = 'HOME';
    homePanel.iconCls = '';
    homePanel.purgeListeners();


    homePanel.addListener('render', async function() {
        const panelBody = document.querySelector('.homepanel .x-panel-body');

        const versionLabel = document.createElement('DIV');
        versionLabel.id = 'crxb-version';
        versionLabel.innerHTML = CRXB.settings.get('version') || '0.0.1';

        let fakeContainer;
        let navMenu;
        let logsRowList;
        try {
            const response = await fetch('/system/console/slinglog');
            const responseHtml = await response.text();
            fakeContainer = document.createElement('DIV');
            fakeContainer.innerHTML = responseHtml;

            navMenu = fakeContainer.querySelector('#navmenu');
        } catch (e) {
            console.error(e);
        }

        if (navMenu) {
            const logsRow = document.createElement('LI');
            logsRow.classList.add('navMenuItem-0');
            navMenu.insertBefore(logsRow, navMenu.querySelector('li.navMenuItem-0:nth-child(2)'));

            const logsRowHeader = document.createElement('A');
            logsRowHeader.href = '#';
            logsRowHeader.innerHTML = 'Logs';
            logsRow.appendChild(logsRowHeader);

            logsRowList = document.createElement('UL');
            logsRowList.classList.add('navMenuLevel-1');
            logsRow.appendChild(logsRowList);

            navMenu.querySelectorAll('a').forEach(link => {
                if (/#$/.test(link.href)) {
                    link.href = 'javascript:void(0)';
                } else {
                    link.target = '_blank';
                }
                link.innerHTML = link.innerHTML.replace('Web Console', 'Console');
            });

            panelBody.appendChild(navMenu);
            panelBody.appendChild(versionLabel);
            panelBody.classList.add('loaded');
        }

        if (logsRowList) {
            fakeContainer.querySelectorAll('a[href^="slinglog"]').forEach(link => {
                const logLink = document.createElement('LI');
                logsRowList.appendChild(logLink);

                const logLinkAnchor = document.createElement('A');
                let logLinkAnchorText = link.innerHTML
                    .replace(/\.log$/i, '')
                    .replace(/-+/g, ' ');
                if (logLinkAnchorText.indexOf('/') >= 0) {
                    logLinkAnchorText = logLinkAnchorText.split('/').slice(-1);
                }
                if (/error|access|request/.test(logLinkAnchorText)) {
                    logLinkAnchorText = '<em>' + logLinkAnchorText + '</em>';
                }
                logLinkAnchor.href = '/system/console/slinglog/tailer.txt' + new URL(link.href).search;
                logLinkAnchor.target = '_blank';
                logLinkAnchor.innerHTML = logLinkAnchorText;
                logLinkAnchor.classList.add('logLink');
                logLink.appendChild(logLinkAnchor);
            });
        }
    });

};

CRXB.tweaks.modifyMainPanel = function() {
    Ext.override(CRX.ide.MainPanel, {
        parentInitComponent: CRX.ide.MainPanel.prototype.initComponent,
        initComponent: function() {
            this.parentInitComponent();


            this.remove(this.items.get(0), true);


            const repositoryTree = Ext.getCmp(CRX.ide.TREE_ID);
            repositoryTree.title = 'JCR';

            const repositoryWrapper = new Ext.TabPanel({
                id: 'repository-wrapper',
                region: "west",
                width: 400,
                activeTab: 0,
                split: true,
            });
            this.items.get(0).insert(1, repositoryWrapper);
            repositoryWrapper.add(repositoryTree);


            const toolsWrapperPanel =  Ext.getCmp(CRX.ide.TOOLS_WRAPPER_ID);
            const toolsPanel = Ext.getCmp(CRX.ide.TOOLS_ID);
            toolsPanel.remove(toolsPanel.items.get(CRX.ide.LOGGING_ID), true);
            toolsPanel.remove(toolsPanel.items.get(CRX.ide.ACCESS_CONTROL_ID), true);
            toolsPanel.remove(toolsPanel.items.get(CRX.ide.REPLICATION_ID), true);

            const propertiesPanel = toolsPanel.items.get(CRX.ide.PROPERTIES_ID);
            propertiesPanel.region = 'center';
            toolsWrapperPanel.add(propertiesPanel);
            toolsWrapperPanel.remove(toolsPanel, true);

            toolsWrapperPanel.initialConfig.height = 480;
            if (toolsWrapperPanel.height < toolsWrapperPanel.initialConfig.height) {
                toolsWrapperPanel.height = toolsWrapperPanel.initialConfig.height;
            }


            const mainPanel = this.items.get(0);
            const addressBar = mainPanel.items.get(0);
            const panelW = mainPanel.items.get(1);
            const panelE = mainPanel.items.get(2);

            addressBar.initialConfig.margins = '0 0 4 0';
            panelW.initialConfig.margins = '0 0 0 0';
            panelE.initialConfig.margins = '0 0 0 0';

            const panelNE = panelE.items.get(0);
            panelNE.resizeTabs = false;
        }
    });
};

CRXB.tweaks.modifyMenus = function() {
    const topToolbar = Ext.getCmp(CRX.ide.TOOLBAR_ID);
    CRXB.util.arrangeMenu(topToolbar, [
        CRX.ide.RefreshAction,
        'Save All',
        ' ',
        'Create ...',
        CRX.ide.RenameNodeAction,
        ' ',
        CRX.ide.CopyNodeAction,
        CRX.ide.PasteNodeAction,
        CRX.ide.MoveNodeAction,
        CRX.ide.DeleteNodeAction,
        ' ',
        new Ext.Toolbar.SplitButton({
            text: 'Package',
            iconCls: 'nav-package',
            menu: new Ext.menu.Menu({
                items: [
                    new Ext.menu.Item({
                       text: 'Package manager',
                       iconCls: 'nav-package',
                       handler: function () {
                           window.open('../packmgr/index.jsp', '_blank');
                       }
                    }),
                    '-',
                    CRXB.util.getDownloadActions(),
                    '-',
                    CRXB.util.getUploadDialogAction(),
                    CRXB.util.getUploadClipboardAction()
                ]
            }),
            handler: function() {
                this.showMenu();
            }
        }),
        new Ext.Toolbar.SplitButton({
            text: 'Node',
            iconCls: 'action-nodetree',
            handler: function() {
                this.showMenu();
            },
            menu: new Ext.menu.Menu({
                items: [
                    CRXB.util.getReplicationDialogActions(),
                    CRXB.util.getAccessControlDialogAction(),
                    '-',
                    CRX.ide.OverlayNodeAction,
                    {
                        text: 'Node types',
                        menu: new Ext.menu.Menu({
                            id: 'node-types',
                            items: [
                                CRX.ide.ExportNodeTypeAction,
                                CRX.ide.ImportNodeTypeAction
                            ]
                        })
                    },
                ]
            })
        }),
        ' ',
        'Tools',
        ' ',
        new Ext.Button({
            text: 'Site',
            iconCls: 'nav-siteadmin',
            handler: function() {
                window.open('../../siteadmin', '_blank');
            }
        }),
        new Ext.Button({
            text: 'Users',
            iconCls: 'nav-useradmin',
            handler: function() {
                window.open('../../useradmin', '_blank');
            }
        }),
        new Ext.Button({
            text: 'DAM',
            iconCls: 'nav-damadmin',
            handler: function() {
                window.open('../../damadmin', '_blank');
            }
        }),
        new Ext.Button({
            text: 'Misc',
            iconCls: 'nav-miscadmin',
            handler: function() {
                window.open('../../miscadmin', '_blank');
            }
        }),
        '->',
        CRX.ide.LOGINBUTTON_ID
    ]);

    CRXB.util.modifyMenuItem(topToolbar, CRX.ide.RefreshAction, item => item.text = 'Refresh');
    CRXB.util.modifyMenuItem(topToolbar, 'Save All', item => item.iconCls = 'action-save');
    CRXB.util.modifyMenuItem(topToolbar, 'Create ...', item => {item.iconCls = 'action-add'; item.text = 'Create';});
    CRXB.util.modifyMenuItem(topToolbar, CRX.ide.RenameNodeAction, item => item.iconCls = 'action-edit');
    CRXB.util.modifyMenuItem(topToolbar, CRX.ide.CopyNodeAction, item => item.iconCls = 'action-copy');
    CRXB.util.modifyMenuItem(topToolbar, CRX.ide.PasteNodeAction, item => item.iconCls = 'action-paste');
    CRXB.util.modifyMenuItem(topToolbar, CRX.ide.MoveNodeAction, item => item.iconCls = 'action-move');
    CRXB.util.modifyMenuItem(topToolbar, CRX.ide.DeleteNodeAction, item => item.iconCls = 'action-delete');
    CRXB.util.modifyMenuItem(topToolbar, 'Tools', item => item.iconCls = 'action-tools');

    const treeContextMenu = Ext.getCmp(CRX.ide.TREE_ID).contextMenu;
    CRXB.util.arrangeMenu(treeContextMenu, [
        CRXB.util.getOpenPageActions(),
        CRX.ide.CreateNodeAction,
        CRX.ide.RenameNodeAction,
        '-',
        CRX.ide.CopyNodeAction,
        CRX.ide.PasteNodeAction,
        CRX.ide.DeleteNodeAction,
        '-',
        CRX.ide.MoveNodeAction,
        CRXB.util.getDragActions(),
        '-',
        CRX.ide.OverlayNodeAction,
        CRXB.util.getAccessControlDialogAction(),
        '-',
        CRXB.util.getReplicationDialogActions(),
        '-',
        CRXB.util.getDownloadActions(),
        '-',
        CRXB.util.getSortAction(),
        CRXB.util.getUnsortAction(),
        'Bookmark'
    ], {
        'Tools': 'hide',
        'Open ...': 'hide'
    });
    treeContextMenu.cls = 'x-menu-detached hide-disabled';

    CRXB.util.modifyMenuItem(treeContextMenu, CRX.ide.RenameNodeAction, item => item.iconCls = 'action-edit');
    CRXB.util.modifyMenuItem(treeContextMenu, CRX.ide.MoveNodeAction, item => item.iconCls = 'action-move');
    CRXB.util.modifyMenuItem(treeContextMenu, CRXB.util.getDragActions(), item => item.iconCls = 'action-drag');

    const propertiesContextMenu = Ext.getCmp(CRX.ide.PROPERTIES_ID).contextMenu;
    CRXB.util.arrangeMenu(propertiesContextMenu, [
        CRXB.util.getPropertyDialogActions(),
        CRX.ide.CopyPropertyAction,
        CRX.ide.PastePropertyAction,
        CRX.ide.EditMixinAction,
        CRX.ide.DeletePropertyAction
    ]);
    propertiesContextMenu.cls = 'x-menu-detached hide-disabled';

    CRXB.util.modifyMenuItem(propertiesContextMenu, CRX.ide.EditMixinAction, item => item.iconCls = 'action-mixin');

    CRXB.util.arrangeMenu(CRX.ide.ToolsMenu, [
        CRX.ide.QueryAction,
        '-',
        CRX.ide.PrivilegesAction,
        CRX.ide.TestAccessControlAction,
        '-',
        CRXB.util.getSettingsDialogAction()
    ]);
};

CRXB.tweaks.convertAddressBarToOmnibox = function() {

    const getSqlConditions = function(value) {
        const regExp = /(\w+(?::\w+)?|\[\w+(?::\w+)?])\s*(=|<>|\s+like\s+)\s*(\w+|['"].*?['"])/gi;
        const matches = [];
        const intervals = [];
        let match, lastIndex = 0;
        while ((match = regExp.exec(value)) != null) {
            if (matches.length === 0 && match.index > 0) {
                if (/^(\/[\w-:]+)+\s*@/.test(value)) {
                    matches.push({path: value.split('@')[0].trim(), arg1: match[1], op: match[2], arg2: match[3]});
                    continue;
                } else {
                    return false;
                }
            }
            matches.push({arg1: match[1], op: match[2], arg2: match[3]});
            if (lastIndex > 0) {
                intervals.push(value.substring(lastIndex, match.index));
            }
            lastIndex = regExp.lastIndex;
        }
        if (matches.length === 1) {
            return [matches[0]];
        }
        if (matches.length > 1
                && matches.length === (intervals.length) + 1
                && intervals.every(int => /and|or/i.test(int.trim()))) {
            const result = [];
            for (let i = 0; i < matches.length; i++) {
                if (i === 0) {
                    result.push(matches[i]);
                } else {
                    matches[i].operator = intervals[i-1];
                    result.push(matches[1]);
                }
            }
            return result;
        }

        return false;
    };

    const conditionsToSqlQuery = function(value) {
        let result = 'SELECT * FROM [nt:base] AS node WHERE ';
        let currentPath = value[0].path || CRXB.util.getCurrent('path');
        if (!currentPath || currentPath === '/') {
            currentPath = '/content';
        }
        result += ` ISDESCENDANTNODE(node, '${currentPath}') AND (`;
        value.forEach(v => {
            if (v.operator) {
                result += v.operator
            }
            const isArgInBrackets = v.arg1[0] === '[';
            result += 'node.' + (isArgInBrackets ? '' : '[') + v.arg1 + (isArgInBrackets ? '' : ']') + v.op + v.arg2;
        });
        result += ')';
        return result;
    };

    const parseValue = function(value) {
        if (!value) {
            return false;
        }

        let resultingValue = value.trim();

        if (/^https?:\/\//i.test(value)) {
            const addressPart =  resultingValue.split('://')[1];
            const slashIndex = addressPart.indexOf('/');
            if (slashIndex > 0) {
                resultingValue = addressPart.substr(slashIndex);
                if (resultingValue.indexOf('?') > 0) {
                    resultingValue = resultingValue.split('?')[0];
                }
            } else {
                return {
                    value: resultingValue,
                    type: 'search'
                }
            }
        }

        if (/^(\/editor\.html)?(\/[\w-:]+)+(\.\w+)?((\/[^\s\/]+)+)?(\?[^\s]+)?$/i.test(resultingValue)) {
            if (/^\/editor\.html/i.test(resultingValue)) {
                resultingValue = resultingValue.substring('/editor.html'.length);
            }
            const autoPattern = CRXB.settings.get('omnibox-auto-pattern');
            const autoReplacement = CRXB.settings.get('omnibox-auto-replacement');
            if (autoPattern && autoReplacement) {
                const rx =  new RegExp(autoPattern);
                if (rx.test(resultingValue)) {
                    resultingValue = resultingValue.replace(rx, autoReplacement);
                }
            }
            if (/\.\w+$/.test(resultingValue) && /^\/content/i.test(resultingValue)) {
                resultingValue = resultingValue.split('.')[0];
            }
            if (resultingValue[resultingValue.length - 1] === '/') {
                resultingValue = resultingValue.substring(0, resultingValue.length - 1);
            }
            return {
                value:  resultingValue,
                type: 'node'
            };
        }

        if (resultingValue.indexOf('/jcr:root') === 0) {
            return {
                value: resultingValue,
                type: 'query',
                termType: 'xpath'
            };
        }

        if (/^select.+from.+where/i.test(resultingValue)) {
            return {
                value: resultingValue,
                type: 'query'
            };
        }

        const foundSqlConditions = getSqlConditions(resultingValue);
        if (foundSqlConditions) {
            return {
                value: conditionsToSqlQuery(foundSqlConditions),
                type: 'query'
            };
        }

        return {
            value: resultingValue,
            type: 'search'
        };
    };

    const doSearch = function() {
        const queryHolder = Ext.getCmp(CRX.ide.REPO_PATH_ID);
        const parsed = parseValue(queryHolder.getValue());

        if (!parsed) {
            return;
        }

        if (parsed && parsed.type === 'node') {
            CRXB.util.setLocation(parsed.value);

        } else if (parsed && parsed.type === 'search') {
            CRXB.util.performSearch(parsed.value);

        } else if (parsed && parsed.type === 'query') {
            CRXB.util.performQuery(parsed.value, parsed.termType);
        }
    };

    const mainPanel = Ext.getCmp(CRX.ide.MAIN_ID);
    const addressBar = Ext.getCmp(CRX.ide.REPO_PATH_ID);
    const addressPanel = mainPanel.items[1].items[0];

    addressPanel.autoHeight = false;
    addressPanel.height = 30;
    addressPanel.layout = 'hbox';
    addressPanel.id = 'addressbar';
    addressPanel.cls = 'x-toolbar';

    addressPanel.items.remove(addressBar);

    const omniBox = new Ext.form.TextField({
        id: CRX.ide.REPO_PATH_ID,
        height: 30,
        listeners: {
            specialkey: function(field, e) {
                if (e.getKey() === e.ENTER) {
                    doSearch();
                }
            }
        }
    });
    addressPanel.items.push(omniBox);
    addressPanel.items.push(new Ext.Toolbar.Button({
        iconCls: 'query',
        width: 16,
        handler: doSearch
    }));
    addressPanel.items[0].flex = 1;

    CRXB.util.registerSearchPanel();
};

CRXB.tweaks.openPageInEditMode = function() {

    Ext.override(CRX.ide.PageEditor, {
        open: function() {
            const node = CRXB.util.getCurrent().node;
            const openInEditMode = CRXB.settings.get('prefer-edit-mode');
            const [openStraight, openEdit] = CRXB.util.getOpenPageActions();

            if (openInEditMode) {
                openEdit.execute();
            } else {
                openStraight.execute();
            }
        }
    });

};

CRXB.tweaks.modifyPropertyPanel = function() {
    Ext.override(CRX.ide.PropertyPanel, {
        parentInitComponent: CRX.ide.PropertyPanel.prototype.initComponent,

        initComponent: function() {
            this.parentInitComponent();

            this.bottomToolbar.hide();
            this.elements += ',tbar';
            this.topToolbar = new Ext.Toolbar({
                id: 'custom-properties-toolbar',
                items: [
                    CRXB.util.getPropertyDialogActions(),
                    ' ',
                    CRX.ide.CopyPropertyAction,
                    CRX.ide.PastePropertyAction,
                    ' ',
                    CRX.ide.EditMixinAction,
                    ' ',
                    CRX.ide.DeletePropertyAction,
                ]
            });
            CRXB.util.modifyMenuItem(this.topToolbar, CRX.ide.EditMixinAction, item => item.iconCls = 'action-mixin');

            this.getSelectionModel().addListener('selectionchange', () => {
                this.topToolbar.items.each(function(action) {
                    if (!action.baseAction) {
                        return;
                    }
                    if (action.baseAction.checkActive) {
                        action.baseAction.checkActive.call(action);
                    }
                });
            });

            this.addListener('rowcontextmenu', function(grid, index, e) {
                const sm = grid.getSelectionModel();
                if (!sm.hasSelection() || !sm.isSelected(index)) {
                    sm.selectRow(index);
                }
                const menu = grid.contextMenu;
                if (menu.fireEvent('beforeshow', this) !== false) {
                    menu.showAt(0, 0);
                    const contextMenuHeight = menu.el.getHeight();
                    const xy = Ext.get(grid.getView().getRow(index)).getAnchorXY();
                    const xPos = xy[0];
                    let yPos = xy[1];
                    if (yPos + contextMenuHeight > window.innerHeight) {
                        yPos = window.innerHeight - contextMenuHeight;
                    }
                    menu.showAt([e.getXY()[0], yPos]);
                }
                e.stopEvent();
            });

            this.linkChecker = new CrxLinkChecker(Ext);
        },

        onCellDblClick: function() {
            const editAction = this.topToolbar.items.find(item => item.baseAction === CRX.ide.EditPropertyDialogAction);
            if (editAction && !editAction.disabled) {
                editAction.baseAction.execute();
            }
        },

        parentRenderValueItem: CRX.ide.PropertyPanel.prototype.renderValueItem,
        renderValueItem: function(value, record, index) {
            const type = record.get('type');
            const isMultiple = record.get('isMultiple');
            const isProtected = record.get('isProtected');

            const verifyPath = (text) => {
                if (/^(\/[\w-:]+)+(\.\w+)?$|^[\w-]+(\/[\w-:]+)+(\.\w+)?$/.test(text)) {
                    return this.linkChecker.check(text, (result) => {
                        if (result === true) {
                            record.data.verifiedPath = text;
                        } else if (result) {
                            record.data.verifiedPath = result;
                        } else {
                            record.data.verifiedPath = false;
                        }
                        if (!this.linkCheckerRefreshTask) {
                            this.linkCheckerViewRefreshTask = new  Ext.util.DelayedTask(() => this.getView().refresh(), this);
                        }
                        this.linkCheckerViewRefreshTask.delay(500);
                    });
                }
            };

            if (record.data.hasOwnProperty('verifiedPath')) {
                let verifiedPath = record.data.verifiedPath;
                delete record.data.verifiedPath;
                if (verifiedPath) {
                    return '<a href="index.jsp#' + verifiedPath + '">' + Ext.util.Format.htmlEncode(value) + '</a>';
                } else {
                    return value;
                }
            }

            if ((type === CRX.util.STRING || type === CRX.util.PATH) && !isMultiple && !isProtected) {
                let verifiedPath = verifyPath(value);
                if (verifiedPath === true) {
                    verifiedPath = value;
                }
                if (verifiedPath) {
                    return '<a href="index.jsp#' + verifiedPath + '">' + Ext.util.Format.htmlEncode(value) + '</a>';
                }
            }

            if (type === CRX.util.URI && !isMultiple && !isProtected) {
                return '<a href="' + value + '" target="_blank">' + Ext.util.Format.htmlEncode(value) + '</a>';
            }

            return this.parentRenderValueItem(value, record, index);
        },
    });
};

CRXB.tweaks.modifyQueryPanel = function() {
    Ext.override(CRX.ide.QueryPanel, {
        parentInitComponent: CRX.ide.QueryPanel.prototype.initComponent,

        initComponent: function() {
            this.parentInitComponent();

            this.title = 'QUERY';
            this.layout = 'fit';
            this.items.removeAt(1);
        }

    });


    CRXB.util.getQueryActions = function() {
        if (CRX.ide.XPathQueryAction) {
            return [CRX.ide.QueryAction, CRX.ide.XPathQueryAction];
        }

        CRX.ide.QueryAction = new Ext.Action({
            text: 'Query (JCR-SQL2)',
            iconCls: 'action-query-sql',
            handler: function(type = 'sql') {
                const main = Ext.getCmp(CRX.ide.MAIN_ID);
                const editor = main.editors.add({
                    xtype: 'querypanel',
                    closable: true,
                    type: type
                });
                main.editors.activate(editor);
            }
        });

        CRX.ide.XPathQueryAction = new Ext.Action({
            text: 'Query (JCR-SQL2)',
            iconCls: 'query',

        });

        return [CRX.ide.QueryAction, CRX.ide.XPathQueryAction];
    }
};

CRXB.tweaks.redirectToLoginPage = function() {
    if ((document.head.childNodes.length === 0 || Array.prototype.every.call(document.head.childNodes, n => n.tagName === 'SCRIPT'))
        && document.body.innerText.trim() === 'Authentication Failed') {

        window.location = '/libs/granite/core/content/login.html?resource=/crx/de';

    }
};

CRXB.tweaks.modifyRepositoryTree = function() {


    const highlightColors = CRXB.settings.get('highlight-colors');


    Ext.override(CRX.ide.RepositoryTree, {
        parentInitComponent: CRX.ide.RepositoryTree.prototype.initComponent,
        initComponent: function() {

            this.parentInitComponent();

            const normalizeColorName = (color) => color.toLowerCase().replace(/\s+/g, '-');

            const storeBookmark = (color) => {
                const current = CRXB.util.getCurrent();
                if (!current) {
                    return;
                }
                const currentBookmarkedNodes = GM_getValue('profile:bookmarkedNodes') || {};
                highlightColors.each(col => current.node.ui.removeClass('highlight-' + normalizeColorName(col)));
                if (color !== 'None') {
                    currentBookmarkedNodes[current.path] = normalizeColorName(color);
                } else {
                    delete currentBookmarkedNodes[current.path];
                }
                current.node.ui.addClass('highlight-' + normalizeColorName(color));
                GM_setValue('profile:bookmarkedNodes', currentBookmarkedNodes);
            };
            const colorItems = highlightColors.map(col =>  {return {text: col, iconCls: 'action-highlight-' + normalizeColorName(col), handler: () => storeBookmark(col)}; });

            this.contextMenu.add([
                {
                    text: 'Bookmark',
                    iconCls: 'action-highlight',
                    menu: new Ext.menu.Menu({
                        id: 'highlight_colors',
                        cls: 'x-menu-detached bookmarks',
                        items: colorItems
                    })
                }
            ]);

            this.sorter = new Ext.tree.TreeSorter(this, {
                dir: "ASC",
                sortedNodes: GM_getValue('profile:sortedNodes') || [],
                doSort: function(node) {
                    const nodeType = CRX.NodetypeRegistry.getNodetype(node.getPrimaryType());
                    if ((Array.isArray(this.sortedNodes) && this.sortedNodes.some(entry => CRX.Util.getLocalWorkspacePath(node.getRealPath()) === entry))
                        || !nodeType.hasOrderableChildNodes
                    ) {
                        node.sort(CRXB.util.sortNodes);
                    }
                }
            });


            this.filterField.hidden = false;
            this.remove(this.tools, false);

            this.elements = this.elements.replace('tbar', 'bbar');
            const bbar = this.initialConfig.tbar;
            this.bottomToolbar = bbar;
            bbar.style = 'margin-top: 2px';
            delete this.topToolbar;


            this.on('afterrender', function() {

                this.un('beforeclick', this.editor.beforeNodeClick, this.editor);

            });

            this.on('nodedrop', function(event) {
                if (CRX.ide.LockDragAction) {
                    CRX.ide.LockDragAction.execute(event.dropNode);
                }
            });
        }
    });

    Ext.override(CRX.ide.RepositoryTree.TreeLoader, {
        parentProcessNewChild: CRX.ide.RepositoryTree.TreeLoader.prototype.processNewChild,
        processNewChild: function(child, data) {
            this.parentProcessNewChild(child, data);

            if (!this.bookmarkedNodes) {
                this.bookmarkedNodes = GM_getValue('profile:bookmarkedNodes') || {};
            }
            if (!this.sortedNodes) {
                this.sortedNodes = GM_getValue('profile:sortedNodes') || [];
            }

            const classes = [];
            const highlightColor = this.bookmarkedNodes[CRX.Util.getLocalWorkspacePath(child.getRealPath())];

            if (highlightColor) {
                classes.push('highlight-' + highlightColor);
            }
            if (this.sortedNodes.some(entry => CRX.Util.getLocalWorkspacePath(child.getRealPath()) === entry)) {
                child.sorted = true;
                classes.push('sorted');
            } else {
                delete child.sorted;
            }

            (child.attributes || {}).cls = classes.join(' ');

            child.draggable = !!CRXB.settings.get('allow-dragging');
        },

        parentCreateNode: CRX.ide.RepositoryTree.TreeLoader.prototype.createNode,
        createNode: function(attr) {
            const node = this.parentCreateNode(attr);
            node.draggable = !!CRXB.settings.get('allow-dragging');
            return node;
        }
    });
};

CRXB.tweaks.applyStyles = function(scope = ['splash', 'default']) {

    const prefs = CRXB.settings.get(SettingsHolder.INSTANCE_PREFERENCES);
    const colorScheme = CRXB.util.getCurrentColorScheme();

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

    const oldFavicon = document.querySelector('link[rel="icon"]');
    if (oldFavicon) {
        const newFavicon = oldFavicon.cloneNode(false);
        newFavicon.href = CRXB.settings.get('favicon').replace(/%23111/, '%23' + CRXB.styles.COLOR_TOOLS_BG.substring(1));
        newFavicon.type = 'image/svg+xml';
        document.querySelectorAll('[rel~="icon"]').forEach(element => element.parentNode.removeChild(element));
        document.head.appendChild(newFavicon);
    }

    CRXB.styles.install(scope);
};

(function() {
    'use strict';
    const flow = location.search ? (new URLSearchParams(location.search).get('crxbflow') || '') : '';
    (CRXB.flows[flow] || CRXB.flows.common)();
})();


