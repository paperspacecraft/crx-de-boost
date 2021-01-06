CRXB.tweaks.convertAddressBarToOmnibox = function() {

    const getSqlConditions = function(value) {
        const regExp = /(\w+(?::\w+)?|\[\w+(?::\w+)?])\s*(=|<>|\s+like\s+)\s*(\w+|['"].*?['"])/gi;
        const matches = [];
        const intervals = [];
        let match, lastIndex = 0;
        while ((match = regExp.exec(value)) != null) {
            if (matches.length === 0 && match.index > 0) {
                // If the match does not start from the beginning of line, there's still the option that a JCR path is prepended
                if (/^(\/[\w-:]+)+\s*@/.test(value)) {
                    matches.push({path: value.split('@')[0].trim(), arg1: match[1], op: match[2], arg2: match[3]});
                    continue;
                } else {
                    return false;
                }
            }
            matches.push({arg1: match[1], op: match[2], arg2: match[3]});
            if (lastIndex > 0) {
                intervals.push(value.substring(lastIndex, match.index));
            }
            lastIndex = regExp.lastIndex;
        }
        if (matches.length === 1) {
            return [matches[0]];
        }
        if (matches.length > 1
                && matches.length === (intervals.length) + 1
                && intervals.every(int => /and|or/i.test(int.trim()))) {
            const result = [];
            for (let i = 0; i < matches.length; i++) {
                if (i === 0) {
                    result.push(matches[i]);
                } else {
                    matches[i].operator = intervals[i-1];
                    result.push(matches[1]);
                }
            }
            return result;
        }

        return false;
    };

    const conditionsToSqlQuery = function(value) {
        let result = 'SELECT * FROM [nt:base] AS node WHERE ';
        let currentPath = value[0].path || CRXB.util.getCurrent('path');
        if (!currentPath || currentPath === '/') {
            currentPath = '/content';
        }
        result += ` ISDESCENDANTNODE(node, '${currentPath}') AND (`;
        value.forEach(v => {
            if (v.operator) {
                result += v.operator
            }
            const isArgInBrackets = v.arg1[0] === '[';
            result += 'node.' + (isArgInBrackets ? '' : '[') + v.arg1 + (isArgInBrackets ? '' : ']') + v.op + v.arg2;
        });
        result += ')';
        return result;
    };

    const parseValue = function(value) {
        if (!value) {
            return false;
        }

        let resultingValue = value.trim();

        // Check for a HTTP address
        if (/^https?:\/\//i.test(value)) {
            const addressPart =  resultingValue.split('://')[1];
            const slashIndex = addressPart.indexOf('/');
            if (slashIndex > 0) {
                resultingValue = addressPart.substr(slashIndex);
                if (resultingValue.indexOf('?') > 0) {
                    resultingValue = resultingValue.split('?')[0];
                }
                //resultingValue = decodeURIComponent(resultingValue); TODO check if this deconding needed
            } else {
                return {
                    value: resultingValue,
                    type: 'search'
                }
            }
        }

        // Check for a repository path
        if (/^(\/editor\.html)?(\/[\w-:]+)+(\.\w+)?((\/[^\s\/]+)+)?(\?[^\s]+)?$/i.test(resultingValue)) {
            if (/^\/editor\.html/i.test(resultingValue)) {
                resultingValue = resultingValue.substring('/editor.html'.length);
            }
            if (resultingValue.indexOf('.') > 0) {
                resultingValue = resultingValue.split('.')[0];
            } else if (resultingValue[resultingValue.length - 1] === '/') {
                resultingValue = resultingValue.substring(0, resultingValue.length - 1);
            }
            const autoPattern = (GM_getValue('profile:settings') || {})['omnibox-auto-pattern'];
            const autoReplacement = (GM_getValue('profile:settings') || {})['omnibox-auto-replacement'];
            if (autoPattern && autoReplacement) {
                const rx =  new RegExp(autoPattern);
                if (rx.test(resultingValue)) {
                    return {
                        value:  resultingValue.replace(rx, autoReplacement),
                        type: 'node'
                    };
                }
            }
            return {
                value:  resultingValue,
                type: 'node'
            };
        }

        // Check for an XPath statement
        if (resultingValue.indexOf('/jcr:root') === 0) {
            return {
                value: resultingValue,
                type: 'query',
                termType: 'xpath'
            };
        }

        // Check for a JCR-SQL2 statement
        if (/^select.+from.+where/i.test(resultingValue)) {
            return {
                value: resultingValue,
                type: 'query'
            };
        }

        // Check for a condition convertible to JCR-SQL2 statement
        const foundSqlConditions = getSqlConditions(resultingValue);
        if (foundSqlConditions) {
            return {
                value: conditionsToSqlQuery(foundSqlConditions),
                type: 'query'
            };
        }

        // Fallback: regular search
        return {
            value: resultingValue,
            type: 'search'
        };
    };

    const doSearch = function() {
        const queryHolder = Ext.getCmp(CRX.ide.REPO_PATH_ID);
        const parsed = parseValue(queryHolder.getValue());

        if (!parsed) {
            return;
        }

        if (parsed && parsed.type === 'node') {
            CRXB.util.setLocation(parsed.value);

        } else if (parsed && parsed.type === 'search') {
            CRXB.util.performSearch(parsed.value);

        } else if (parsed && parsed.type === 'query') {
            CRXB.util.performQuery(parsed.value, parsed.termType);
        }
    };

    const mainPanel = Ext.getCmp(CRX.ide.MAIN_ID);
    const addressBar = Ext.getCmp(CRX.ide.REPO_PATH_ID);
    const addressPanel = mainPanel.items[1].items[0];

    addressPanel.autoHeight = false;
    addressPanel.height = 30;
    addressPanel.layout = 'hbox';
    addressPanel.id = 'addressbar';
    addressPanel.cls = 'x-toolbar';

    addressPanel.items.remove(addressBar);

    const omniBox = new Ext.form.TextField({
        id: CRX.ide.REPO_PATH_ID,
        height: 30,
        listeners: {
            specialkey: function(field, e) {
                if (e.getKey() === e.ENTER) {
                    doSearch();
                }
            }
        }
    });
    addressPanel.items.push(omniBox);
    addressPanel.items.push(new Ext.Toolbar.Button({
        iconCls: 'query',
        width: 16,
        handler: doSearch
    }));
    addressPanel.items[0].flex = 1;

    CRXB.util.registerSearchPanel();
};