CRXB.util.registerPackageUploadDialog = function() {
    if (CRX.ide.PackageUploadDialog) {
        return;
    }
    CRX.ide.PackageUploadDialog = Ext.extend(Ext.Window, {
        cls: 'package-upload',
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
        dialogId: 'packageuploaddialog',
        iconCls: 'action-upload',
        handler: () => {
            CRX.ide.PackageUploadDialog.getInstance().show();
        }
    });

    return CRX.ide.UploadDialogAction;
};