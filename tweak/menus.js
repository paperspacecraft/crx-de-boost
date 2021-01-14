CRXB.tweaks.modifyMenus = function() {
    //
    // Main panel menu
    //
    const topToolbar = Ext.getCmp(CRX.ide.TOOLBAR_ID);
    CRXB.util.arrangeMenu(topToolbar, [
        CRX.ide.RefreshAction,
        'Save All',
        ' ',
        'Create ...',
        CRX.ide.RenameNodeAction,
        ' ',
        CRX.ide.CopyNodeAction,
        CRX.ide.PasteNodeAction,
        CRX.ide.MoveNodeAction,
        CRX.ide.DeleteNodeAction,
        ' ',
        new Ext.Toolbar.SplitButton({
            text: 'Package',
            iconCls: 'nav-package',
            menu: new Ext.menu.Menu({
                items: [
                    new Ext.menu.Item({
                       text: 'Package manager',
                       iconCls: 'nav-package',
                       handler: function () {
                           window.open('../packmgr/index.jsp', '_blank');
                       }
                    }),
                    '-',
                    CRXB.util.getDownloadAction(),
                    '-',
                    CRXB.util.getUploadDialogAction(),
                    CRXB.util.getUploadClipboardAction()
                ]
            }),
            handler: function() {
                this.showMenu();
            }
        }),
        new Ext.Toolbar.SplitButton({
            text: 'Node',
            iconCls: 'action-nodetree',
            handler: function() {
                this.showMenu();
            },
            menu: new Ext.menu.Menu({
                items: [
                    CRXB.util.getReplicationDialogActions(),
                    CRXB.util.getAccessControlDialogAction(),
                    '-',
                    CRX.ide.OverlayNodeAction,
                    {
                        text: 'Node types',
                        menu: new Ext.menu.Menu({
                            id: 'node-types',
                            items: [
                                CRX.ide.ExportNodeTypeAction,
                                CRX.ide.ImportNodeTypeAction
                            ]
                        })
                    },
                ]
            })
        }),
        ' ',
        'Tools',
        ' ',
        new Ext.Button({
            text: 'Site',
            iconCls: 'nav-siteadmin',
            handler: function() {
                window.open('../../siteadmin', '_blank');
            }
        }),
        new Ext.Button({
            text: 'Users',
            iconCls: 'nav-useradmin',
            handler: function() {
                window.open('../../useradmin', '_blank');
            }
        }),
        new Ext.Button({
            text: 'DAM',
            iconCls: 'nav-damadmin',
            handler: function() {
                window.open('../../damadmin', '_blank');
            }
        }),
        new Ext.Button({
            text: 'Misc',
            iconCls: 'nav-miscadmin',
            handler: function() {
                window.open('../../miscadmin', '_blank');
            }
        }),
        '->',
        CRX.ide.LOGINBUTTON_ID
    ]);

    // Assign button icons
    CRXB.util.modifyMenuItem(topToolbar, CRX.ide.RefreshAction, item => item.text = 'Refresh');
    CRXB.util.modifyMenuItem(topToolbar, 'Save All', item => item.iconCls = 'action-save');
    CRXB.util.modifyMenuItem(topToolbar, 'Create ...', item => {item.iconCls = 'action-add'; item.text = 'Create';});
    CRXB.util.modifyMenuItem(topToolbar, CRX.ide.RenameNodeAction, item => item.iconCls = 'action-edit');
    CRXB.util.modifyMenuItem(topToolbar, CRX.ide.CopyNodeAction, item => item.iconCls = 'action-copy');
    CRXB.util.modifyMenuItem(topToolbar, CRX.ide.PasteNodeAction, item => item.iconCls = 'action-paste');
    CRXB.util.modifyMenuItem(topToolbar, CRX.ide.MoveNodeAction, item => item.iconCls = 'action-move');
    CRXB.util.modifyMenuItem(topToolbar, CRX.ide.DeleteNodeAction, item => item.iconCls = 'action-delete');
    CRXB.util.modifyMenuItem(topToolbar, 'Tools', item => item.iconCls = 'action-tools');

    //
    // Repository tree context menu
    //
    const treeContextMenu = Ext.getCmp(CRX.ide.TREE_ID).contextMenu;
    CRXB.util.arrangeMenu(treeContextMenu, [
        CRXB.util.getOpenPageActions(),
        CRX.ide.CreateNodeAction,
        CRX.ide.RenameNodeAction,
        '-',
        CRX.ide.CopyNodeAction,
        CRX.ide.PasteNodeAction,
        CRX.ide.DeleteNodeAction,
        '-',
        CRX.ide.MoveNodeAction,
        CRXB.util.getDragActions(),
        '-',
        CRX.ide.OverlayNodeAction,
        CRXB.util.getAccessControlDialogAction(),
        '-',
        CRXB.util.getReplicationDialogActions(),
        '-',
        CRXB.util.getDownloadAction(),
        '-',
        CRXB.util.getSortAction(),
        CRXB.util.getUnsortAction(),
        'Bookmark'
    ], {
        'Tools': 'hide',
        'Open ...': 'hide'
    });
    treeContextMenu.cls = 'x-menu-detached hide-disabled';

    // Assign button icons
    CRXB.util.modifyMenuItem(treeContextMenu, CRX.ide.RenameNodeAction, item => item.iconCls = 'action-edit');
    CRXB.util.modifyMenuItem(treeContextMenu, CRX.ide.MoveNodeAction, item => item.iconCls = 'action-move');
    CRXB.util.modifyMenuItem(treeContextMenu, CRXB.util.getDragActions(), item => item.iconCls = 'action-drag');

    //
    // Properties context menu
    //
    const propertiesContextMenu = Ext.getCmp(CRX.ide.PROPERTIES_ID).contextMenu;
    CRXB.util.arrangeMenu(propertiesContextMenu, [
        CRXB.util.getPropertyDialogActions(),
        CRX.ide.CopyPropertyAction,
        CRX.ide.PastePropertyAction,
        CRX.ide.EditMixinAction,
        CRX.ide.DeletePropertyAction
    ]);
    propertiesContextMenu.cls = 'x-menu-detached hide-disabled';

    CRXB.util.modifyMenuItem(propertiesContextMenu, CRX.ide.EditMixinAction, item => item.iconCls = 'action-mixin');

    //
    // Tools menu
    //
    CRXB.util.arrangeMenu(CRX.ide.ToolsMenu, [
        CRX.ide.QueryAction,
        '-',
        CRX.ide.PrivilegesAction,
        CRX.ide.TestAccessControlAction,
        '-',
        CRXB.util.getSettingsDialogAction()
    ]);
};