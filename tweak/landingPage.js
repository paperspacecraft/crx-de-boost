CRXB.tweaks.insertLandingPage = function() {

    // Turn off side panels shrinking
    const homePanel = Ext.getCmp(CRX.ide.EDITORS_ID).items.get(0);
    homePanel.cls = 'homepanel';
    homePanel.title = 'HOME';
    homePanel.iconCls = '';
    homePanel.purgeListeners();

    //
    // Felix console
    //
    homePanel.addListener('render', async function() {
        try {
            const response = await fetch('/system/console/vmstat');
            const responseHtml = await response.text();
            const fakeContainer = document.createElement('DIV');
            fakeContainer.innerHTML = responseHtml;
            const navMenu = fakeContainer.querySelector('#navmenu');
            navMenu.querySelectorAll('a').forEach(link => {
                if (/#$/.test(link)) {
                    link.href = 'javascript:void(0)';
                } else {
                    link.target = '_blank';
                }
            });
            if (navMenu) {
                const panelBody = document.querySelector('.homepanel .x-panel-body');
                panelBody.appendChild(navMenu);
                panelBody.classList.add('loaded');
            }
        } catch (e) {
            console.error(e);
        }
    });

};