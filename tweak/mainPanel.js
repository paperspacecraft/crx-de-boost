CRXB.tweaks.modifyMainPanel = function() {
    Ext.override(CRX.ide.MainPanel, {
        parentInitComponent: CRX.ide.MainPanel.prototype.initComponent,
        initComponent: function() {
            this.parentInitComponent();

            //
            // Header part
            //

            // Remove the upper panel ("switcher")
            this.remove(this.items.get(0), true);

            //
            // Repository tree
            //

            const repositoryTree = Ext.getCmp(CRX.ide.TREE_ID);
            repositoryTree.title = 'JCR';

            const repositoryWrapper = new Ext.TabPanel({
                id: 'repository-wrapper',
                region: "west",
                width: 400,
                activeTab: 0,
                split: true,
            });
            this.items.get(0).insert(1, repositoryWrapper);
            repositoryWrapper.add(repositoryTree);

            //
            // Properties
            //

            // Remove the logging, access control, and replication panels
            const toolsWrapperPanel =  Ext.getCmp(CRX.ide.TOOLS_WRAPPER_ID);
            const toolsPanel = Ext.getCmp(CRX.ide.TOOLS_ID);
            toolsPanel.remove(toolsPanel.items.get(CRX.ide.LOGGING_ID), true);
            toolsPanel.remove(toolsPanel.items.get(CRX.ide.ACCESS_CONTROL_ID), true);
            toolsPanel.remove(toolsPanel.items.get(CRX.ide.REPLICATION_ID), true);

            const propertiesPanel = toolsPanel.items.get(CRX.ide.PROPERTIES_ID);
            propertiesPanel.region = 'center';
            toolsWrapperPanel.add(propertiesPanel);
            toolsWrapperPanel.remove(toolsPanel, true);

            // Adjust properties panel height
            toolsWrapperPanel.initialConfig.height = 480;
            if (toolsWrapperPanel.height < toolsWrapperPanel.initialConfig.height) {
                toolsWrapperPanel.height = toolsWrapperPanel.initialConfig.height;
            }

            //
            // General layout tweaks
            //

            // Manipulate margins
            const mainPanel = this.items.get(0);
            const addressBar = mainPanel.items.get(0);
            const panelW = mainPanel.items.get(1);
            const panelE = mainPanel.items.get(2);

            addressBar.initialConfig.margins = '0 0 4 0';
            panelW.initialConfig.margins = '0 0 0 0';
            panelE.initialConfig.margins = '0 0 0 0';

            // Disable editors' tabs resizing
            const panelNE = panelE.items.get(0);
            panelNE.resizeTabs = false;
        }
    });
};