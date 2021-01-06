// ==UserScript==

// @name         CRX/DE Boost
// @namespace    http://aem.velwetowl.org/
// @version      0.1
// @description  Makes CRX/DE passable for an AEM developer environment
// @author       Stephen Velwetowl

// @match        http*://*/crx/de/*
// @match        http*://*/crx/*?crxbflow*

// @grant        GM_addValueChangeListener
// @grant        GM_getValue
// @grant        GM_setValue

// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.5.0/jszip.min.js
// @run-at       document-start

// ==/UserScript==


window.CRXB = {flows: {}, tweaks: {}, util: {}};
