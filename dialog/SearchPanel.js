CRXB.util.registerSearchPanel = function() {
    if (CRX.ide.SearchPanel) {
        return CRX.ide.SearchPanel;
    }

    CRX.ide.SearchPanel = Ext.extend(Ext.Panel, {
        title: 'SEARCH',
        closable: true,
        layout: 'fit',

        constructor: function(config) {

            this.QUERY_LIMIT = CRXB.settings.get('search-page-size') || 30;

            this.store = new Ext.data.JsonStore({
                autoDestroy: true,
                autoLoad: false,
                fields: ['path'],

                proxy: new Ext.data.HttpProxy({
                    url: config.endpoint || CRX.ide.SearchPanel.SEARCH_ENDPOINT,
                    method: 'GET',
                    timeout: 180000 // 3 min
                }),
                root: 'results',
                idProperty: 'path',
                totalProperty: 'total',
                listeners: {
                    exception: (proxy, type, action, options, response) => this.handleException(proxy, type, response)
                }
            });

            this.resultsView = new Ext.grid.GridPanel({
                id: 'search-results',
                margins:"0 0 0 0",
                view: new Ext.grid.GridView({
                    emptyText: 'No results to display'
                }),
                autoExpandColumn: 'path',
                cm: new Ext.grid.ColumnModel({
                    columns: [
                        {
                            id: 'path',
                            header: 'Path',
                            dataIndex: 'path',
                            sortable: false,
                            renderer: value => this.renderItem(value)
                        }
                    ],
                }),
                sm: new Ext.grid.RowSelectionModel({
                    singleSelect: true
                }),
                viewConfig: new Ext.grid.GridView({
                    forceFit: true
                }),
                store: this.store,
                contextMenu: new Ext.menu.Menu({
                    id: 'search-menu',
                    cls: 'x-menu-detached hide-disabled',
                    items: [
                        CRX.ide.CopyNodeAction,
                        CRX.ide.MoveNodeAction,
                        '-',
                        CRX.ide.OverlayNodeAction,
                        CRXB.util.getAccessControlDialogAction(),
                        '-',
                        CRXB.util.getReplicationDialogActions(),
                        '-',
                        CRXB.util.getDownloadAction(),
                    ]
                }),
                listeners: {
                    rowdblclick: function(grid, index, e) {
                        e.stopEvent();
                        CRXB.util.setLocation(grid.getSelectionModel().getSelected().get('path'), {ensureVisible: true, shrinkOthers: true});
                    },
                    rowcontextmenu: async function(grid, index, e) {
                        e.stopEvent();
                        const selectionModel = grid.getSelectionModel();
                        if (!selectionModel.hasSelection() || !selectionModel.isSelected(index)) {
                            selectionModel.selectRow(index);
                        }
                        grid.contextMenu.show(grid.getView().getRow(index));
                        grid.contextMenu.getEl().setX(e.getXY()[0]);
                    },
                }
            });

            this.resultsView.getSelectionModel().on('selectionchange', function(selectionModel) {
                if (!selectionModel.hasSelection()) {
                    return;
                }
                CRXB.util.setLocation(selectionModel.getSelected().get('path'), {ensureVisible: false});
            });

            CRXB.util.modifyMenuItem(this.resultsView.contextMenu, CRX.ide.CopyNodeAction, item => item.iconCls = 'action-copy');
            CRXB.util.modifyMenuItem(this.resultsView.contextMenu, CRX.ide.MoveNodeAction, item => item.iconCls = 'action-move');

            this.mask =  new Ext.LoadMask(Ext.getBody());

            const searchPanel = this;
            Ext.applyIf(config, {
                tbar: new Ext.Toolbar({
                    cls: 'light',
                    items: [
                        {
                            id: 'search-nav-backward',
                            iconCls: 'action-backward',
                            disabled: true,
                            handler: () => this.navigateBack()
                        },
                        {
                            id: 'search-nav-status',
                            cls: 'full-size-text',
                            xtype: 'tbtext',
                            text: '',
                            listeners: {
                                render: function(button) {
                                    button.el.dom.addEventListener('click', (e) => {
                                        if (e.target.tagName === 'EM') {
                                            document.getElementById('repository-path').value = searchPanel.term;
                                        }
                                    });
                                }
                            }
                        },
                        {
                            id: 'search-nav-forward',
                            iconCls: 'action-forward',
                            disabled: true,
                            handler: () => this.navigateForward()
                        }
                    ],

                }),
                items: [this.resultsView],
            });
            CRX.ide.SearchPanel.superclass.constructor.call(this, config);
        },

        search: function(term) {
            if (this.masked) {
                return;
            }

            this.store.proxy.setApi({read: CRX.ide.SearchPanel.SEARCH_ENDPOINT});
            this.store.proxy.setUrl(CRX.ide.SearchPanel.SEARCH_ENDPOINT, true);

            this.term = term;
            this.paging = {start: 1};

            this.store.loaded = false;
            this.load();
        },

        query: function(term, type = 'JCR-SQL2') {
            if (this.masked) {
                return;
            }

            this.store.proxy.setApi({read: CRX.ide.SearchPanel.QUERY_ENDPOINT});
            this.store.proxy.setUrl(CRX.ide.SearchPanel.QUERY_ENDPOINT, true);

            this.term = term;
            this.termType = type;
            this.paging = {start: 0};

            this.store.loaded = false;
            this.load();
        },

        navigateBack: function() {
            if (!this.paging || this.paging.start === undefined) {
                return;
            }
            this.paging.start -= this.QUERY_LIMIT;
            this.load();
        },

        navigateForward: function() {
            if (!this.paging || this.paging.start === undefined) {
                return;
            }
            this.paging.start += this.QUERY_LIMIT;
            this.load();
        },

        showMask: function() {
            this.mask.show();
            this.masked = true;
        },

        hideMask: function() {
            this.masked = false;
            this.mask.hide();
        },

        isSearchMode: function() {
            return this.store.proxy.url ===  CRX.ide.SearchPanel.SEARCH_ENDPOINT;
        },

        isQueryMode: function() {
            return this.store.proxy.url ===  CRX.ide.SearchPanel.QUERY_ENDPOINT;
        },

        load: function() {
            const searchPanel = this;
            const queryParams = searchPanel.isSearchMode()
                ? {query: searchPanel.term, start: searchPanel.paging.start, limit: this.QUERY_LIMIT}
                : {stmt: searchPanel.term, showResults: true, type: searchPanel.termType};

            if (!this.store.loaded) {
                this.showMask();
                this.store.load({
                    params: queryParams,
                    callback: function() {
                        searchPanel.loadCallback(searchPanel, this);
                    }
                });
            } else {
                this.store.clearFilter(true);
                this.store.filterBy(this.queryStorePagination, this);
                this.loadCallback(this, this.store);
            }
        },

        loadCallback: function(searchPanel, store) {
            searchPanel.hideMask();
            searchPanel.paging.total = store.getTotalCount() >= 0 || searchPanel.isQueryMode() ? store.getTotalCount() : Number.MAX_SAFE_INTEGER;

            const actualCount = searchPanel.isSearchMode() || searchPanel.paging.total === 0
                ? store.getCount()
                : Math.min(searchPanel.paging.total - searchPanel.paging.start, searchPanel.QUERY_LIMIT);

            const navBackward = searchPanel.topToolbar.items.get('search-nav-backward');
            const navForward = searchPanel.topToolbar.items.get('search-nav-forward');
            const navStatus = searchPanel.topToolbar.items.get('search-nav-status');
            navBackward.setDisabled(searchPanel.paging.start <= 1 || actualCount === 0);
            navForward.setDisabled(searchPanel.paging.start + actualCount >= searchPanel.paging.total);

            if (actualCount > 0) {
                const startValue = searchPanel.isQueryMode() ? searchPanel.paging.start + 1 : searchPanel.paging.start;
                const endValue = startValue + actualCount - 1;
                const totalValue = searchPanel.paging.total !== Number.MAX_SAFE_INTEGER ? ' of ' + searchPanel.paging.total : '';
                const forValue = searchPanel.isSearchMode()
                    ? `"<em>${searchPanel.truncateText(searchPanel.term, 30)}</em>"`
                    : `<u><em ext:qtip="${searchPanel.term.replace('"', '\\"')}">this query</em></u>`;

                navStatus.setText(`Showing ${startValue}&ndash;${endValue}${totalValue} for ${forValue}`);
            } else {
                const forValue = searchPanel.isSearchMode()
                    ? `Search "<em>${searchPanel.truncateText(searchPanel.term, 30)}</em>"`
                    : `Hover to see <u><em ext:qtip="${searchPanel.term.replace('"', '\\"')}">query</em></u>`;
                navStatus.setText(forValue);
            }

            if (searchPanel.isQueryMode() && !store.loaded) {
                store.loaded = true;
                store.filterBy(searchPanel.queryStorePagination, searchPanel);
            }

        },

        queryStorePagination: function(record) {
            const index = record.store.data.indexOf(record);
            return index >= this.paging.start && index < this.paging.start + this.QUERY_LIMIT;
        },

        handleException: function(proxy, type, response) {
            this.store.removeAll();
            this.loadCallback(this, this.store);
            let errorMessage = 'Could not perform query: ';
            if (type === 'response') {
                errorMessage += response.statusText || response.status
            } else if (response.errorMessage) {
                errorMessage = response.errorMessage;
            } else {
                errorMessage += 'unknown error';
            }
            Ext.Msg.show({
                title: 'Error',
                msg: errorMessage,
                width: 420,
                buttons: Ext.MessageBox.OK,
                icon: Ext.MessageBox.ERROR
            });
        },

        renderItem: function(value) {
            let iconType = CRX.NodetypeRegistry.getIconClass(value);
            if (iconType === 'unstructured') {
                if (/\.\w{3,4}$/.test(value)) {
                    iconType = 'file';
                } else if (!/jcr:content/i.test(value)) {
                    iconType = 'page';
                }
            }
            return `<span class="x-tree-node-icon ${iconType}">&nbsp;</span><span ext:qtip="${value}">${value}</span>`;
        },

        truncateText: function(text, len) {
            if (text.length < len) {
                return text;
            }
            return text.slice(0, len) + '...';
        }

    });

    CRX.ide.SearchPanel.SEARCH_ENDPOINT = 'search.jsp';
    CRX.ide.SearchPanel.QUERY_ENDPOINT = 'query.jsp';

    return CRX.ide.SearchPanel;
};

