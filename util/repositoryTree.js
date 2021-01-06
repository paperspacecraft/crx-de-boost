CRXB.util.setLocation = function(value, options = {ensureVisible: true}) {
    const repositoryWrapper = Ext.getCmp('repository-wrapper');
    if (repositoryWrapper && repositoryWrapper.items.getCount() > 1 && options.ensureVisible) {
        options.scrollToPath = false;
        CRXB.util.loadPathAsync(value, options)
            .then((node) => {
                repositoryWrapper.setActiveTab(0);
                node.ui.anchor.scrollIntoView({
                    block: 'center',
                });
                node.ui.anchor.closest('.x-panel-body').scrollLeft = 0;
            })
            .catch(() => repositoryWrapper.setActiveTab(0));
    } else {
        CRXB.util.loadPath(value, options);
    }
};

CRXB.util.loadPath = function(path, options = {}) {
    const MAX_NODES_BEFORE_SHRINK = 750;
    const PAUSE_BEFORE_MODAL_MS = 300;

    if (options.scrollToPath === undefined) {
        options.scrollToPath = options.ensureVisible;
    }

    const repositoryTree = Ext.getCmp(CRX.ide.TREE_ID);

    path = (path.substr(0, 1) !== '/' ? '/' : '') + path.replace(/[^\w-,./]/g, v => encodeURIComponent(v));

    const checkButtonsTask = function(itemHolder) {
        if (!itemHolder.items || !itemHolder.items.each) {
            return;
        }
        itemHolder.items.each(item => {
            if (item.baseAction && item.baseAction.checkActive) {
                item.baseAction.checkActive.call(item);
            }
        })
    };

    let modalMask;
    const modalShowingTask = new Ext.util.DelayedTask(() => {
       if (Ext.MessageBox.isVisible()) {
           return;
       }
       modalMask = new Ext.LoadMask(Ext.getBody());
       modalMask.show();
    });
    modalShowingTask.delay(PAUSE_BEFORE_MODAL_MS);

    const expandTask = function() {
        repositoryTree.showPath(path, function(success, node) {
            modalShowingTask.cancel();
            if (modalMask) {
                modalMask.hide();
            }
            if (!success || !node) {
                console.error(`Could not load "${path}"`);
                if (options.cb) {
                    options.cb(success, node);
                }
                return;
            }
            const main = Ext.getCmp(CRX.ide.MAIN_ID);
            main.updatePath(node);
            main.updateAccessControl(node);
            main.updateReplication(node);
            main.showProperties(node);

            checkButtonsTask(Ext.getCmp(CRX.ide.TOOLBAR_ID));

            if (options.cb) {
                options.cb(success, node);
            }
            if (options.scrollToPath) {
                node.ui.anchor.scrollIntoView({
                    block: 'center',
                });
                node.ui.anchor.closest('.x-panel-body').scrollLeft = 0;
            }

            Ext.History.add(CRX.Util.convertTreeToJcrPath(node.getRawPath()));
        });
    };

    document.body.querySelectorAll('.x-tip').forEach(n => n.style.visibility = 'hidden');

    if (options.shrinkOthers && CRXB.util.getTreeCount() > MAX_NODES_BEFORE_SHRINK) {
        repositoryTree.getRootNode().reload(expandTask);
    } else {
        expandTask();
    }

};

CRXB.util.loadPathAsync = function(path, options = {}) {
    return new Promise((resolve, reject) => {
        const exCb = options.cb;
        options.cb = (success, node) => {
           if (success && node) {
               if (exCb) {
                   exCb(success, node);
               }
               resolve(node);
           } else {
               reject();
           }
        };
       CRXB.util.loadPath(path, options);
    });
};

CRXB.util.getCurrent = function(param) {
    const node = Ext.getCmp(CRX.ide.TREE_ID).getSelectionModel().getSelectedNode();
    const result = {node: node};
    if (node) {
        result.path = CRXB.util.nodeToJcrPath(node);
    }
    return param ? result[param] : result;
};

CRXB.util.nodeToJcrPath = function(node) {
    node = node || CRXB.util.getCurrent('node');
    if (!node) {
        return '';
    }
    let realPath = node.getRealPath();
    if (realPath.indexOf(CRX.ide.JCR_ROOT_NAME) > 0) {
        realPath = realPath.split(CRX.ide.JCR_ROOT_NAME)[1];
    }
    return realPath;
};

CRXB.util.findNearestCommon = function(node, path) {
    let currentNode = node;
    let currentPath = CRXB.util.nodeToJcrPath(currentNode);
    if (currentPath === path) {
        return currentNode;
    }
    while (path.indexOf(currentPath) !== 0 && currentNode.parentNode) {
        currentNode = currentNode.parentNode;
        currentPath = CRXB.util.nodeToJcrPath(currentNode);
    }
    if (currentNode === node && currentNode.parentNode) {
        return currentNode.parentNode;
    }
    return currentNode;
};

CRXB.util.sortNodes = function(n1, n2) {
    const text1 = (n1.text || '').toLowerCase();
    const text2 = (n2.text || '').toLowerCase();
    if (text1 === text2) {
        return 0;
    }
    if (text1 === 'jcr:content') {
        return -1;
    } else if (text2 === 'jcr:content') {
        return 1;
    }
    return text1 < text2 ? -1 : 1;
};

CRXB.util.getTreeCount = function() {
    const repositoryTree = Ext.getCmp(CRX.ide.TREE_ID);
    const rootNode = repositoryTree && repositoryTree.getRootNode();
    if (!rootNode) {
        return 0;
    }
    let count = 0;
    rootNode.cascade(function() {
       count++;
    });
    return count;
};