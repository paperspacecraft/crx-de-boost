CRXB.util.getOpenPageActions = function() {
    if (CRX.ide.OpenPageViewAction) {
        return [CRX.ide.OpenPageViewAction, CRX.ide.OpenPageEditAction];
    }

    CRX.ide.OpenPageViewAction = new Ext.Action({
        text: 'Open page',
        iconCls: 'action-link',
        handler: () => {
            const node = CRXB.util.getCurrent('node');
            const location = CRX.Util.getLaunchpadContextPath()
                + CRX.Util.getLocalWorkspacePath(node.getRealPath())
                + '.html?wcmmode=disabled';
            window.open(location);
        }
    });
    CRX.ide.OpenPageViewAction.checkActive = function() {
        const currentNode = CRXB.util.getCurrent('node');
        const isPage = currentNode.ui.iconNode.classList.contains('page');
        const disabled = !currentNode || !isPage || !GM_getValue('profile:settings')['prefer-edit-mode'];
        this.setDisabled(disabled);
    };

    CRX.ide.OpenPageEditAction = new Ext.Action({
        text: 'Open in edit mode',
        iconCls: 'action-link',
        handler: () => {
            const node = CRXB.util.getCurrent('node');
            const location = CRX.Util.getLaunchpadContextPath().replace(/crx\/de\/?$/i, '')
                + '/editor.html'
                + CRX.Util.getLocalWorkspacePath(node.getRealPath()).replace(/\/$/, '')
                + '.html';
            window.open(location);
        }
    });
    CRX.ide.OpenPageEditAction.checkActive = function() {
        const currentNode = CRXB.util.getCurrent('node');
        const isPage = currentNode.ui.iconNode.classList.contains('page');
        const disabled = !currentNode || !isPage || GM_getValue('profile:settings')['prefer-edit-mode'];
        this.setDisabled(disabled);
    };

    return [CRX.ide.OpenPageViewAction, CRX.ide.OpenPageEditAction];
};
