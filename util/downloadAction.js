CRXB.util.getDownloadAction = function() {
    if (CRX.ide.DownloadAction) {
        return CRX.ide.DownloadAction;
    }

    CRX.ide.DownloadAction = new Ext.Action({
        text: 'Download',
        iconCls: 'action-download',
        handler: function() {
            const msg = new CrxProgressFacade('Download resource', 'Please wait');
            const packager = new CrxPackager({
                success: (status) => {
                    msg.show(1, 'Finished');
                    msg.hide(500);

                    const downloadLink = document.createElement('A');
                    downloadLink.style.display = 'none';
                    downloadLink.href = status.packagePath;
                    if (status.packageFileName) {
                        downloadLink.download = status.packageFileName;
                    }
                    document.body.appendChild(downloadLink);
                    downloadLink.click();
                    downloadLink.remove();
                },

                failure: (status) => {
                    const errorMsg = `Package creation for ${status.jcrPath} failed at "${status.stage}": ${status.httpStatus} ${status.message}`;
                    console.error(errorMsg);
                    Ext.Msg.show({
                        title: 'Error',
                        msg: errorMsg,
                        width: 420,
                        buttons: Ext.MessageBox.OK,
                        icon: Ext.MessageBox.ERROR
                    });
                },
                status: (status) => msg.show(status.completion, status.stage + '... Please wait'),

                cleanUp: true
            });
            const path = CRXB.util.getCurrent('path');
            packager.download(path);
        }
    });
    CRX.ide.DownloadAction.checkActive = function() {
        this.setDisabled(!CRXB.util.getCurrent('path'));
    };

    return CRX.ide.DownloadAction;
};
