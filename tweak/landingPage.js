CRXB.tweaks.insertLandingPage = function() {

    // Set home panel title and turn off side panels shrinking
    const homePanel = Ext.getCmp(CRX.ide.EDITORS_ID).items.get(0);
    homePanel.cls = 'homepanel';
    homePanel.title = 'HOME';
    homePanel.iconCls = '';
    homePanel.purgeListeners();

    //
    // Felix console
    //
    homePanel.addListener('render', async function() {
        const panelBody = document.querySelector('.homepanel .x-panel-body');

        // Add version label to Home panel
        const versionLabel = document.createElement('DIV');
        versionLabel.id = 'crxb-version';
        versionLabel.innerHTML = CRXB.settings.get('version') || '0.0.1';

        // Add links to Felix console facilities
        let fakeContainer;
        let navMenu;
        let logsRowList;
        try {
            const response = await fetch('/system/console/slinglog');
            const responseHtml = await response.text();
            fakeContainer = document.createElement('DIV');
            fakeContainer.innerHTML = responseHtml;

            navMenu = fakeContainer.querySelector('#navmenu');
        } catch (e) {
            console.error(e);
        }

        if (navMenu) {
            const logsRow = document.createElement('LI');
            logsRow.classList.add('navMenuItem-0');
            navMenu.insertBefore(logsRow, navMenu.querySelector('li.navMenuItem-0:nth-child(2)'));

            const logsRowHeader = document.createElement('A');
            logsRowHeader.href = '#';
            logsRowHeader.innerHTML = 'Logs';
            logsRow.appendChild(logsRowHeader);

            logsRowList = document.createElement('UL');
            logsRowList.classList.add('navMenuLevel-1');
            logsRow.appendChild(logsRowList);

            navMenu.querySelectorAll('a').forEach(link => {
                if (/#$/.test(link.href)) {
                    link.href = 'javascript:void(0)';
                } else {
                    link.target = '_blank';
                }
                link.innerHTML = link.innerHTML.replace('Web Console', 'Console');
            });

            panelBody.appendChild(navMenu);
            panelBody.appendChild(versionLabel);
            panelBody.classList.add('loaded');
        }

        if (logsRowList) {
            fakeContainer.querySelectorAll('a[href^="slinglog"]').forEach(link => {
                const logLink = document.createElement('LI');
                logsRowList.appendChild(logLink);

                const logLinkAnchor = document.createElement('A');
                let logLinkAnchorText = link.innerHTML
                    .replace(/\.log$/i, '')
                    .replace(/-+/g, ' ');
                if (logLinkAnchorText.indexOf('/') >= 0) {
                    logLinkAnchorText = logLinkAnchorText.split('/').slice(-1);
                }
                if (/error|access|request/.test(logLinkAnchorText)) {
                    logLinkAnchorText = '<em>' + logLinkAnchorText + '</em>';
                }
                logLinkAnchor.href = '/system/console/slinglog/tailer.txt' + new URL(link.href).search;
                logLinkAnchor.target = '_blank';
                logLinkAnchor.innerHTML = logLinkAnchorText;
                logLinkAnchor.classList.add('logLink');
                logLink.appendChild(logLinkAnchor);
            });
        }
    });

};