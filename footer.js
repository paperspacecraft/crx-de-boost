(function() {
    'use strict';
    const flow = location.search ? (new URLSearchParams(location.search).get('crxbflow') || '') : '';
    (CRXB.flows[flow] || CRXB.flows.common)();
})();
