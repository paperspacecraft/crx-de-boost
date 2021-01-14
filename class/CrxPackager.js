class CrxPackager {

    static MAX_BLOB_SIZE_MB = 20; // limit for storing downloaded package in memory
    static AC_HANDLING_OPTIONS = ['-', 'ignore', 'overwrite', 'merge', 'merge_preserve', 'clear'];

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

    //
    // Main methods
    //

    async download(path) {

        path = decodeURIComponent(path);
        let effectivePackageName = (this.config.packageName || `${CRXB.util.getEnvironmentLabel()}-${path}`).replace(/[\/:.,]+/gi, '-');
        if (!this.config.packageName) {
            effectivePackageName += '-' + new Date().getTime();
        }
        const argument = {
            jcrPath: path,
            packageName: effectivePackageName,
            stage: 'Creating package',
            completion: 0
        };

        try {

            // Stage: create

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
                argument.message = createResponseJson.msg || 'Could not create package';
                return this.handleFailure(argument);
            }

            argument.packagePath = createResponseJson.path;
            argument.stage = 'Setting up package';
            argument.completion = .2;
            this.config.status(argument);

            // Stage: setup

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

            // Stage: build

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

            // Stage: request size

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

            // Stage: serve download

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

            // Stage: cleanup

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

            // Stage: upload

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

            // Stage: check

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

            // Stage: cleanup

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
            if (frame && frame.opener) { // == is window
                frame.close();
            } else if (frame) {
                frame.remove();
            }
            if (clearUi) {
                this.config.success();
            }
        };

        const finalizationTaskGrace = 10 * 60 * 1000; // 10 min
        const finalizationTask = new Ext.util.DelayedTask(() => finalize(true));
        finalizationTask.delay(finalizationTaskGrace);

        const frameUrl = origin + this.config.endpoints.install + '?crxbflow=downloadPackage&path=' + path;
        const frame = window.open(frameUrl, 'Import Resource', 'height=1,width=1,menubar=no,toolbar=no,status=no,resizable=no,scrollbars=no');
        if (!frame) {
            this.config.failure('Could not start package download');
            finalize(false);
        }
    }

    //
    // Utility methods
    //

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