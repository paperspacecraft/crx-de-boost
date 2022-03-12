CRXB.util.getDisplayAsMenu = function() {
    const displayAsItems = [
        {
            text: 'JSON',
            handler: () => {
                const path = CRXB.util.getCurrent('path') || '/';
                window.open( path + '.tidy.-1.json')
            }
        },
        {
            text: 'XML',
            handler: () => window.open(CRXB.util.getCurrent('path') + '.xml')
        }
    ];
    return new Ext.menu.Item({
        text: 'Display as',
        menu: new Ext.menu.Menu({
            id: 'display_as',
            cls: 'x-menu-detached',
            items: displayAsItems
        }),
    });
}

