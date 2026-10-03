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
// showFeedbackPrompt, showFreeLimitModal, printResult.
//
// The reply (server/story-schema.js) is { title, gradeSubjectTag,
// readMinutes, scenes[], visual|null, equations[], tryTogether|null,
// parentPrompt }. An older { story, abhyasaPrompt } reply is shown too.
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
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        var m = $('storyModal');
        if (m) m.classList.add('sm-hidden');
        if (openerEl && openerEl.focus) { try { openerEl.focus(); } catch (e) { /* element gone */ } }
        openerEl = null;
    }
    function resetStoryModal() {
        build();
        if (window.speechSynthesis) window.speechSynthesis.cancel();
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
    // Shows the play button when this device has a voice for the language, and
    // otherwise a "read aloud together" hint (never an error).
    function setupAudio(box, text, lang) {
        currentText = text;
        currentBcp = (LANGS[lang] || LANGS.English).bcp;
        return waitForSpeechVoices().then(function () {
            var play = box.querySelector('#storyModalPlayBtn');
            var hint = box.querySelector('#storyModalTtsNote');
            var has = 'speechSynthesis' in window && !!voiceFor(currentBcp);
            if (play) play.classList.toggle('sm-hidden', !has);
            if (hint) hint.classList.toggle('sm-hidden', has);
            return has;
        });
    }
    function playStory() {
        if (!('speechSynthesis' in window) || !currentText) return;
        window.speechSynthesis.cancel();
        var utter = new SpeechSynthesisUtterance(currentText);
        var v = voiceFor(currentBcp);
        if (v) utter.voice = v;
        utter.onend = function () { toggleAudio(false); };
        window.speechSynthesis.speak(utter);
        toggleAudio(true);
    }
    function stopStory() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
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
            visual: p.visual && p.visual.type === 'groups' ? p.visual : null,
            equations: Array.isArray(p.equations) ? p.equations : [],
            tryTogether: p.tryTogether && p.tryTogether.question ? p.tryTogether : null,
            parentPrompt: p.parentPrompt || p.abhyasaPrompt || ''
        };
    }

    function visualEl(v) {
        var fig = el('figure', 'sm-visual');
        var equal = v.groups.every(function (g) { return g === v.groups[0]; });
        var label = v.total + ' ' + v.itemNoun + (equal && v.groups.length > 1 ? ': ' + v.groups.length + ' groups of ' + v.groups[0] : ': ' + v.groups.join(' + '));
        fig.setAttribute('role', 'img');
        fig.setAttribute('aria-label', label);
        var grid = el('div', 'sm-groups');
        grid.setAttribute('aria-hidden', 'true');
        var drawn = 0;
        v.groups.forEach(function (n) {
            var g = el('div', 'sm-group');
            var dots = el('div', 'sm-dots');
            for (var i = 0; i < n && drawn < MAX_ITEMS; i++, drawn++) dots.appendChild(el('span', 'sm-dot'));
            g.appendChild(dots);
            g.appendChild(el('span', 'sm-group-n', String(n)));
            grid.appendChild(g);
        });
        fig.appendChild(grid);
        var cap = label + (v.total > MAX_ITEMS ? ' (showing ' + MAX_ITEMS + ')' : '');
        fig.appendChild(el('figcaption', null, cap));
        return fig;
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
        hint.appendChild(el('strong', null, 'Read aloud together. '));
        hint.appendChild(document.createTextNode('Take turns reading each scene, and let your child guess what happens next.'));
        audio.appendChild(play); audio.appendChild(stop); audio.appendChild(hint);
        box.appendChild(audio);

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
            var all = story.scenes.map(function (s) { return s.text; }).join(' ');
            showFeedbackPrompt('storytelling', all);
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
