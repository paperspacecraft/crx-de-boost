CRXB.tweaks.openPageInEditMode = function() {

    Ext.override(CRX.ide.PageEditor, {
        open: function() {
            const node = CRXB.util.getCurrent().node;
            const openInEditMode = GM_getValue('profile:settings')['prefer-edit-mode'];
            const [openStraight, openEdit] = CRXB.util.getOpenPageActions();

            if (openInEditMode) {
                openEdit.execute();
            } else {
                openStraight.execute();
            }
        }
    });

};