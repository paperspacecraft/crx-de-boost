CRXB.util.getUploadClipboardAction = function() {
    if (CRX.ide.UploadClipboardAction) {
        return CRX.ide.UploadClipboardAction;
    }

    CRX.ide.UploadClipboardAction = new Ext.Action({
        text: 'Install from Clipboard',
        iconCls: 'action-upload',
        handler: async (followSelectedNode) => {

            // Collect node info
            followSelectedNode = followSelectedNode === true;
            const selectedNode = CRXB.util.getCurrent('node');
            const storedNode = CRX.Clipboard.getData().data;

            // Perform import from a foreign instance

            const storedNodePath = CRXB.util.nodeToJcrPath(storedNode);
            const selectedNodePath = CRXB.util.nodeToJcrPath(selectedNode);
            const needsMove  = followSelectedNode && selectedNode && storedNodePath !== selectedNodePath;

            const msg = new CrxProgressFacade('Import resource', 'Please wait');

            const processPackagerSuccess = async (status) => {
                msg.show(1, 'Finished');
                msg.hide(500);

                if (!status || !status.jcrPath) {
                    return;
                }
                CRXB.util.findNearestCommon(CRXB.util.getCurrent('node'), status.jcrPath).reload(() => {
                    CRXB.util.setLocation(status.jcrPath);
                });
            };

            const processPackagerFailure = (status) => {
                const errorMsg = typeof status === 'string'
                    ?  status
                    : `Importing of ${status.jcrPath} failed at "${status.stage}": ${status.httpStatus} ${status.message}`;
                console.error(errorMsg);
                Ext.Msg.show({
                    title: 'Error',
                    msg: errorMsg,
                    width: 420,
                    buttons: Ext.MessageBox.OK,
                    icon: Ext.MessageBox.ERROR
                });
            };

            const processPackagerPreInstall = async (status) => {
                if (!needsMove || !status.blob) {
                    return status;
                }
                const modifier = new CrxPackageModifier();
                status.blob = await modifier.modify(status.blob, selectedNodePath);
                return status;
            };

            const processPackagerStatus = (status) => msg.show(status.completion, status.stage + '... Please wait');

            const doImport = () => {
                const packager = new CrxPackager({
                    cleanUp: true,
                    success: processPackagerSuccess,
                    failure: processPackagerFailure,
                    status: processPackagerStatus,
                    preInstall: processPackagerPreInstall
                });
                packager.import(storedNode.propOrigin, storedNodePath);
            };

            Ext.Msg.show({
                title: 'Import content?',
                msg: `The node "<em>${storedNodePath}</em>" in clipboard is coming from another host (${storedNode.propOrigin}).<br><br>
                       Agree to try and import it as an AEM package?`,
                width: 420,
                icon: Ext.MessageBox.QUESTION,
                buttons: Ext.MessageBox.YESNO,
                fn: function(btn) {
                    if (btn === 'yes') {
                        doImport();
                    }
                }
            });
        }
    });

    CRX.ide.UploadClipboardAction.checkActive = function() {
        const storedNode = CRX.Clipboard.getData().data;
        const enableAction = storedNode && storedNode.propOrigin && storedNode.propOrigin !== document.location.origin;
        this.setDisabled(!enableAction);
    };

    return CRX.ide.UploadClipboardAction;
};

