CRXB.util.performSearch = function(value) {
    const repositoryWrapper = Ext.getCmp('repository-wrapper');
    if (repositoryWrapper.items.getCount() === 1) {
        repositoryWrapper.add(new CRX.ide.SearchPanel({endpoint: CRX.ide.SearchPanel.SEARCH_ENDPOINT}))
    }
    repositoryWrapper.setActiveTab(1);
    repositoryWrapper.items.get(1).search(value);
};


CRXB.util.performQuery = function(value, type) {
    const repositoryWrapper = Ext.getCmp('repository-wrapper');
    if (repositoryWrapper.items.getCount() === 1) {
        repositoryWrapper.add(new CRX.ide.SearchPanel({endpoint: CRX.ide.SearchPanel.QUERY_ENDPOINT}))
    }
    repositoryWrapper.setActiveTab(1);
    repositoryWrapper.items.get(1).query(value, type);
};