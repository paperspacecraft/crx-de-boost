CRXB.tweaks.modifyPropertyPanel = function() {
    Ext.override(CRX.ide.PropertyPanel, {
        parentInitComponent: CRX.ide.PropertyPanel.prototype.initComponent,

        initComponent: function() {
            this.parentInitComponent();

            // Create the new toolbar
            this.bottomToolbar.hide();
            this.elements += ',tbar';
            this.topToolbar = new Ext.Toolbar({
                id: 'custom-properties-toolbar',
                items: [
                    CRXB.util.getPropertyDialogActions(),
                    ' ',
                    CRX.ide.CopyPropertyAction,
                    CRX.ide.PastePropertyAction,
                    ' ',
                    CRX.ide.EditMixinAction,
                    ' ',
                    CRX.ide.DeletePropertyAction,
                ]
            });
            CRXB.util.modifyMenuItem(this.topToolbar, CRX.ide.EditMixinAction, item => item.iconCls = 'action-mixin');

            // Implement toolbar/menu buttons dynamic enable/disable
            this.getSelectionModel().addListener('selectionchange', () => {
                this.topToolbar.items.each(function(action) {
                    if (!action.baseAction) {
                        return;
                    }
                    if (action.baseAction.checkActive) {
                        action.baseAction.checkActive.call(action);
                    }
                });
            });

            // Fix context menu not being shown properly
            this.addListener('rowcontextmenu', function(grid, index, e) {
                const sm = grid.getSelectionModel();
                if (!sm.hasSelection() || !sm.isSelected(index)) {
                    sm.selectRow(index);
                }
                const menu = grid.contextMenu;
                if (menu.fireEvent('beforeshow', this) !== false) {
                    // const contextMenuHeight = this.contextMenu.items.length * CONTEXT_MENU_ITEM_HEIGHT;
                    menu.showAt(0, 0);
                    const contextMenuHeight = menu.el.getHeight();
                    const xy = Ext.get(grid.getView().getRow(index)).getAnchorXY();
                    const xPos = xy[0];
                    let yPos = xy[1];
                    if (yPos + contextMenuHeight > window.innerHeight) {
                        yPos = window.innerHeight - contextMenuHeight;
                    }
                    menu.showAt([e.getXY()[0], yPos]);
                }
                e.stopEvent();
            });

            // Initialize checker object for verifying text values as links
            this.linkChecker = new CrxLinkChecker(Ext);
        },

        // Ensure dialog window opens as user clicks on a grid row
        onCellDblClick: function() {
            const editAction = this.topToolbar.items.find(item => item.baseAction === CRX.ide.EditPropertyDialogAction);
            if (editAction && !editAction.disabled) {
                editAction.baseAction.execute();
            }
        },

        // Render JCR links as links
        parentRenderValueItem: CRX.ide.PropertyPanel.prototype.renderValueItem,
        renderValueItem: function(value, record, index) {
            const type = record.get('type');
            const isMultiple = record.get('isMultiple');
            const isProtected = record.get('isProtected');

            const verifyPath = (text) => {
                // Uncomment this to skip testing 'fully-qualified' JCR paths, those starting with '/'
                // if (/^(\/[\w-:]+)+(\.\w+)$/.test(text)) {
                //     return true;
                // }
                if (/^(\/[\w-:]+)+(\.\w+)?$|^[\w-]+(\/[\w-:]+)+(\.\w+)?$/.test(text)) {
                    return this.linkChecker.check(text, (result) => {
                        if (result === true) {
                            record.data.verifiedPath = text;
                        } else if (result) {
                            record.data.verifiedPath = result;
                        } else {
                            record.data.verifiedPath = false;
                        }
                        if (!this.linkCheckerRefreshTask) {
                            this.linkCheckerViewRefreshTask = new  Ext.util.DelayedTask(() => this.getView().refresh(), this);
                        }
                        this.linkCheckerViewRefreshTask.delay(500);
                    });
                }
            };

            if (record.data.hasOwnProperty('verifiedPath')) {
                let verifiedPath = record.data.verifiedPath;
                delete record.data.verifiedPath;
                if (verifiedPath) {
                    return '<a href="index.jsp#' + verifiedPath + '">' + Ext.util.Format.htmlEncode(value) + '</a>';
                } else {
                    return value;
                }
            }

            if ((type === CRX.util.STRING || type === CRX.util.PATH) && !isMultiple && !isProtected) {
                let verifiedPath = verifyPath(value);
                if (verifiedPath === true) {
                    verifiedPath = value;
                }
                if (verifiedPath) {
                    return '<a href="index.jsp#' + verifiedPath + '">' + Ext.util.Format.htmlEncode(value) + '</a>';
                }
            }

            if (type === CRX.util.URI && !isMultiple && !isProtected) {
                return '<a href="' + value + '" target="_blank">' + Ext.util.Format.htmlEncode(value) + '</a>';
            }

            return this.parentRenderValueItem(value, record, index);
        },
    });
};