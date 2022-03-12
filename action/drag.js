CRXB.util.getDragActions = function() {
    if (CRX.ide.AllowDragAction) {
        return [CRX.ide.AllowDragAction, CRX.ide.LockDragAction];
    }

    CRX.ide.AllowDragAction = new Ext.Action({
        text: 'Unlock for dragging',
        handler: () => {
            const node = CRXB.util.getCurrent('node');
            node.draggable = true;
            node.ui.elNode.classList.add('drag');
        }
    });
    CRX.ide.AllowDragAction.checkActive = function() {
        const currentNode = CRXB.util.getCurrent('node');
        const allowDragging = CRXB.settings.get('allow-dragging')
        const disabled = !currentNode
            || currentNode.draggable
            || allowDragging
            || currentNode === Ext.getCmp(CRX.ide.TREE_ID).getRootNode();
        this.setDisabled(disabled);
    };

    CRX.ide.LockDragAction = new Ext.Action({
        text: 'Lock for dragging',
        handler: (node) => {
            if (!node || node.getXType && (node.getXType() === 'menuitem')) {
                node = CRXB.util.getCurrent('node');
            }
            node.draggable = false;
            node.ui.elNode.classList.remove('drag');
        }
    });
    CRX.ide.LockDragAction.checkActive = function() {
        const currentNode = CRXB.util.getCurrent('node');
        const allowDragging = CRXB.settings.get('allow-dragging');
        const disabled = !currentNode
            || !currentNode.draggable
            || allowDragging
            || currentNode === Ext.getCmp(CRX.ide.TREE_ID).getRootNode();
        this.setDisabled(disabled);
    };

    return [CRX.ide.AllowDragAction, CRX.ide.LockDragAction];
};
