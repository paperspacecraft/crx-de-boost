CRXB.flows.downloadPackage = function() {
    const path = new URLSearchParams(location.search).get('path');
    const parent = window.opener || window.parent;
    const packager = new CrxPackager({
        cleanUp: true,
        storeBlob: true,
        status: (status) =>  {
            parent.postMessage({from: 'download-package', msg: 'status', status: status}, '*')
        },
        success: (status) =>  {
            parent.postMessage({from: 'download-package', msg: 'success', status: status}, '*')
        },
        failure: (status) =>  {
            parent.postMessage({from: 'download-package', msg: 'failure', status: status}, '*')
        }
    });
    if (path) {
        packager.download(path);
    }
    CRXB.tweaks.applyStyles('download');
};