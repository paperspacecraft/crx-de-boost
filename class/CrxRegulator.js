class CrxRegulator {
    constructor() {
        this.observer = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                const regulated = this.getRegulatedItems(mutation);
                for (let item of regulated) {
                    if (item.node.tagName === 'SCRIPT') {
                        item.node.type = 'javascript/blocked';
                    }
                    if (item.action) {
                        item.action(item.node);
                    }
                }
            }
        });
        this.observer.observe(document, {childList: true, subtree: true});
    }

    blockExternal(matcher) {
        this.addRegulation(matcher, (node) => node.parentElement.removeChild(node));
        return this;
    }

    addRegulation(matcher, action) {
        if (!this.regulations) {
            this.regulations = [];
        }
        this.regulations.push({matcher: matcher, action: action});
    }

    dispose() {
        this.observer.disconnect();
        this.observer = null;
    }

    getRegulatedItems(mutation) {
        const result = [];
        if (!mutation || !mutation.addedNodes) {
            return result;
        }
        for (let node of mutation.addedNodes) {
            const action = this.getMatchedAction(node);
            if (action) {
                result.push({node: node, action: action});
            }
        }
        return result;
    }

    getMatchedAction(arg) {
        if (!arg) {
            return false;
        }
        for (let entry of (this.regulations || [])) {
            if ((entry.matcher.constructor.name === 'RegExp' && entry.matcher.test(arg.src || arg.href))
                || (entry.matcher.constructor.name !== 'RegExp' && typeof arg.matches === 'function' && arg.matches(entry.matcher))) {
                return entry.action;
            }
        }
        return false;
    }
}