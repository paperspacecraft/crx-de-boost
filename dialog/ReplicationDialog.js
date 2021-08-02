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

CRXB.util.getReplicationDialogActions = function() {
    if (CRX.ide.ReplicationDialogAction) {
        return [CRX.ide.ReplicationDialogAction, CRX.ide.ReplicationActivateAction, CRX.ide.ReplicationDeactivateAction];
    }

    CRXB.util.registerReplicationDialog();

    CRX.ide.ReplicationDialogAction = new Ext.Action({
        text: 'Replication ...',
        iconCls: 'action-replicate',
        dialogId: 'replicationdialog',
        handler: CRX.Util.openActionDialog
    });

    const DIALOG_WIDTH = 420;
    const handleException = function(title, e) {
        Ext.Msg.show({
            title: title,
            msg: `Could not ${title.toLowerCase()} <em>${path}</em>: ${e.message || e}`,
            width: DIALOG_WIDTH,
            buttons: Ext.Msg.OK,
            iconCls: Ext.Msg.ERROR
        });
    };

    CRX.ide.ReplicationActivateAction = new Ext.Action({
        text: 'Activate',
        handler: async function() {
            const path = CRXB.util.getCurrent('path');
            if (!path) {
                return;
            }
            const formData = [
                'path=' + encodeURIComponent(path),
                'action=replicate',
                '_charset_=utf-8'
            ];

            try {
                const response = await fetch('replication.jsp', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                    },
                    body: formData.join('&')
                });
                if (response.ok) {
                    Ext.Msg.show({
                        title: 'Activation',
                        msg: `Initiated activation of <em>${path}</em>`,
                        width: DIALOG_WIDTH,
                        buttons: Ext.Msg.OK,
                        icon: Ext.Msg.INFO
                    });
                } else {
                    handleException('Activate', response.statusText);
                }
            } catch (e) {
                handleException('Activate', e);
            }
        }
    });

    CRX.ide.ReplicationDeactivateAction = new Ext.Action({
        text: 'Deactivate',
        handler: async function() {
            const path = CRXB.util.getCurrent('path');
            if (!path) {
                return;
            }
            const formData = [
                'path=' + encodeURIComponent(path),
                'action=replicatedelete',
                '_charset_=utf-8'
            ];

            try {
                const response = await fetch('replication.jsp', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                    },
                    body: formData.join('&')
                });
                if (response.ok) {
                    Ext.Msg.show({
                        title: 'Activation',
                        msg: `Initiated deactivation of <em>${path}</em>`,
                        width: DIALOG_WIDTH,
                        buttons: Ext.Msg.OK,
                        icon: Ext.Msg.INFO
                    });
                } else {
                    handleException('Deactivate', response.statusText);
                }
            } catch (e) {
                handleException('Deactivate', e);
            }
        }
    });

    return [CRX.ide.ReplicationDialogAction, CRX.ide.ReplicationActivateAction, CRX.ide.ReplicationDeactivateAction];
};