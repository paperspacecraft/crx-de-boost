CRXB.util.registerReplicationDialog = function() {
    if (CRX.ide.ReplicationDialog) {
        return;
    }

    CRX.ide.ReplicationDialog = Ext.extend(Ext.Window, {
        cls: 'replication',
        title: 'Replication',
        modal: true,
        width: 640,
        height: 420,
        closeAction: 'hide',
        layout: 'fit',
        buttonAlign: 'center',

        constructor: function(config) {
            config = config || {};
            this.replicationPanel = new CRX.ide.ReplicationPanel();

            Ext.applyIf(config, {
                xtype: 'replicationdialog',
                items: [this.replicationPanel]
            });

            CRX.ide.ReplicationPanel.superclass.constructor.call(this, config);
        },

        initComponent: function() {
            CRX.ide.ReplicationDialog.superclass.initComponent.call(this);
            this.on('show', function() {
                const path = this.node ? CRX.Util.getLocalWorkspacePath(this.node.getRealPath()) : CRXB.util.getCurrent('path');
                if (path) {
                    this.setTitle('Replication: ' + path);
                    this.replicationPanel.meActive = true;
                    this.replicationPanel.setCurrentPath(path);
                }
            });
        },

        init: function(node) {
            this.node = node;
        }
    });

    CRX.ide.ReplicationDialog.getInstance = (function() {
        const id = Ext.id();
        return function() {
            return Ext.WindowMgr.get(id) || new CRX.ide.ReplicationDialog({ id: id });
        }
    })();

    Ext.reg('replicationdialog', CRX.ide.ReplicationDialog);
};

CRXB.util.getReplicationDialogAction = function() {
    if (CRX.ide.ReplicationDialogAction) {
        return CRX.ide.ReplicationDialogAction;
    }

    CRXB.util.registerReplicationDialog();

    CRX.ide.ReplicationDialogAction = new Ext.Action({
        text: 'Replicate ...',
        iconCls: 'action-replicate',
        dialogId: 'replicationdialog',
        handler:CRX.Util.openActionDialog
    });
    return CRX.ide.ReplicationDialogAction;
};