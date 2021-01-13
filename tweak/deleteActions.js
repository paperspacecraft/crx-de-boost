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