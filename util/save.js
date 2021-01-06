CRXB.util.save = async function(interactive) {
    const changedPaths = CRX.State.getChangedPaths("/" + CRX.Util.getWorkspace() + "/");

    const internal = async (url, diff) => {
        let response;
        try {
            response = await fetch(url, {
                method: 'post',
                headers:{
                    "Content-Type":"multipart/form-data; boundary=" + CRX.State.MULTIPART_BOUNDARY
                },
                body: diff
            });
            if (response.ok) {
                changedPaths.each(function(path) {
                    CRX.State.commitAllChanges(path);
                    CRX.State.removeTransientNode(path, false, true);
                    CRX.State.removeDeletedNode(path, true, false);
                });
            } else {
                const text = await response.text();
                response.responseXML = new window.DOMParser().parseFromString(text, 'text/xml');
                response.errorText = CRX.Util.getErrorMsgFromXml(response);
            }
        } catch (e) {
            response = response || {ok: 'false', status: 500, statusText: e || e.message};
        }
        if (!response.ok) {
            const errorMsg = `Could not save changes: ${response.status} ${response.errorText || response.statusText}`;
            console.error(errorMsg);
            if (interactive) {
                Ext.Msg.show({
                    title: 'Saving changes',
                    msg: errorMsg,
                    width: 420,
                    icon: Ext.Msg.ERROR,
                    buttons: Ext.Msg.OK
                });
            }
        }
    };

    const utf8Diff = CRX.State.getDiffMessage(changedPaths);
    const nonUtf8Diff = CRX.State.getNonUtf8ModifyMessage(changedPaths);

    if (utf8Diff) {
        await internal(CRX.Util.getSpiRootUrl(), utf8Diff);
    }
    if (nonUtf8Diff) {
        await internal(CRX.Util.getLaunchpadContextPath() + '/libs/crxde/data', nonUtf8Diff);
    }
};