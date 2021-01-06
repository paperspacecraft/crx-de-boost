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
};