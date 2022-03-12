CRXB.tweaks.openPageInEditMode = function() {

    Ext.override(CRX.ide.PageEditor, {
        open: function() {
            const node = CRXB.util.getCurrent().node;
            const openInEditMode = CRXB.settings.get('prefer-edit-mode');

            if (openInEditMode) {
                CRX.ide.OpenPageEditAction.execute();
            } else {
                CRX.ide.OpenPageViewAction.execute();
            }
        }
    });

};