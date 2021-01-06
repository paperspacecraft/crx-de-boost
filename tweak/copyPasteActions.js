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

    // Listener for updating actions in foreign tabs
    GM_addValueChangeListener('clipboard', function(name, old_value, new_value, remote) {
        if (!remote) {
            return;
        }
        loadFromGmStore(new_value);
    });
    // ...And the initial data load
    loadFromGmStore(GM_getValue('clipboard'));
};


CRXB.tweaks.copyPasteRepositoryTree = function() {

    // Copy selected node to local storage so that it can be used in another tab/instance

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

    // Consider node data from the local storage so that it can be used in another tab/instance

    CRXB.util.extendAction(CRX.ide.PasteNodeAction, async (base) => {

        // Move from GM store to clipboard

        if (!CRX.Clipboard.hasData('node') && (GM_getValue('clipboard') || {}).type === 'node') {
            GM_setValue('clipboard', null);
        }
        if (!CRX.Clipboard.hasData('node')) {
            return;
        }

        // Check if stored node is coming from the same AEM instance
        const storedNode = CRX.Clipboard.getData().data;
        if (storedNode.propOrigin && storedNode.propOrigin !== document.location.origin) {

            // Initiate package upload
            await CRXB.util.getUploadClipboardAction().execute(true);

        } else {

            // Paste the stored node as is
            base();
            if (storedNode.getRealPath()) {
                Ext.getCmp(CRX.ide.TREE_ID).expandPath(CRXB.util.getCurrent('node').getPath()); // otherwise we won't see the added node
            }
        }
    });
};

CRXB.tweaks.copyPastePropertiesGrid = function() {
    // Copy selected properties to local storage so that they can be used in another tab/instance
    // Make sure "Paste" button in properties grid is active as soon as copy-to-clipboard completed
    CRXB.util.extendAction(CRX.ide.CopyPropertyAction, (base) => {
        document.execCommand('copy');
        base();
        const allowedJsonKeys = {
            allowed: ['id', 'data', 'name', 'type', 'value', 'length',
                'isProtected', 'isMandatory', 'isMultiple', 'isAutoCreated', 'isFullTextSearchable', 'isQueryOrderable']};
        GM_setValue('clipboard', {type: 'property', data: CRXB.util.stringify(CRX.Clipboard.getData().data, allowedJsonKeys), timestamp: new Date().getTime()});
        CRX.ide.PastePropertyAction.setDisabled(false);
    });

    // Consider properties data from the local storage when pasting
    // Display alert if could not paste property
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