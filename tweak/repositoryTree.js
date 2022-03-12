CRXB.tweaks.modifyRepositoryTree = function() {

    // Define highlight colors

    const highlightColors = CRXB.settings.get('highlight-colors');

    // Tree sorting, UX and menu tweaks

    Ext.override(CRX.ide.RepositoryTree, {
        parentInitComponent: CRX.ide.RepositoryTree.prototype.initComponent,
        initComponent: function() {

            this.parentInitComponent();

            const normalizeColorName = (color) => color.toLowerCase().replace(/\s+/g, '-');

            // Create bookmark action and menu items
            const storeBookmark = (color) => {
                const current = CRXB.util.getCurrent();
                if (!current) {
                    return;
                }
                const currentBookmarkedNodes = GM_getValue('profile:bookmarkedNodes') || {};
                highlightColors.each(col => current.node.ui.removeClass('highlight-' + normalizeColorName(col)));
                if (color !== 'None') {
                    currentBookmarkedNodes[current.path] = normalizeColorName(color);
                } else {
                    delete currentBookmarkedNodes[current.path];
                }
                current.node.ui.addClass('highlight-' + normalizeColorName(color));
                GM_setValue('profile:bookmarkedNodes', currentBookmarkedNodes);
            };
            const colorItems = highlightColors.map(col =>  {return {text: col, iconCls: 'action-highlight-' + normalizeColorName(col), handler: () => storeBookmark(col)}; });
            this.contextMenu.add([
                {
                    text: 'Bookmark',
                    iconCls: 'action-highlight',
                    menu: new Ext.menu.Menu({
                        id: 'highlight_colors',
                        cls: 'x-menu-detached bookmarks',
                        items: colorItems
                    })
                }
            ]);

            // Implement alphabetical sorter
            this.sorter = new Ext.tree.TreeSorter(this, {
                dir: "ASC",
                sortedNodes: GM_getValue('profile:sortedNodes') || [],
                doSort: function(node) {
                    const nodeType = CRX.NodetypeRegistry.getNodetype(node.getPrimaryType());
                    if ((Array.isArray(this.sortedNodes) && this.sortedNodes.some(entry => CRX.Util.getLocalWorkspacePath(node.getRealPath()) === entry))
                        || !nodeType.hasOrderableChildNodes
                    ) {
                        node.sort(CRXB.util.sortNodes);
                    }
                }
            });


            // Hide the upper toolbar
            this.filterField.hidden = false;
            this.remove(this.tools, false);

            // Move the filter bar underneath the tree
            this.elements = this.elements.replace('tbar', 'bbar');
            const bbar = this.initialConfig.tbar;
            this.bottomToolbar = bbar;
            bbar.style = 'margin-top: 2px';
            delete this.topToolbar;


            this.on('afterrender', function() {

                // Make node editor not pop up on single click
                this.un('beforeclick', this.editor.beforeNodeClick, this.editor);

            });

            // Lock the dropped node from being dragged again unless explicitly allowed
            this.on('nodedrop', function(event) {
                if (CRX.ide.LockDragAction) {
                    CRX.ide.LockDragAction.execute(event.dropNode);
                }
            });
        }
    });

    Ext.override(CRX.ide.RepositoryTree.TreeLoader, {
        parentProcessNewChild: CRX.ide.RepositoryTree.TreeLoader.prototype.processNewChild,
        processNewChild: function(child, data) {
            this.parentProcessNewChild(child, data);

            if (!this.bookmarkedNodes) {
                this.bookmarkedNodes = GM_getValue('profile:bookmarkedNodes') || {};
            }
            if (!this.sortedNodes) {
                this.sortedNodes = GM_getValue('profile:sortedNodes') || [];
            }

            const classes = [];
            const highlightColor = this.bookmarkedNodes[CRX.Util.getLocalWorkspacePath(child.getRealPath())];

            if (highlightColor) {
                classes.push('highlight-' + highlightColor);
            }
            if (this.sortedNodes.some(entry => CRX.Util.getLocalWorkspacePath(child.getRealPath()) === entry)) {
                child.sorted = true;
                classes.push('sorted');
            } else {
                delete child.sorted;
            }

            (child.attributes || {}).cls = classes.join(' ');

            child.draggable = !!CRXB.settings.get('allow-dragging');
        },

        parentCreateNode: CRX.ide.RepositoryTree.TreeLoader.prototype.createNode,
        createNode: function(attr) {
            const node = this.parentCreateNode(attr);
            node.draggable = !!CRXB.settings.get('allow-dragging');
            return node;
        }
    });
};