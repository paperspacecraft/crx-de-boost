CRXB.util.registerAccessControlDialog = function() {
    if (CRX.ide.AccessControlDialog) {
        return;
    }

    CRX.ide.AccessControlDialog = Ext.extend(Ext.Window, {
        cls: 'accesscontrol',
        title: 'Access Control',
        modal: true,
        width: 640,
        height: 420,
        closeAction: 'hide',
        layout: 'fit',
        buttonAlign: 'center',

        constructor: function(config) {
            config = config || {};
            this.aclPanel = new CRX.ide.DetailsAccessControlPanel();

            Ext.applyIf(config, {
                items: [this.aclPanel]
            });

            CRX.ide.AccessControlDialog.superclass.constructor.call(this, config);
        },

        initComponent: function() {
            CRX.ide.AccessControlDialog.superclass.initComponent.call(this);
            this.on('show', function() {
                const path = this.node ? CRX.Util.getLocalWorkspacePath(this.node.getRealPath()) : CRXB.util.getCurrent('path');
                if (path) {
                    this.aclPanel.meActive = true;
                    this.aclPanel.setCurrentPath(path);
                }
            });
        },

        init: function(node) {
            this.node = node;
        }
    });

    CRX.ide.AccessControlDialog.getInstance = (function() {
        const id = Ext.id();
        return function() {
            return Ext.WindowMgr.get(id) || new CRX.ide.AccessControlDialog({ id: id });
        }
    })();

    Ext.reg('accesscontroldialog', CRX.ide.AccessControlDialog);
};

CRXB.util.getAccessControlDialogAction = function() {
    if (CRX.ide.AccessControlDialogAction) {
        return CRX.ide.AccessControlDialogAction;
    }

    CRXB.util.registerAccessControlDialog();

    CRX.ide.AccessControlDialogAction = new Ext.Action({
        text: 'Access Control ...',
        iconCls: 'action-access',
        dialogId: 'accesscontroldialog',
        handler: CRX.Util.openActionDialog
    });
    return CRX.ide.AccessControlDialogAction;
};