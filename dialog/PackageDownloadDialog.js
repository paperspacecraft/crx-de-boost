CRXB.util.registerDownloadDialog = function() {
    if (CRX.ide.PackageDownloadDialog) {
        return;
    }

    CRX.ide.PackageDownloadDialog = Ext.extend(Ext.Window, {
        title: 'Download',
        modal: true,
        width: 480,
        height: 220,
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

            this.persist = new Ext.form.Checkbox({
                fieldLabel: 'Persist package in instance'
            });

            this.okButton = new Ext.Button({
                text: 'OK',
                handler: () => {
                    if (!this.isValid()) {
                        return;
                    }
                    CRX.ide.DownloadAction.execute({
                        packageName: this.packageName.getValue(),
                        packageGroup: this.packageGroup.getValue(),
                        persist: this.persist.getValue(),
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
                    labelWidth: 140,
                    defaults: {
                        msgTarget: 'side',
                        anchor: '98%',
                    },
                    items: [
                        this.packageName,
                        this.packageGroup,
                        this.acHandling,
                        this.persist
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
            this.packageGroup.setValue(CRXB.settings.get('package-group') || CrxPackager.DEFAULT_PACKAGE_GROUP);
            this.acHandling.setValue(CRXB.settings.get('default-ac-handling') || CrxPackager.AC_HANDLING_OPTIONS[0]);

            this.on('show', function() {
                // this.packageGroup.getEl().up('.x-form-item').hide();
                this.packageName.focus();
            });
        },

        isValid: function() {
            return this.packageName.isValid()
                && this.packageGroup.isValid()
                && this.acHandling.isValid();
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
            crxPackagerConfig.groupName = args.packageGroup || CRXB.settings.get('package-group') || CrxPackager.DEFAULT_PACKAGE_GROUP;
            if (args.acHandling) {
                crxPackagerConfig.acHandling = args.acHandling;
            }
            if (args.persist) {
                crxPackagerConfig.cleanUp = false;
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
