CRXB.flows.common = function () {
    // Splash screen
    CRXB.tweaks.applyStyles('splash');

    // Regulations
    const regulator = new CrxRegulator();
    regulator.blockExternal(/(BuildInfoPanel|DebugTrackingAction|ImportSiteAction|PreferencesDialog)\.js/);
    regulator.blockExternal(/extjs-theme\/css\/xtheme-crx|xtheme-blue/);

    // Tweaks
    const tweaker = new CrxTweaker();
    tweaker
        .add(CRXB.tweaks.modifyMainPanel)
        .add(CRXB.tweaks.modifyRepositoryTree)
        .add(CRXB.tweaks.modifyPropertyPanel)
        // .add(CRXB.tweaks.modifyQueryPanel)
        .add(CRXB.tweaks.insertLandingPage, 'repository')

        .add(CRXB.tweaks.convertAddressBarToOmnibox, 'crxde')
        .add(CRXB.tweaks.addFavorites, 'crxde')
        .add(CRXB.tweaks.addEnvironmentLabel, 'crxde')

        .add(CRXB.tweaks.openPageInEditMode)

        .add(CRXB.tweaks.modifyDeleteAction)
        .add(CRXB.tweaks.copyPasteCommonActions, 'repository')
        .add(CRXB.tweaks.copyPasteRepositoryTree, 'repository')
        .add(CRXB.tweaks.copyPastePropertiesGrid, 'properties')

        .add(CRXB.tweaks.modifyMenus, ['repository', 'properties'])
        .add(CRXB.tweaks.modifyKeyMappings, ['repository', 'properties'])

        .add(() => CRXB.util.registerPreferencesDialog())
        .add(CRXB.tweaks.applyStyles);

    // Finalization
    document.addEventListener("DOMContentLoaded", () => {
        regulator.dispose();
        if (typeof Ext !== typeof undefined) {
            tweaker.execute(Ext);
        } else {
            CRXB.tweaks.redirectToLoginPage();
        }
    });
};