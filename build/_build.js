'use strict';

const fs = require('fs');
const path = require('path');
const decomment = require('decomment');

const CLASSES_PATH = './class';
const DIALOGS_PATH = './dialog';
const FLOWS_PATH = './flow';
const TWEAKS_PATH = './tweak';
const UTILS_PATH = './util';

const CSS_PATH = './css';
const SVG_PATH = './svg/out';

const OUT_FILE_PATH = './out/crxde-boost.user.js';

const ENCODING = 'UTF8';
const CURRENT_VERSION = '0.1.3';


const BOOKMARK_SETTINGS = {
    'None': undefined,
    'Yellow': '#FFFF00',
    'Peach': '#FFDAB9',
    'Orange': '#FFC989',
    'Pale Green': '#B4FFB4',
    'Green': '#7FFF00',
    'Pink': '#FFB6C1',
    'Salmon': '#FA8072',
    'Lavender': '#DFDFFF',
    'Blue': '#ADD8FF',
    'Gray': '#CCCCCC',
    'Orchid': '#F9B0F9',
    'Violet': '#EE82EE',
    'Tan': '#D2B48C'
};

const COLOR_SCHEMES = {
    'Blue': {},
    'Ocean': {
        toolsBackground: "#1d9caf",
        toolsForeground: "#ebfffe",
        toolsHighlight: "#003f66",
        workspaceBackground: "#ffffff",
        workspaceShade: "#afe4e1",
        workspaceForeground: "#000000"
    },
    'Green': {
        toolsBackground: "#6dbb5d",
        toolsForeground: "#ffffff",
        toolsHighlight: "#386b3a",
        workspaceBackground: "#f5fff7",
        workspaceShade: "#d0ecca",
        workspaceForeground: "#000000"
    },
    'Lime': {
        toolsBackground: "#88b030",
        toolsForeground: "#faffe5",
        toolsHighlight: "#426001",
        workspaceBackground: "#ffffff",
        workspaceShade: "#ddeea0",
        workspaceForeground: "#000000"
    },
    'Peach': {
        toolsBackground: "#dc9450",
        toolsForeground: "#ffffff",
        toolsHighlight: "#813e04",
        workspaceBackground: "#fff9eb",
        workspaceShade: "#ffdec2",
        workspaceForeground: "#000000"
    },
    'Mango': {
        toolsBackground: "#deb429",
        toolsForeground: "#ffffff",
        toolsHighlight: "#744d17",
        workspaceBackground: "#fff7e5",
        workspaceShade: "#f5e5a0",
        workspaceForeground: "#000000"
    },
    'Pink': {
        toolsBackground: "#db7b7b",
        toolsForeground: "#ffffff",
        toolsHighlight: "#7c0e0e",
        workspaceBackground: "#ffffff",
        workspaceShade: "#fad3d3",
        workspaceForeground: "#000000"
    },
    'Fuchsia': {
        toolsBackground: "#b8569b",
        toolsForeground: "#ffffff",
        toolsHighlight: "#000074",
        workspaceBackground: "#ffffff",
        workspaceShade: "#d6c6f2",
        workspaceForeground: "#000000"
    },
};

const ACTION_ALIASES = {
    'action-add': ['action-create', 'register']
};

/* ------
   Styles
   ------ */

function getStyles() {
    let stylesText = fs.readFileSync('./build/styles_tpl.js', ENCODING);

    const cssFiles = fs.readdirSync(CSS_PATH);
    cssFiles.forEach(file => {
        let cssText = fs.readFileSync(path.join(CSS_PATH, file), ENCODING);
        const scope = file.indexOf('-') > 0 ? file.substr(0, file.indexOf('-')) : undefined;
        cssText = cssText
            .replace(/^@\w+:.+/gm, '')
            .replace(/^\/\*.+\*\//gm, '')
            .replace(/@(\w+)/g, '\\${$1}')
            .replace(/^\s+|\s+$/gm, '')
            .replace(/\s+/gs, ' ');
        if (scope) {
            stylesText += '\n    .add(\'' + scope + '\', `' + cssText + '`)';
        } else {
            stylesText += '\n    .add(`' + cssText + '`)';
        }
    });

    const svgFiles = fs.readdirSync(SVG_PATH);
    svgFiles.forEach(file => {
        const svgBasename = path.basename(file, '.svg');
        const svgText = fs.readFileSync(path.join(SVG_PATH, file), ENCODING);
        const svgColoredBase = svgText
            .replace(/(height|width)=".+?"\s*/g, '')
            .replace(/#/g, '%23');
        const svgColoredNormal = svgColoredBase.replace(/%23111/g, '%23\\${COLOR_TOOLS_FG_NOHASH}');
        const svgColoredLightMenu = svgColoredBase.replace(/%23111/g, '%23\\${COLOR_TOOLS_BG_NOHASH}');
        const svgColoredHighlight = svgColoredBase.replace(/%23111/g, '%23\\${COLOR_TOOLS_HIGH_NOHASH}');

        let selectors = [svgBasename];
        let aliases = ACTION_ALIASES[selectors[0]];
        if (aliases && Array.isArray(aliases)) {
            selectors.push(...aliases);
        } else if (aliases) {
            selectors.push(aliases);
        }
        const normalSelectors = selectors.map(s => `.x-btn-text.${s}, .x-menu-item .${s}`);
        const lightMenuSelectors = selectors.map(s => `.x-toolbar.light .x-btn-text.${s}, .x-window .x-toolbar .x-btn-text.${s}, .x-menu.light .x-menu-item-icon.${s}, .invert-menu-bg .x-menu-item-icon.${s}`);
        const highlightSelectors = selectors.map(s => `.x-toolbar .x-btn-over .x-btn-text.${s}, .x-toolbar .x-btn-menu-active .x-btn-text.${s}, .x-menu-item-active .x-menu-item-icon.${s}, .x-menu.light .x-menu-item-active .x-menu-item-icon.${s}`);

        normalSelectors.forEach(s => stylesText += '\n    .add(`' + s + ' {background-image: url(\'data:image/svg+xml;utf8,' + svgColoredNormal + '\')!important;}`)' );
        lightMenuSelectors.forEach(s => stylesText += '\n    .add(`' + s + ' {background-image: url(\'data:image/svg+xml;utf8,' + svgColoredLightMenu + '\')!important;}`)' );
        highlightSelectors.forEach(s => stylesText += '\n    .add(`' + s + ' {background-image: url(\'data:image/svg+xml;utf8,' + svgColoredHighlight + '\')!important;}`)' );
    });

    Object.keys(BOOKMARK_SETTINGS)
        .filter(color => BOOKMARK_SETTINGS[color])
        .forEach(color => {
            const colorValue = BOOKMARK_SETTINGS[color];
            const colorValueNoHash = colorValue.substring(1);
            const colorTag = color.toLowerCase().replace(' ', '-');
            stylesText += '\n    .add(`.highlight-' + colorTag + '>.x-tree-node-anchor span {background-color:' + colorValue + ';} '
                + '.x-menu-item-icon.action-highlight-' + colorTag
                + ' {background: no-repeat url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%23'
                + colorValueNoHash
                + '" d="M0 0 h512 v512 h-512 Z"/></svg>\');}`)';
        });

    stylesText += '\n    .add(`.x-tree-node-el.sorted>.x-tree-node-anchor:after {background-image: url(\'data:image/svg+xml;utf8,'
        + fs.readFileSync(path.join(SVG_PATH, 'action-sorting-alpha.svg'), ENCODING).replace(/%23111/g, '%23\\${COLOR_TOOLS_BG_NOHASH}')
        + '\');}`)';

    stylesText += '\n    .add(`.x-tree-node-el.drag>.x-tree-node-anchor:after {background-image: url(\'data:image/svg+xml;utf8,'
        + fs.readFileSync(path.join(SVG_PATH, 'action-move.svg'), ENCODING).replace(/(%23|#)111/g, '%23\\${COLOR_TOOLS_BG_NOHASH}')
        + '\');}`)';

    stylesText += ';';
    return stylesText;
}


/* --------
   Settings
   -------- */

function getSettings() {
    let settingsText = fs.readFileSync('./build/settings_tpl.js', ENCODING);

    settingsText += '\n    .add(\'highlight-colors\', [';
    Object.keys(BOOKMARK_SETTINGS)
        .forEach(k => settingsText += '\'' + k + '\',' );
    settingsText += '])';

    settingsText += '\n    .add(\'color-schemes\', {'
        + Object.keys(COLOR_SCHEMES).map(k => `'${k}': new CrxColorScheme(${JSON.stringify(COLOR_SCHEMES[k])})`).join(', ')
        + '})';

    settingsText += '\n    .add(\'favicon\', \''
        + 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 557 602"><path fill="%23111" d="M354 117c-13,-27 -61,-6 -74,27 -13,33 5,63 42,82 37,19 89,11 120,-42 27,-47 22,-164 -116,-183 0,0 0,0 -1,0 -180,-8 -268,124 -289,191 -6,20 -10,43 -9,68l-1 0c-15,0 -26,12 -26,26l0 240c0,15 12,26 26,26l64 0c15,0 26,-12 26,-26l0 -19c0,-15 -12,-26 -26,-26l-5 0c-15,0 -26,-12 -26,-26l0 -84c17,33 38,60 60,84 15,16 33,42 46,50l0 72c0,15 12,26 26,26l64 0c15,0 26,-12 26,-26l0 -19c0,-15 -12,-26 -26,-26l-5 0c-14,0 -26,-11 -26,-25l91 0 37 0 0 71c0,15 12,26 26,26l64 0c15,0 26,-12 26,-26l0 -19c0,-15 -12,-26 -26,-26l-5 0c-14,0 -26,-11 -26,-25l79 0c7,0 14,-5 15,-10 1,-3 0,-5 -2,-7l-33 -27 59 25c17,7 40,-20 27,-40 -12,-18 -28,-36 -41,-53 -1,-1 -1,-2 -1,-3 -4,-33 -32,-58 -66,-58 -1,0 -1,0 -2,0 -3,0 -5,-1 -6,-3 -15,-24 -56,-53 -90,-57 -22,-2 -53,11 -69,52 -1,3 -5,5 -8,4 -52,-10 -72,-109 -51,-166 14,-39 68,-83 106,-84 30,0 44,14 57,36 10,17 8,46 -14,53 -19,6 -40,-8 -35,-22 3,-10 30,-10 21,-28zm89 260c14,0 26,12 26,26 0,14 -12,26 -26,26 -14,0 -26,-12 -26,-26 0,-14 12,-26 26,-26z"/></svg>'
        + '\')';

    settingsText += '\n    .add(\'version\', \'' + CURRENT_VERSION + '\')';

    settingsText += ';';
    return settingsText;
}

/* ----------
   FS reading
   ---------- */

function getFileContents(file, raw) {
    const rawText = fs.readFileSync(file, ENCODING);
    if (raw) {
        return rawText;
    }
    return decomment(rawText);
}

function getDirContents(dir) {
    return fs.readdirSync(dir)
        .map(file => getFileContents(path.join(dir, file)))
        .join('\n\n');
}

/* -----------
   COMPILATION
   ----------- */

try {
    fs.unlinkSync(OUT_FILE_PATH);
} catch(e) {}

const header = getFileContents('header.js', true)
    .replace(/\/\/\s*@version\s+([\d.]+)/, '// @version      ' + CURRENT_VERSION);

const stream = fs.createWriteStream('./out/crxde-boost.user.js', {flags: 'a'});

[
    header,
    getDirContents(CLASSES_PATH),
    getDirContents(DIALOGS_PATH),
    getDirContents(UTILS_PATH),
    getSettings(),
    getStyles(),
    getDirContents(FLOWS_PATH),
    getDirContents(TWEAKS_PATH),
    getFileContents('footer.js'),
].forEach(text => {
    stream.write(text + '\n\n');
});

stream.end();
