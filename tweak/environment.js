CRXB.tweaks.addEnvironmentLabel = function () {

    const mainPanel = Ext.getCmp(CRX.ide.MAIN_ID);
    const addressPanel = mainPanel.items[1].items[0];

    const envLabel = new Ext.form.Label({
        id: 'environment',
        text: CRXB.util.getEnvironmentLabel() + ' ›'
    });

    addressPanel.items.unshift(envLabel);
    Ext.reg('environment', envLabel);
};