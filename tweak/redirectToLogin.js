CRXB.tweaks.redirectToLoginPage = function() {
    if ((document.head.childNodes.length === 0 || Array.prototype.every.call(document.head.childNodes, n => n.tagName === 'SCRIPT'))
        && document.body.innerText.trim() === 'Authentication Failed') {

        window.location = '/libs/granite/core/content/login.html?resource=/crx/de';

    }
};