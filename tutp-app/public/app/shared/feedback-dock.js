// Where the post-session "How was this?" box and the WhatsApp share box go.
// They used to be a fixed bottom-right box (position:fixed), which sat on top
// of the explanation / notes text on a phone. Now each is a normal block at the
// END of the result it asks about, so it scrolls with the content and never
// covers any of it. The page's showFeedbackPrompt / showWhatsappSharePrompt
// build the box; this file only decides where it goes.
// Unit tests: tests/unit/feedback-dock.test.js.
(function (root) {
    'use strict';

    // feature (as passed to showFeedbackPrompt) -> the id of the results block
    var HOSTS = {
        homework_help: 'hwModalResults',
        quiz: 'hwModalResults',
        experiential_learning: 'experientialModalResults',
    };
    var DOCK_CLASS = 'tutp-fb-dock';
    var lastHostId = null;

    // Not fixed, not absolute: in the flow, full width of the result column.
    var BOX_STYLE = 'position:static;margin:16px 0 8px;background:#fff;border:1px solid #ccc;border-radius:8px;padding:12px 14px;font-size:14px;max-width:100%;box-sizing:border-box;';

    function hostIdFor(feature) {
        return Object.prototype.hasOwnProperty.call(HOSTS, feature) ? HOSTS[feature] : null;
    }

    // Put `box` at the end of the results block for `feature`. The share box
    // ('share') goes into whichever block the feedback box was in. With no such
    // block on the page it goes to the end of <body>, still in the flow.
    // Any earlier dock box is removed first, so there is only ever one.
    function place(box, feature, doc) {
        doc = doc || root.document;
        var old = doc.querySelectorAll('.' + DOCK_CLASS);
        for (var i = 0; i < old.length; i++) old[i].remove();
        var id = feature === 'share' ? lastHostId : hostIdFor(feature);
        if (feature !== 'share') lastHostId = id;
        var host = (id && doc.getElementById(id)) || doc.body;
        box.style.cssText = BOX_STYLE;
        box.classList.add(DOCK_CLASS);
        host.appendChild(box);
        return host;
    }

    var api = { hostIdFor: hostIdFor, place: place, BOX_STYLE: BOX_STYLE, DOCK_CLASS: DOCK_CLASS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.TutpFeedbackDock = api;
})(typeof window !== 'undefined' ? window : globalThis);
