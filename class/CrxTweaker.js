class CrxTweaker {

    add(tweak, context) {
        if (!this.tweaks) {
            this.tweaks = [];
        }
        this.tweaks.push({tweak: tweak, context: context});
        return this;
    }

    execute(extObj) {
        const tweaks = this.tweaks;
        tweaks.filter(item => !item.context).forEach(item => item.tweak());

        const isMatch = (component, tweakItem) => {
            if (!tweakItem.context) {
                return false;
            }
            if (Array.isArray(tweakItem.context)) {
                return tweakItem.context.indexOf(component.id) >= 0;
            } else {
                return tweakItem.context === component.id;
            }
        };

        const runInContext = (component, tweakItem) => {
            if (Array.isArray(tweakItem.context)) {
                tweakItem.context.splice(tweakItem.context.indexOf(component.id), 1);
                if (!tweakItem.context.length) {
                    tweakItem.tweak();
                }
            } else {
                tweakItem.tweak(component);
            }
        };

        extObj.ComponentMgr.all.on('add', function(index, obj) {
            const matchingTweaks = tweaks.filter(item => isMatch(obj, item));
            matchingTweaks.forEach(item => runInContext(obj, item));
        });
    }
}