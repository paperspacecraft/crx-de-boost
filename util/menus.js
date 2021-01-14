CRXB.util.arrangeMenu = function(menu, order, exclude) {
    let position = 0;
    const flatOrder = order.flatMap(item => Array.isArray(item) ? item : [item]);
    for (let item of flatOrder) {
        if (typeof item === 'string' && !(item === '-' || item === '->' || item === ' ')) {
            const found = menu.findBy((mnu) => mnu.text === item || mnu.id === item || (mnu.baseAction && mnu.baseAction.text === item));
            if (found && found.length) {
                menu.insert(position++, found[0]);
            }
        } else if (typeof item === 'object') {
            const found = menu.findBy((mnu) => mnu === item || mnu.baseAction === item);
            if (found && found.length) {
                menu.insert(position++, found[0]);
            } else {
                menu.insert(position++, item);
            }
        } else if (item === '-' || item === '->' || item === ' ') {
            menu.insert(position++, item);
        }
    }
    while (menu.items.length > position) {
        const item = menu.items.get(position);
        if (!exclude || !exclude[item.text]) {
            menu.remove(position, true);
        } else {
            const op = exclude && exclude[item.text];
            if (op === 'hide') {
                item.hide();
            }
            position++;
        }
    }
};

CRXB.util.modifyMenuItem = function(menu, item, fn) {
    const itemArray =  Array.isArray(item) ? item : [item];
    const foundItems = [];
    for (let i of itemArray) {
        if (typeof i === 'string') {
            foundItems.push(...menu.findBy((mnu) => mnu.text === i || mnu.id === i || (mnu.baseAction && mnu.baseAction.text === i)));
        } else if (typeof i === 'object') {
            foundItems.push(...menu.findBy((mnu) => mnu === i || mnu.baseAction === i));
        }
    }
    foundItems.forEach(foundItem => fn(foundItem));
};