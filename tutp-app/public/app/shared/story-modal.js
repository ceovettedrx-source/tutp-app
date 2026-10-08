// Storytelling Method modal, shared by the mother, father, family-member and
// child dashboards (storytelling redesign, docs/specs/storytelling-redesign.md).
// Before this the markup and about 160 lines of script were copied into each
// page. Load as a plain script after homework-modal.js; it also needs
// /css/story-modal.css. It builds its own markup on load and keeps the names
// the pages already call: openStorytellingModal, closeStoryModal,
// resetStoryModal, playStory, stopStory and storyModalAttachInput.
//
// Page helpers used at click time only (all defined by homework-modal.js or
// the page script): attachFilePickerMulti, callHomeworkApi, startStagedLoading,
// submitFeedback, showWhatsappSharePrompt (not on the child page),
// showFreeLimitModal, printResult.
//
// The reply (server/story-schema.js) is { title, gradeSubjectTag,
// readMinutes, scenes[], visual|null, equations[], tryTogether|null,
// parentPrompt }. An older { story, abhyasaPrompt } reply is shown too.
// visual types: groups, numberLine, barModel, factFamily, venn (drawn here) and
// library (a ready picture with pins and a legend, from server/image-library.js).
// All story text goes in with textContent, never innerHTML.
(function () {
    'use strict';

    // The page's "Tell the story in" labels -> speech language and script font.
    // The font is loaded from Google Fonts (display=swap) only when that
    // language is used; Google serves it already split by unicode range.
    var LANGS = {
        English: { bcp: 'en' }, Spanish: { bcp: 'es' }, French: { bcp: 'fr' }, German: { bcp: 'de' },
        Hindi: { bcp: 'hi', script: 'devanagari', font: 'Noto Sans Devanagari' },
        Marathi: { bcp: 'mr', script: 'devanagari', font: 'Noto Sans Devanagari' },
        Telugu: { bcp: 'te', script: 'telugu', font: 'Noto Sans Telugu' },
        Tamil: { bcp: 'ta', script: 'tamil', font: 'Noto Sans Tamil' },
        Kannada: { bcp: 'kn', script: 'kannada', font: 'Noto Sans Kannada' },
        Malayalam: { bcp: 'ml', script: 'malayalam', font: 'Noto Sans Malayalam' },
        Bengali: { bcp: 'bn', script: 'bengali', font: 'Noto Sans Bengali' },
        Gujarati: { bcp: 'gu', script: 'gujarati', font: 'Noto Sans Gujarati' },
        Punjabi: { bcp: 'pa', script: 'gurmukhi', font: 'Noto Sans Gurmukhi' },
        Odia: { bcp: 'or', script: 'odia', font: 'Noto Sans Oriya' },
        Arabic: { bcp: 'ar', script: 'arabic', font: 'Noto Sans Arabic', rtl: true }
    };
    var SCENE_TITLES = { hook: 'The story begins', problem: 'The problem', mathMoment: 'The big idea', wrapUp: 'Wrap-up' };
    var MAX_ITEMS = 60;

    var sessionToken = 0;
    var attachState = { items: [] };
    var resetAttach = function () {};
    var voicesPromise = null;
    var currentText = '';
    var currentBcp = 'en';
    var openerEl = null;
    var loadedFonts = {};

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function $(id) { return document.getElementById(id); }

    // ---------------------------------------------------------------- markup
    var MARKUP = ''
        + '<div class="sm-backdrop" data-sm="close"></div>'
        + '<div class="sm-panel" role="dialog" aria-modal="true" aria-labelledby="storyModalTitle" tabindex="-1">'
        + '<div class="sm-head"><h3 id="storyModalTitle">Storytelling Method</h3>'
        + '<button type="button" class="sm-icon-btn" data-sm="close" aria-label="Close Storytelling Method"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>'
        + '<p class="sm-sub">Turn today\'s lesson into a story your child will remember</p>'
        + '<div id="storyModalForm">'
        + '<label class="sm-label" for="storyModalLang">Tell the story in</label>'
        + '<select id="storyModalLang" class="sm-field"><option>English</option><option>Hindi</option><option>Telugu</option><option>Tamil</option><option>Marathi</option><option>Spanish</option><option>French</option><option>German</option><option>Arabic</option></select>'
        + '<label class="sm-label" for="storyModalText">Lesson topic (optional if attaching a file)</label>'
        + '<textarea id="storyModalText" class="sm-field sm-textarea" placeholder="Type what the lesson is about, or just attach a photo/PDF below."></textarea>'
        + '<div class="sm-attach-row">'
        + '<label class="sm-attach" id="storyModalAttachTrigger" tabindex="0" role="button">📎 Attach a photo or PDF (optional)</label>'
        + '<input type="file" id="storyModalAttachInput" accept="image/*,application/pdf" class="sm-hidden">'
        + '<img id="storyModalThumb" alt="Preview of first attached storytelling photo" class="sm-thumb sm-hidden">'
        + '<span class="sm-pdf sm-hidden" id="storyModalPdfLabel">📄</span>'
        + '<button type="button" class="sm-link-btn sm-hidden" id="storyModalClearAttach">remove</button>'
        + '<img id="storyModalThumb2" alt="Preview of second attached storytelling photo" class="sm-thumb sm-hidden">'
        + '<span class="sm-pdf sm-hidden" id="storyModalPdfLabel2">📄</span>'
        + '<button type="button" class="sm-link-btn sm-hidden" id="storyModalClearAttach2">remove</button>'
        + '</div>'
        + '<p class="sm-hint">Up to 2 photos/PDFs — handy for multi-page homework.</p>'
        + '<button type="button" class="sm-btn sm-btn-primary sm-submit" id="storyModalSubmitBtn">Submit &amp; Tell</button>'
        + '<div class="sm-error sm-hidden" id="storyModalErrBox" role="alert"></div>'
        + '</div>'
        + '<div id="storyModalResults" class="sm-results sm-hidden"></div>'
        + '</div>';

    function build() {
        if ($('storyModal')) return;
        var root = el('div', 'sm-root sm-hidden');
        root.id = 'storyModal';
        root.innerHTML = MARKUP;
        document.body.appendChild(root);
        root.addEventListener('click', function (e) {
            var t = e.target.closest && e.target.closest('[data-sm="close"]');
            if (t) closeStoryModal();
        });
        root.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeStoryModal(); return; }
            if (e.target && e.target.id === 'storyModalAttachTrigger' && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                $('storyModalAttachInput').click();
            }
        });
        window.storyModalAttachInput = $('storyModalAttachInput');
        resetAttach = attachFilePickerMulti(
            $('storyModalAttachInput'),
            [
                { thumbEl: $('storyModalThumb'), pdfLabelEl: $('storyModalPdfLabel'), clearBtnEl: $('storyModalClearAttach') },
                { thumbEl: $('storyModalThumb2'), pdfLabelEl: $('storyModalPdfLabel2'), clearBtnEl: $('storyModalClearAttach2') }
            ],
            $('storyModalAttachTrigger'),
            { first: '📎 Attach a photo or PDF (optional)', more: '+ Add another photo or PDF' },
            attachState,
            $('storyModalErrBox'),
            2
        );
        $('storyModalAttachTrigger').addEventListener('click', function (e) {
            e.preventDefault();
            $('storyModalAttachInput').accept = 'image/*,application/pdf';
            $('storyModalAttachInput').click();
        });
        $('storyModalSubmitBtn').addEventListener('click', submit);
    }

    // ----------------------------------------------------------------- fonts
    function ensureFont(lang) {
        var info = LANGS[lang];
        if (!info || !info.font || loadedFonts[info.font]) return;
        loadedFonts[info.font] = true;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=' + info.font.replace(/ /g, '+') + ':wght@400;600;700&display=swap';
        document.head.appendChild(link);
    }

    // ------------------------------------------------------------ open/close
    function openStorytellingModal() {
        build();
        sessionToken++;
        openerEl = document.activeElement;
        resetStoryModal();
        $('storyModal').classList.remove('sm-hidden');
        var panel = $('storyModal').querySelector('.sm-panel');
        if (panel) panel.focus();
    }
    function closeStoryModal() {
        window.TutpListen.stop();
        var m = $('storyModal');
        if (m) m.classList.add('sm-hidden');
        if (openerEl && openerEl.focus) { try { openerEl.focus(); } catch (e) { /* element gone */ } }
        openerEl = null;
    }
    function resetStoryModal() {
        build();
        window.TutpListen.stop();
        $('storyModalForm').classList.remove('sm-hidden');
        $('storyModalResults').classList.add('sm-hidden');
        $('storyModalResults').textContent = '';
        $('storyModalText').value = '';
        resetAttach();
        $('storyModalErrBox').classList.add('sm-hidden');
        var btn = $('storyModalSubmitBtn');
        btn.disabled = false;
        btn.textContent = 'Submit & Tell';
    }

    // ----------------------------------------------------------- read aloud
    function waitForSpeechVoices() {
        if (voicesPromise) return voicesPromise;
        voicesPromise = new Promise(function (resolve) {
            if (!('speechSynthesis' in window)) { resolve([]); return; }
            var existing = window.speechSynthesis.getVoices();
            if (existing.length) { resolve(existing); return; }
            window.speechSynthesis.onvoiceschanged = function () { resolve(window.speechSynthesis.getVoices()); };
            setTimeout(function () { resolve(window.speechSynthesis.getVoices()); }, 1500);
        });
        return voicesPromise;
    }
    function voiceFor(bcp) {
        var voices = ('speechSynthesis' in window) ? window.speechSynthesis.getVoices() : [];
        return voices.find(function (v) { return v.lang && v.lang.toLowerCase().indexOf(bcp) === 0; }) || null;
    }
    // TUT-7: the play button is never hidden. It plays the server voice (TutpListen), then
    // the browser's voice; only when both fail does the "read aloud together" hint show.
    // Returns true when this device has its own voice, which is when the story starts by
    // itself (a server clip can't autoplay without a tap).
    function setupAudio(box, text, lang) {
        currentText = text;
        currentBcp = (LANGS[lang] || LANGS.English).bcp;
        return waitForSpeechVoices().then(function () {
            var hint = box.querySelector('#storyModalTtsNote');
            if (hint) hint.classList.add('sm-hidden');
            return 'speechSynthesis' in window && !!voiceFor(currentBcp);
        });
    }
    function playStory() {
        if (!currentText) return;
        var hint = $('storyModalTtsNote');
        if (hint) hint.classList.add('sm-hidden');
        window.TutpListen.speak(currentText, currentBcp, {
            onloading: function () { toggleAudio(true); },
            onstart: function () { toggleAudio(true); },
            onend: function () { toggleAudio(false); },
            onfail: function () { toggleAudio(false); if (hint) hint.classList.remove('sm-hidden'); }
        });
    }
    function stopStory() {
        window.TutpListen.stop();
        toggleAudio(false);
    }
    function toggleAudio(playing) {
        var play = $('storyModalPlayBtn'), stop = $('storyModalStopBtn');
        if (play) play.classList.toggle('sm-hidden', playing);
        if (stop) stop.classList.toggle('sm-hidden', !playing);
    }

    // ------------------------------------------------------------ the result
    // Any reply -> { title, tag, minutes, scenes[], visual, equations[], tryTogether, parentPrompt }
    function normalize(p) {
        var scenes = Array.isArray(p.scenes) ? p.scenes.filter(function (s) { return s && s.text; }) : [];
        if (!scenes.length && typeof p.story === 'string') {
            var sentences = p.story.split(/(?<=[.!?।])\s+/).filter(Boolean);
            var per = Math.max(1, Math.ceil(sentences.length / 4));
            for (var i = 0; i < sentences.length; i += per) {
                scenes.push({ label: ['hook', 'problem', 'mathMoment', 'wrapUp'][Math.min(scenes.length, 3)], text: sentences.slice(i, i + per).join(' ') });
            }
        }
        return {
            title: p.title || p.subject || 'Your child\'s story',
            tag: p.gradeSubjectTag || '',
            minutes: p.readMinutes || 0,
            scenes: scenes,
            visual: p.visual && VISUAL_TYPES[p.visual.type] ? p.visual : null,
            equations: Array.isArray(p.equations) ? p.equations : [],
            tryTogether: p.tryTogether && p.tryTogether.question ? p.tryTogether : null,
            parentPrompt: p.parentPrompt || p.abhyasaPrompt || '',
            picture: p.picture && p.picture.concept_key ? p.picture : null
        };
    }

    // The picture of a story (server/story-schema.js validates every type):
    // groups, numberLine, barModel, factFamily. All drawn here, no model call.
    var SVGNS = 'http://www.w3.org/2000/svg';
    function svgEl(tag, attrs, text) {
        var e = document.createElementNS(SVGNS, tag);
        for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
        if (text != null) e.textContent = text;
        return e;
    }
    function svgRoot(w, h) {
        var s = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, class: 'sm-svg', 'aria-hidden': 'true', focusable: 'false' });
        s.style.width = '100%'; s.style.maxWidth = w + 'px'; s.style.height = 'auto';
        return s;
    }

    function groupsBody(v) {
        var grid = el('div', 'sm-groups');
        var drawn = 0;
        v.groups.forEach(function (n) {
            var g = el('div', 'sm-group');
            var dots = el('div', 'sm-dots');
            for (var i = 0; i < n && drawn < MAX_ITEMS; i++, drawn++) {
                dots.appendChild(v.icon ? el('span', 'sm-icon', v.icon) : el('span', 'sm-dot'));
            }
            g.appendChild(dots);
            g.appendChild(el('span', 'sm-group-n', String(n)));
            grid.appendChild(g);
        });
        return grid;
    }

    function numberLineBody(v) {
        var W = 320, H = 86, x0 = 18, x1 = W - 18, y = 52;
        var steps = (v.to - v.from) / v.step;
        var s = svgRoot(W, H);
        var xOf = function (n) { return x0 + (n - v.from) / (v.to - v.from) * (x1 - x0); };
        s.appendChild(svgEl('line', { x1: x0, y1: y, x2: x1, y2: y, class: 'sm-nl-line' }));
        var every = steps > 10 ? 2 : 1; // label every second mark on a long line
        for (var i = 0; i <= steps; i++) {
            var n = v.from + i * v.step, x = xOf(n);
            s.appendChild(svgEl('line', { x1: x, y1: y - 5, x2: x, y2: y + 5, class: 'sm-nl-tick' }));
            if (i % every === 0 || i === steps) s.appendChild(svgEl('text', { x: x, y: y + 22, class: 'sm-nl-n', 'text-anchor': 'middle' }, String(n)));
        }
        if (v.icon) { // the counted thing waits at the start of the first jump
            var at = v.jumps.length ? v.jumps[0].from : v.from;
            s.setAttribute('viewBox', '0 0 ' + W + ' ' + (H + 22));
            s.appendChild(svgEl('text', { x: xOf(at), y: y + 44, class: 'sm-nl-icon', 'text-anchor': 'middle' }, v.icon));
        }
        v.jumps.forEach(function (j, k) {
            var a = xOf(j.from), b = xOf(j.to), mid = (a + b) / 2, lift = 14 + (k % 2) * 8;
            s.appendChild(svgEl('path', { d: 'M' + a + ' ' + (y - 6) + ' Q' + mid + ' ' + (y - 6 - lift * 2) + ' ' + b + ' ' + (y - 6), class: 'sm-nl-jump' }));
            var dir = b > a ? 1 : -1;
            s.appendChild(svgEl('path', { d: 'M' + b + ' ' + (y - 6) + ' l' + (-5 * dir) + ' -5 M' + b + ' ' + (y - 6) + ' l' + (-5 * dir) + ' 5', class: 'sm-nl-jump' }));
            var d = j.to - j.from;
            s.appendChild(svgEl('text', { x: mid, y: y - 10 - lift * 1.1, class: 'sm-nl-lab', 'text-anchor': 'middle' }, (d > 0 ? '+' : '−') + Math.abs(d)));
        });
        return s;
    }

    function barModelBody(v) {
        var wrap = el('div', 'sm-bar-model');
        wrap.appendChild(el('div', 'sm-bm-total', String(v.total)));
        var row = el('div', 'sm-bm-row');
        v.parts.forEach(function (p, i) {
            var seg = el('div', 'sm-bm-part sm-bm-' + (i % 4));
            seg.style.flexGrow = String(p.value);
            if (v.icon) seg.appendChild(el('span', 'sm-bm-icons', new Array(Math.min(p.value, 10) + 1).join(v.icon) + (p.value > 10 ? '…' : '')));
            seg.appendChild(el('span', 'sm-bm-val', String(p.value)));
            if (p.label) seg.appendChild(el('span', 'sm-bm-lab', p.label));
            row.appendChild(seg);
        });
        wrap.appendChild(row);
        return wrap;
    }

    function factSentences(v) {
        var add = v.op === 'add', p = add ? '+' : '×', q = add ? '−' : '÷';
        var list = [v.a + ' ' + p + ' ' + v.b + ' = ' + v.total, v.b + ' ' + p + ' ' + v.a + ' = ' + v.total,
            v.total + ' ' + q + ' ' + v.a + ' = ' + v.b, v.total + ' ' + q + ' ' + v.b + ' = ' + v.a];
        return list.filter(function (t, i) { return list.indexOf(t) === i; });
    }

    function factFamilyBody(v) {
        var wrap = el('div', 'sm-fact');
        var s = svgRoot(220, 150);
        s.appendChild(svgEl('polygon', { points: '110,12 18,132 202,132', class: 'sm-ff-tri' }));
        [[110, 34, v.total, 'sm-ff-top'], [42, 124, v.a, 'sm-ff-c'], [178, 124, v.b, 'sm-ff-c']].forEach(function (c) {
            s.appendChild(svgEl('circle', { cx: c[0], cy: c[1], r: 24, class: 'sm-ff-dot ' + c[3] }));
            if (v.icon) s.appendChild(svgEl('text', { x: c[0], y: c[1] - 9, class: 'sm-ff-icon', 'text-anchor': 'middle' }, v.icon));
            s.appendChild(svgEl('text', { x: c[0], y: c[1] + (v.icon ? 12 : 6), class: 'sm-ff-n ' + c[3], 'text-anchor': 'middle' }, String(c[2])));
        });
        wrap.appendChild(s);
        var ul = el('ul', 'sm-fact-list');
        factSentences(v).forEach(function (t) { ul.appendChild(el('li', null, t)); });
        wrap.appendChild(ul);
        return wrap;
    }

    // Two overlapping ellipses (the intersection in orange) behind three lists
    // of elements; an element is its icon when the server found one, else a
    // small text chip. The stage grows with the lists.
    var vennCount = 0;
    function vennList(items, cls) {
        var col = el('div', 'sm-venn-col ' + cls);
        items.forEach(function (it) {
            col.appendChild(it.icon ? elWith('span', 'sm-venn-item sm-venn-ico', it.icon, it.text) : el('span', 'sm-venn-item', it.text));
        });
        return col;
    }
    function elWith(tag, cls, text, title) { var e = el(tag, cls, text); e.title = title; return e; }
    function vennBody(v) {
        var wrap = el('div', 'sm-venn');
        var head = el('div', 'sm-venn-labels');
        head.appendChild(el('span', 'sm-venn-label', v.left.label));
        head.appendChild(el('span', 'sm-venn-label', v.right.label));
        wrap.appendChild(head);
        var stage = el('div', 'sm-venn-stage');
        var id = 'smVennClip' + (++vennCount);
        var s = svgEl('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', class: 'sm-venn-svg', 'aria-hidden': 'true', focusable: 'false' });
        var defs = svgEl('defs', {});
        var clip = svgEl('clipPath', { id: id });
        clip.appendChild(svgEl('ellipse', { cx: 33, cy: 50, rx: 33, ry: 48 }));
        defs.appendChild(clip);
        s.appendChild(defs);
        s.appendChild(svgEl('ellipse', { cx: 33, cy: 50, rx: 33, ry: 48, class: 'sm-venn-a' }));
        s.appendChild(svgEl('ellipse', { cx: 67, cy: 50, rx: 33, ry: 48, class: 'sm-venn-b' }));
        s.appendChild(svgEl('ellipse', { cx: 67, cy: 50, rx: 33, ry: 48, class: 'sm-venn-both', 'clip-path': 'url(#' + id + ')' }));
        stage.appendChild(s);
        stage.appendChild(vennList(v.left.items, 'sm-venn-l'));
        stage.appendChild(vennList(v.both, 'sm-venn-m'));
        stage.appendChild(vennList(v.right.items, 'sm-venn-r'));
        wrap.appendChild(stage);
        return wrap;
    }

    // A ready, checked picture from the image library (server/image-library.js):
    // the label-free image, numbered pins on it and a legend in the story's
    // language (the English source term in brackets), an "AI-made" tag and a
    // report button (POST /api/story-image/report). The button is not printed.
    function libraryBody(v) {
        var wrap = el('div', 'sm-lib');
        var stage = el('div', 'sm-lib-stage');
        var img = document.createElement('img');
        img.className = 'sm-lib-img';
        img.src = v.src;
        img.alt = v.alt;
        img.loading = 'lazy';
        img.decoding = 'async';
        stage.appendChild(img);
        v.labels.forEach(function (l) {
            var pin = el('span', 'sm-lib-pin', String(l.n));
            pin.style.left = (l.x * 100) + '%';
            pin.style.top = (l.y * 100) + '%';
            pin.setAttribute('aria-hidden', 'true');
            stage.appendChild(pin);
        });
        wrap.appendChild(stage);
        if (v.labels.length) {
            var ol = el('ol', 'sm-lib-legend');
            v.labels.forEach(function (l) {
                var li = el('li', 'sm-lib-item');
                li.appendChild(el('span', 'sm-lib-n', String(l.n)));
                li.appendChild(el('span', 'sm-lib-term', l.term));
                if (l.source) li.appendChild(el('span', 'sm-lib-src', '(' + l.source + ')'));
                ol.appendChild(li);
            });
            wrap.appendChild(ol);
        }
        var foot = el('div', 'sm-lib-foot');
        foot.appendChild(el('span', 'sm-lib-tag', 'AI-made illustration'));
        var report = el('button', 'sm-link-btn sm-lib-report sm-no-print', 'Is this picture wrong?');
        report.type = 'button';
        var thanks = el('span', 'sm-lib-thanks sm-no-print sm-hidden', 'Thank you, we will check this picture.');
        thanks.setAttribute('role', 'status');
        report.addEventListener('click', function () {
            report.disabled = true;
            fetch('/api/story-image/report', {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId: sessionStorage.getItem('tutp_student_id'), imageId: v.id })
            }).then(function (r) {
                if (!r.ok) throw new Error('report failed');
                report.classList.add('sm-hidden');
                thanks.classList.remove('sm-hidden');
            }).catch(function () {
                report.disabled = false;
                report.textContent = 'Could not send. Try again';
            });
        });
        foot.appendChild(report);
        foot.appendChild(thanks);
        wrap.appendChild(foot);
        return wrap;
    }

    function visualLabel(v) {
        if (v.type === 'library') return v.alt;
        if (v.type === 'venn') {
            var of = function (items) { return items.map(function (i) { return i.text; }).join(', ') || 'none'; };
            return 'Venn diagram. ' + v.left.label + ' only: ' + of(v.left.items) + '. ' + v.right.label + ' only: ' + of(v.right.items) + '. Both: ' + of(v.both) + '.';
        }
        if (v.type === 'groups') {
            var equal = v.groups.every(function (g) { return g === v.groups[0]; });
            return v.total + (v.itemNoun ? ' ' + v.itemNoun : '') + (equal && v.groups.length > 1 ? ': ' + v.groups.length + ' groups of ' + v.groups[0] : ': ' + v.groups.join(' + '));
        }
        if (v.type === 'numberLine') {
            return 'Number line from ' + v.from + ' to ' + v.to + (v.jumps.length ? ', ' + v.jumps.map(function (j) { return 'jump from ' + j.from + ' to ' + j.to; }).join(', ') : '');
        }
        if (v.type === 'barModel') {
            return 'Bar of ' + v.total + ': ' + v.parts.map(function (p) { return (p.label ? p.label + ' ' : '') + p.value; }).join(', ');
        }
        return 'Number triangle: ' + factSentences(v).join(', ');
    }

    function visualEl(v) {
        var fig = el('figure', 'sm-visual sm-visual-' + v.type);
        var label = visualLabel(v);
        // A library picture is real content (an img with alt text, a legend and a
        // button), so it is not hidden from a screen reader as a drawing is.
        if (v.type !== 'library') {
            fig.setAttribute('role', 'img');
            fig.setAttribute('aria-label', label);
        }
        var body = v.type === 'library' ? libraryBody(v) : v.type === 'venn' ? vennBody(v) : v.type === 'groups' ? groupsBody(v) : v.type === 'numberLine' ? numberLineBody(v) : v.type === 'barModel' ? barModelBody(v) : factFamilyBody(v);
        if (v.type !== 'library') body.setAttribute('aria-hidden', 'true');
        fig.appendChild(body);
        if (v.type === 'groups' || v.type === 'factFamily') {
            fig.appendChild(el('figcaption', null, v.type === 'groups' ? label + (v.total > MAX_ITEMS ? ' (showing ' + MAX_ITEMS + ')' : '') : 'One fact, four sums'));
        }
        return fig;
    }

    var VISUAL_TYPES = { groups: 1, numberLine: 1, barModel: 1, factFamily: 1, venn: 1, library: 1 };

    // The feedback question, inline at the end of the result (it used to be the
    // page's fixed bottom-right box, which sat on top of the story at 360 px).
    // Same two questions and the same POST /api/feedback (the page's
    // submitFeedback); the one WhatsApp share prompt after a positive answer
    // is kept where the page has it.
    function feedbackEl(text) {
        var box = el('section', 'sm-feedback sm-no-print');
        box.id = 'storyModalFeedback';
        box.setAttribute('aria-label', 'Feedback');
        function step(id, question, label, defs, attr) {
            var s = el('div', 'sm-fb-step');
            s.id = id;
            s.appendChild(el('p', 'sm-fb-q', question));
            var row = el('div', 'sm-fb-row');
            row.setAttribute('role', 'group');
            row.setAttribute('aria-label', label);
            defs.forEach(function (d) {
                var b = el('button', 'sm-fb-btn', d[1]);
                b.type = 'button';
                b.setAttribute(attr, d[0]);
                b.setAttribute('aria-label', d[2]);
                row.appendChild(b);
            });
            s.appendChild(row);
            return s;
        }
        var s1 = step('storyModalFbSentiment', 'How was this story?', 'How was this story?',
            [['positive', '😊', 'Good'], ['neutral', '😐', 'Okay'], ['negative', '😟', 'Not good']], 'data-sentiment');
        var s2 = step('storyModalFbClear', 'Was the explanation clear?', 'Was the explanation clear?',
            [['true', '👍', 'Yes, it was clear'], ['false', '👎', 'No, it was not clear']], 'data-clear');
        s2.classList.add('sm-hidden');
        var thanks = el('p', 'sm-fb-thanks sm-hidden', 'Thank you for telling us.');
        thanks.setAttribute('role', 'status');
        var sentiment = null;
        s1.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('[data-sentiment]');
            if (!b) return;
            sentiment = b.getAttribute('data-sentiment');
            s1.classList.add('sm-hidden');
            s2.classList.remove('sm-hidden');
        });
        s2.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('[data-clear]');
            if (!b) return;
            submitFeedback(sessionStorage.getItem('tutp_student_id'), 'storytelling', sentiment, b.getAttribute('data-clear') === 'true', text);
            s2.classList.add('sm-hidden');
            thanks.classList.remove('sm-hidden');
            if (sentiment === 'positive' && typeof showWhatsappSharePrompt === 'function' && !sessionStorage.getItem('tutp_whatsapp_share_shown')) {
                sessionStorage.setItem('tutp_whatsapp_share_shown', '1');
                showWhatsappSharePrompt();
            }
        });
        box.appendChild(s1); box.appendChild(s2); box.appendChild(thanks);
        return box;
    }

    function render(story, lang) {
        var info = LANGS[lang] || LANGS.English;
        var box = $('storyModalResults');
        box.textContent = '';
        box.setAttribute('data-script', info.script || 'latin');
        box.setAttribute('dir', info.rtl ? 'rtl' : 'ltr');
        box.setAttribute('lang', info.bcp);

        var bar = el('div', 'sm-bar sm-no-print');
        var printBtn = el('button', 'sm-btn sm-btn-ghost');
        printBtn.type = 'button';
        printBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">print</span>Save as PDF / Print';
        printBtn.addEventListener('click', function () { printResult('storyModalResults'); });
        bar.appendChild(printBtn);
        box.appendChild(bar);

        var head = el('div', 'sm-title-block');
        head.appendChild(el('h4', 'sm-title', story.title));
        var meta = el('p', 'sm-meta');
        if (story.tag) meta.appendChild(el('span', 'sm-tag', story.tag));
        if (story.minutes) meta.appendChild(el('span', 'sm-read', story.minutes + ' min read'));
        if (meta.childNodes.length) head.appendChild(meta);
        box.appendChild(head);

        // img1: the story's concept picture (shared with Explain, Notes and Answer). Library
        // pictures are drawn below as before; a story with one has no `picture`.
        if (story.picture && window.TutpPicture) {
            window.TutpPicture.mount(box, story.picture, { studentId: sessionStorage.getItem('tutp_student_id'), surface: 'story' }, { variant: 'hero', alt: story.title });
        }

        var ol = el('ol', 'sm-scenes');
        story.scenes.forEach(function (s, i) {
            var li = el('li', 'sm-scene');
            li.appendChild(el('span', 'sm-num', String(i + 1)));
            var body = el('div', 'sm-scene-body');
            body.appendChild(el('div', 'sm-scene-label', SCENE_TITLES[s.label] || ''));
            body.appendChild(el('p', 'sm-scene-text', s.text));
            li.appendChild(body);
            ol.appendChild(li);
            if (s.label === 'mathMoment' && story.visual) li.appendChild(visualEl(story.visual));
        });
        box.appendChild(ol);

        if (story.visual && !story.scenes.some(function (s) { return s.label === 'mathMoment'; })) box.appendChild(visualEl(story.visual));

        if (story.equations.length) {
            var eqs = el('ul', 'sm-eqs');
            eqs.setAttribute('aria-label', 'Equations from the story');
            story.equations.forEach(function (t) { eqs.appendChild(el('li', 'sm-eq', t)); });
            box.appendChild(eqs);
        }

        if (story.tryTogether) {
            var tt = el('section', 'sm-try');
            tt.appendChild(el('h5', 'sm-card-title', 'Try together'));
            tt.appendChild(el('p', 'sm-try-q', story.tryTogether.question));
            var reveal = el('button', 'sm-btn sm-btn-outline sm-reveal sm-no-print', 'Show answer');
            reveal.type = 'button';
            reveal.id = 'storyModalRevealBtn';
            reveal.setAttribute('aria-expanded', 'false');
            reveal.setAttribute('aria-controls', 'storyModalAnswer');
            var ans = el('p', 'sm-answer sm-hidden', story.tryTogether.answer);
            ans.id = 'storyModalAnswer';
            reveal.addEventListener('click', function () {
                var open = ans.classList.toggle('sm-hidden') === false;
                reveal.setAttribute('aria-expanded', open ? 'true' : 'false');
                reveal.textContent = open ? 'Hide answer' : 'Show answer';
            });
            tt.appendChild(reveal);
            tt.appendChild(ans);
            box.appendChild(tt);
        }

        if (story.parentPrompt) {
            var ask = el('section', 'sm-ask');
            ask.appendChild(el('h5', 'sm-card-title', 'Ask your child'));
            ask.appendChild(el('p', 'sm-ask-text', story.parentPrompt));
            box.appendChild(ask);
        }

        // Printed at the bottom whether or not the answer was revealed.
        if (story.tryTogether) {
            var pa = el('section', 'sm-print-only');
            pa.appendChild(el('h5', 'sm-card-title', 'Answer to "Try together"'));
            pa.appendChild(el('p', 'sm-answer-print', story.tryTogether.answer));
            box.appendChild(pa);
        }

        var audio = el('div', 'sm-audio sm-no-print');
        var play = el('button', 'sm-btn sm-btn-primary', '▶ Play story');
        play.type = 'button'; play.id = 'storyModalPlayBtn';
        play.setAttribute('aria-label', 'Play the story aloud');
        play.addEventListener('click', playStory);
        var stop = el('button', 'sm-btn sm-btn-ghost sm-hidden', '⏹ Stop');
        stop.type = 'button'; stop.id = 'storyModalStopBtn';
        stop.setAttribute('aria-label', 'Stop reading aloud');
        stop.addEventListener('click', stopStory);
        var hint = el('p', 'sm-coach sm-hidden');
        hint.id = 'storyModalTtsNote';
        hint.appendChild(el('strong', null, 'Audio is not available right now. Read aloud together. '));
        hint.appendChild(document.createTextNode('Take turns reading each scene, and let your child guess what happens next.'));
        audio.appendChild(play); audio.appendChild(stop); audio.appendChild(hint);
        box.appendChild(audio);

        box.appendChild(feedbackEl(story.scenes.map(function (s) { return s.text; }).join(' ')));
        box.appendChild(el('p', 'sm-foot', 'Built on NCF-SE 2023 Panchpadi'));

        var again = el('div', 'sm-again sm-no-print');
        var againBtn = el('button', 'sm-btn sm-btn-ghost', '↺ Try another lesson');
        againBtn.type = 'button';
        againBtn.addEventListener('click', resetStoryModal);
        again.appendChild(againBtn);
        box.appendChild(again);
    }

    // ---------------------------------------------------------------- submit
    async function submit() {
        var topic = $('storyModalText').value.trim();
        var lang = $('storyModalLang').value;
        var errBox = $('storyModalErrBox');
        var submitBtn = $('storyModalSubmitBtn');
        if (!topic && !attachState.items.length) {
            errBox.textContent = 'Please type the lesson topic or attach a photo/PDF first.';
            errBox.classList.remove('sm-hidden');
            return;
        }
        errBox.classList.add('sm-hidden');
        submitBtn.disabled = true;
        ensureFont(lang);
        var stopLoading = startStagedLoading(submitBtn, ['Writing the story…', 'Thinking it through…', 'Almost done…'], 7000);
        var token = sessionToken;
        try {
            // The server builds the prompt and checks the reply
            // (server/prompts/homework-prompts.js, server/story-schema.js).
            var parsed = await callHomeworkApi({ feature: 'storytelling', text: topic, language: lang, attachments: attachState.items });
            if (token !== sessionToken) return;
            var story = normalize(parsed);
            if (!story.scenes.length) throw new Error('empty story');
            render(story, lang);
            $('storyModalForm').classList.add('sm-hidden');
            $('storyModalResults').classList.remove('sm-hidden');
            var spoken = [story.title].concat(story.scenes.map(function (s) { return s.text; })).concat(story.tryTogether ? [story.tryTogether.question] : []).join('. ');
            var canSpeak = await setupAudio($('storyModalResults'), spoken, lang);
            if (token !== sessionToken) return;
            if (canSpeak) playStory();
        } catch (err) {
            if (token !== sessionToken) return;
            console.error('[storyModal] Story request failed:', err);
            if (err.name === 'FreeLimitError') {
                showFreeLimitModal(err.message, err.bucket);
                return;
            } else if (err.name === 'ModalParseError' || err.message === 'empty story') {
                errBox.textContent = "Couldn't write a story from this — try attaching the actual lesson page or typing what it's about.";
            } else {
                errBox.textContent = err.message;
            }
            errBox.classList.remove('sm-hidden');
        } finally {
            stopLoading();
            if (token === sessionToken) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit & Tell';
            }
        }
    }

    window.openStorytellingModal = openStorytellingModal;
    window.closeStoryModal = closeStoryModal;
    window.resetStoryModal = resetStoryModal;
    window.playStory = playStory;
    window.stopStory = stopStory;
    // The markup is built at load, so storyModalAttachInput exists for the
    // search-box chooser (routeSearchAttachTo) before the modal is first opened.
    build();
})();
