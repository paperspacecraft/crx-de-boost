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
        dialogId: 'settingsdialog',
        iconCls: 'action-settings',
        handler: () => {
            CRX.ide.SettingsDialog.getInstance().show();
        }
    });

    return CRX.ide.SettingsDialogAction;
};