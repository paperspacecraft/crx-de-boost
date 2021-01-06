class CrxProgressFacade {

    constructor(title, msg) {
        this.title = title;
        this.state = undefined;
        if (msg) {
            this.show(-1, msg);
        }
    }

    show(progress, msg) {
        if (!msg) {
            msg = progress;
            progress = -1;
        }
        const newState = progress >= 0 ? 'progress' : 'wait';
        if (newState !== this.state && newState === 'progress') {
            Ext.Msg.show({
               title: this.title,
               msg: msg,
               width: 420,
               progress: true
            });
            Ext.Msg.updateProgress(progress, '', msg);
        } else if (newState !== this.state && newState === 'wait') {
            Ext.Msg.show({
                title: this.title,
                msg: msg,
                width: 420,
                wait: true
            });
        } else if (newState === 'progress') {
            Ext.Msg.updateProgress(progress, '', msg);
        } else {
            Ext.Msg.updateText(msg);
        }
    }

    hide(delay) {
        if (delay > 0) {
            setTimeout(() => Ext.Msg.hide(), delay);
        } else {
            Ext.Msg.hide();
        }
    }
}