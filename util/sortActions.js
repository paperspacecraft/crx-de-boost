CRXB.util.getSortAction = function() {
    if (CRX.ide.SortAction) {
        return CRX.ide.SortAction;
    }
    CRX.ide.SortAction = new Ext.Action({
        text: 'Sort',
        iconCls: 'action-sorting-alpha',
        handler: (alphabetic = true) => {
            const current = CRXB.util.getCurrent();
            if (!current) {
                return;
            }
            const currentSortedNodes = GM_getValue('profile:sortedNodes') || [];
            let sortingChanged = false;
            if (alphabetic && currentSortedNodes.indexOf(current.path) < 0) {
                currentSortedNodes.push(current.path);
                current.node.ui.addClass('sorted');
                sortingChanged = true;
            } else if (!alphabetic && currentSortedNodes.indexOf(current.path) >= 0) {
                currentSortedNodes.splice(currentSortedNodes.indexOf(current.path), 1);
                current.node.ui.removeClass('sorted');
                sortingChanged = true;
            }
            if (sortingChanged) {
                GM_setValue('profile:sortedNodes', currentSortedNodes);
                Ext.getCmp(CRX.ide.TREE_ID).sorter.sortedNodes = currentSortedNodes;
                CRX.ide.RefreshAction.initialConfig.handler();
            }
        }
    });
    CRX.ide.SortAction.checkActive = function() {
        this.setDisabled(CRXB.util.getCurrent('node').ui.getEl().querySelector('div').classList.contains('sorted'));
    };
    return CRX.ide.SortAction;
};

CRXB.util.getUnsortAction = function() {
    if (CRX.ide.UnsortAction) {
        return CRX.ide.UnsortAction;
    }
    CRX.ide.UnsortAction = new Ext.Action({
        text: 'Unsort',
        iconCls: 'action-sorting-default',
        handler: () => CRX.ide.SortAction.execute(false)
    });
    CRX.ide.UnsortAction.checkActive = function() {
        this.setDisabled(!CRXB.util.getCurrent('node').ui.getEl().querySelector('div').classList.contains('sorted'));
    };
    return CRX.ide.UnsortAction;
};