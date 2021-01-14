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
                    {
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
                    },
                    {
                        text: 'Cancel',
                        handler: () => this.hide()
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
        },

        convertSwatchesToColorFields: function() {
            const panelElement = this.items.get(0).el.dom;
            const swatches = panelElement.querySelectorAll('.color-swatch[type="text"]');
            for (let swatch of swatches) {
                swatch.type = 'color';
            }
        },

    });
    Ext.reg("preferencesdialog", CRX.ide.CustomPreferencesDialog);
    return CRX.ide.CustomPreferencesDialog;
};

