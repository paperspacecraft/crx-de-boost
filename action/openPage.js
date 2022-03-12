CRXB.util.getOpenPageMenu = function() {

    if (CRX.ide.OpenPageActions) {
        return CRX.ide.OpenPageActions;
    }

    CRX.ide.OpenPageViewAction = new Ext.Action({
        text: 'In preview mode',
        handler: () => {
            const node = CRXB.util.getCurrent('node');
            const location = CRX.Util.getLaunchpadContextPath()
                + CRX.Util.getLocalWorkspacePath(node.getRealPath())
                + '.html?wcmmode=disabled';
            window.open(location);
        }
    });
    CRX.ide.OpenPageEditAction = new Ext.Action({
        text: 'In edit mode',
        handler: () => {
            const node = CRXB.util.getCurrent('node');
            const location = CRX.Util.getLaunchpadContextPath().replace(/crx\/de\/?$/i, '')
                + '/editor.html'
                + CRX.Util.getLocalWorkspacePath(node.getRealPath()).replace(/\/$/, '')
                + '.html';
            window.open(location);
        }
    });

    CRX.ide.OpenPageActions = new Ext.menu.Item({
        text: 'Open page',
        iconCls: 'action-link',
        menu: new Ext.menu.Menu({
            id: 'open_page',
            cls: 'x-menu-detached',
            items: [CRX.ide.OpenPageViewAction, CRX.ide.OpenPageEditAction]
        }),
    });
    CRX.ide.OpenPageActions.baseAction = {
        checkActive: function() {
            const currentNode = CRXB.util.getCurrent('node');
            const isPage = currentNode.ui.iconNode.classList.contains('page');
            const disabled = !currentNode || !isPage;
            this.setDisabled(disabled);
        }
    };
    return CRX.ide.OpenPageActions;
}