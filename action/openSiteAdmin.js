CRXB.util.getOpenInSiteAdminAction = function() {
    if (CRX.ide.openInSiteAdminAction) {
        return CRX.ide.openInSiteAdminAction;
    }
    CRX.ide.openInSiteAdminAction = new Ext.Action({
        text: 'Open in SiteAdmin',
        iconCls: 'nav-siteadmin',
        handler: () => {
            const path = CRXB.util.getCurrent('path');
            if (!path) {
                return;
            }
            window.open('/siteadmin#' + path, '_blank');
        }
    });
    CRX.ide.openInSiteAdminAction.checkActive = function() {
        const isContentPath = /^\/content\//.test(CRXB.util.getCurrent('path'));
        const isPage = CRXB.util.getCurrent('node').ui.iconNode.classList.contains('page');
        const disabled = !isContentPath || !isPage;
        this.setDisabled(disabled);
    };

    return CRX.ide.openInSiteAdminAction;
};