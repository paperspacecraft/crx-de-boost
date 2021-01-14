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
                            // Cleanup due to the layout manager leaving "empty" containers after an element is removed
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

            // A quick hack to hide the datepicker's top panel if visible
            // TODO remove this if datepicker implementation changes
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

            // We need saving context because when the 'persistRecord' routine takes place, the dialog window may have been
            // already reset and cleared
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
                // Remove conflicting record
                selection.deletePropertyRecords([context.record]);
                await CRXB.util.save(true);
            }

            if (context.record && !needRecreate) {
                // Save existing record
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
                // Create new record
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
            // Convert singular field into multifield
            if (dataTypeMatchesExisting && convertToMulti) {
                newField = this.convertToMultifield(existingField);

            // Convert singular field into a multifield of some other type
            // Or convert multifield into another multifield
            } else if ((!dataTypeMatchesExisting && convertToMulti)
                || this.isMultiple()) {
                newField = this.convertToMultifield(this.prepareValueField(value));

            // Convert singular field to another singular field
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
                // Do not allow multiplying of datetime field because of difficulties handling datetime arrays
                // TODO remove if datetime implementation changes
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
                // We do not handle multifields consisting of datetimes
                // TODO change this if datetime's implementation changes
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
                // We cannot set value of datetime pickers from ExtJs logic
                // TODO change this if datetime's implementation changes
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

/*
    CRX.ide.UnlockPropertyAction = new Ext.Action({
        text: 'Unlock ...',
        iconCls: 'action-unlock',
        disabled: true,
        handler: () => {
            const selectionModel = Ext.getCmp(CRX.ide.TOOLS_WRAPPER_ID).items.get(CRX.ide.PROPERTIES_ID).getSelectionModel();
            const record = selectionModel.getSelected();
            record.set('isProtected', false);
            CRX.ide.EditPropertyDialogAction.execute({unlocked: true});
        }
    });
    CRX.ide.UnlockPropertyAction.checkActive = function() {
        const grid = Ext.getCmp(CRX.ide.TOOLS_WRAPPER_ID).items.get(CRX.ide.PROPERTIES_ID);
        const record = grid.getSelectionModel().getSelected();
        if (!record || !record.get('isProtected')) {
            return this.setDisabled(true);
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
*/

    return [CRX.ide.AddPropertyDialogAction, CRX.ide.EditPropertyDialogAction];
};