CRXB.tweaks.modifyQueryPanel = function() {
    Ext.override(CRX.ide.QueryPanel, {
        parentInitComponent: CRX.ide.QueryPanel.prototype.initComponent,

        initComponent: function() {
            this.parentInitComponent();

            this.title = 'QUERY';
            this.layout = 'fit';
            this.items.removeAt(1);
        }

    });


    CRXB.util.getQueryActions = function() {
        if (CRX.ide.XPathQueryAction) {
            return [CRX.ide.QueryAction, CRX.ide.XPathQueryAction];
        }

        CRX.ide.QueryAction = new Ext.Action({
            text: 'Query (JCR-SQL2)',
            iconCls: 'action-query-sql',
            handler: function(type = 'sql') {
                const main = Ext.getCmp(CRX.ide.MAIN_ID);
                const editor = main.editors.add({
                    xtype: 'querypanel',
                    closable: true,
                    type: type
                });
                main.editors.activate(editor);
            }
        });

        CRX.ide.XPathQueryAction = new Ext.Action({
            text: 'Query (JCR-SQL2)',
            iconCls: 'query',

        });

        return [CRX.ide.QueryAction, CRX.ide.XPathQueryAction];
    }
};