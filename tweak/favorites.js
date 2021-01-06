CRXB.tweaks.addFavorites = function () {

    CRX.ide.FavMenu = new Ext.menu.Menu({
        cls: 'bookmarks light'
    });

    const mainPanel = Ext.getCmp(CRX.ide.MAIN_ID);
    const addressPanel = mainPanel.items[1].items[0];
    addressPanel.items.push(new Ext.Toolbar.SplitButton({
        iconCls: 'action-favorites',
        width: 16,
        menu: CRX.ide.FavMenu,
        handler: function() {
            this.showMenu();
        }
    }));

    const resetMenu = function(bookmarkedNodes) {
        bookmarkedNodes = bookmarkedNodes || GM_getValue('profile:bookmarkedNodes') || {};
        CRX.ide.FavMenu.removeAll(true);
        Object.keys(bookmarkedNodes).sort().forEach(k => {
            CRX.ide.FavMenu.add(new Ext.menu.Item({
                text: k,
                iconCls: 'action-highlight-' + bookmarkedNodes[k].toLowerCase().replace(/\s+/g, '-'),
                handler: () => CRXB.util.setLocation(k)
            }));
        });
    };

    GM_addValueChangeListener('profile:bookmarkedNodes', function(name, old_value, new_value) {
        resetMenu(new_value);
    });

    resetMenu();
};