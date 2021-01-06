CRXB.tweaks.modifyKeyMappings = function() {
    // Remove some of the global key bindings
    const globalKeyMap = CRX.Util.getGlobalKeyMap();
    [
        'global.search',
        'global.movenode',
        'global.copynode',
        'global.pastenode',
        'global.overlaynode',
    ].forEach(binding => globalKeyMap.bindings.remove(globalKeyMap.bindings.get(binding)));

    globalKeyMap.addBinding({
        name: 'global.revert',
        desc: 'Revert all',
        key: 'z',
        ctrl: true,
        stopEvent: false,
        fn: function(code, event) {
            if (!event.target || (event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA')) {
                CRX.ide.executeShortcut(CRX.ide.RevertAllAction);
            } else {
                document.execCommand('undo', false, null);
            }
        }
    });

    // Set shortcuts for the repository tree
    const repository = Ext.getCmp(CRX.ide.TREE_ID);
    repository.on('afterrender', function() {
        repository.keyMap.disable();
        delete repository.keyMaps;
        CRX.ide.RepositoryKeyMap = new Ext.KeyMap(repository.el.dom.querySelector('.x-panel-body'), [
            {
                name: 'delete',
                desc: 'Delete selected node',
                key: 46,
                scope: this,
                stopEvent: true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.DeleteNodeAction); }
            },
            {
                name: 'movenode',
                desc: 'Move selected node',
                key: 117,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.MoveNodeAction); }
            },
            {
                name: 'copynode',
                desc: 'Copy selected node',
                key: 'c',
                ctrl:true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.CopyNodeAction); }
            },
            {
                name: 'copynode.alt',
                desc: 'Copy selected node',
                key: 45,
                ctrl:true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.CopyNodeAction); }
            },
            {
                name: 'pastenode',
                desc: 'Paste node from clipboard',
                key: 'v',
                ctrl:true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.PasteNodeAction); }
            },
            {
                name: 'pastenode',
                desc: 'Paste node from clipboard',
                key: 45,
                shift: true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.PasteNodeAction); }
            }
        ]);
    });

    // Set shortcuts for the properties grid
    const grid = Ext.getCmp(CRX.ide.PROPERTIES_ID);
    grid.on('afterrender', function() {
        grid.bodyKeyMap.disable();
        delete grid.bodyKeyMap;
        CRX.ide.PropertyGridKeyMap = new Ext.KeyMap(grid.el.dom, [
            {
                name: 'deleteproperty',
                desc: 'Delete selected property',
                key: 46,
                scope: this,
                stopEvent: true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.DeletePropertyAction); }
            },
            {
                name: 'copyproperty',
                desc: 'Copy selected property',
                key: 'c',
                ctrl:true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.CopyPropertyAction); }
            },
            {
                name: 'copyproperty.alt',
                desc: 'Copy selected property',
                key: 45,
                ctrl:true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.CopyPropertyAction); }
            },
            {
                name: 'pasteproperty',
                desc: 'Paste property from clipboard',
                key: 'v',
                ctrl:true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.PastePropertyAction); }
            },
            {
                name: 'pasteproperty',
                desc: 'Paste property from clipboard',
                key: 45,
                shift: true,
                stopEvent:true,
                fn: function() { CRX.ide.executeShortcut(CRX.ide.PastePropertyAction); }
            }
        ]);
    });
};