CRXB.util.registerSettingsDialog = function() {
    if (CRX.ide.SettingsDialog) {
        return;
    }

    CRX.ide.SettingsDialog = Ext.extend(Ext.Window, {
        title: 'Settings',
        modal: true,
        width: 420,
        height: 340,
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
                fieldLabel: 'Open pages in<br>editor by dblclick',
                minValue: 1
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
                            text: 'Search panel settings',
                            anchor: false,
                        },
                        this.searchPanelSize,
                        {
                            xtype: 'label',
                            cls: 'dialog-section',
                            text: 'Repository tree settings',
                            anchor: false,
                        },
                        this.openInEditMode
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
                ]
            });
            CRX.ide.SettingsDialog.superclass.constructor.call(this, config);
        },

        initComponent: function() {
            CRX.ide.SettingsDialog.superclass.initComponent.call(this);
            const panel = this.items.get(0);
            const settings = GM_getValue('profile:settings') || {};
            panel.items.each(function(item) {
                if (!item.setValue) {
                    return;
                }
                item.setValue(settings[item.id] || item.defaultValue);
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
            GM_setValue('profile:settings', settings);
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