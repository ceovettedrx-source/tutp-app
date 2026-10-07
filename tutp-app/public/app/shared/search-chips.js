// Mode chips under the homework input box (search-box-v2): Answer please,
// Explain please, Notes please (and Exam prep once round 4 ships and the
// server config turns it on). Loaded as a plain script right after
// homework-modal.js, which calls TutpChips.open / selected / onResult /
// reset from its own handlers.
//
// A chip ONLY SETS THE MODE (tap again to clear). It never fills the input
// and never submits by itself before a result exists; the existing submit
// button sends the selected mode. With a result on screen, a tap shows that
// same result in the new mode with no new upload and no new reading of the
// photo:
//   answer / explain  open or close the "Why?" details already on every card
//   notes             ONE call to /api/homework-notes with the question text
//                     already extracted (cached per language)
// A typed instruction overrides the selected chip: the server classifies it
// (X-Chip-Intent on the /api/homework reply) and onResult applies it.
//
// The chips come from GET /api/search-chips (server/chips/chip-config.js);
// if that fails the row simply stays hidden. Impressions and taps go to
// POST /api/chip-events (fire and forget, never blocks the page).
// All chip text (en, te, hi) in one place, the same shape as
// window.TUTP_AUTH_MESSAGES in auth-messages.js: en is the source text and the
// fallback for a missing language or key; te and hi are DRAFTS in parents' own
// words, to be checked by a native speaker (tap-through will also tell).
window.TUTP_CHIP_MESSAGES = {
    en: {
        'chip.group': 'How should Tut-P help?',
        'chip.answer': 'Answer please',
        'chip.explain': 'Explain please',
        'chip.notes': 'Notes please',
        'chip.exam_prep': 'Exam prep',
        'chip.makingNotes': 'Making notes…',
        'chip.notesFailed': 'The notes could not be made right now.',
        'chip.retry': 'Try again'
    },
    te: {
        'chip.group': 'టుట్-పి ఎలా సహాయం చేయాలి?',
        'chip.answer': 'సమాధానం చెప్పండి',
        'chip.explain': 'వివరించండి',
        'chip.notes': 'నోట్స్ ఇవ్వండి',
        'chip.exam_prep': 'పరీక్ష తయారీ',
        'chip.makingNotes': 'నోట్స్ తయారు చేస్తున్నాం…',
        'chip.notesFailed': 'ఇప్పుడు నోట్స్ తయారు చేయలేకపోయాం.',
        'chip.retry': 'మళ్ళీ ప్రయత్నించండి'
    },
    hi: {
        'chip.group': 'Tut-P कैसे मदद करे?',
        'chip.answer': 'जवाब बताइए',
        'chip.explain': 'समझाइए',
        'chip.notes': 'नोट्स दीजिए',
        'chip.exam_prep': 'परीक्षा की तैयारी',
        'chip.makingNotes': 'नोट्स बन रहे हैं…',
        'chip.notesFailed': 'अभी नोट्स नहीं बन सके।',
        'chip.retry': 'फिर से कोशिश करें'
    }
};

(function () {
    const STYLE = `
        #hwChipRow{margin-top:14px}
        #hwChipRow .hw-chip-label{display:block;font-size:11px;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px}
        #hwChips{display:flex;flex-wrap:wrap;gap:6px}
        #hwChips button{min-height:40px;padding:0 8px;border-radius:999px;border:2px solid #c2c6d4;background:#fff;color:#1a1c20;font-size:12.5px;font-weight:600;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
        #hwChips button:hover{border-color:#005bbf}
        #hwChips button:focus-visible{outline:3px solid #005bbf;outline-offset:2px}
        #hwChips button[aria-pressed="true"]{background:#005bbf;border-color:#005bbf;color:#fff}
        #hwChipRow.in-results{margin:0 0 10px}
        #hwNotesBlock ol{margin:8px 0 0;padding-left:20px}
        #hwNotesBlock li{margin:0 0 6px;font-size:15px;line-height:1.5}
    `;

    let config = null;            // { chips, labels } from the server
    let configLoad = null;
    let selectedId = null;        // the selected chip, or null (the default)
    let hasResult = false;
    let lastParsed = null;
    let lastTyped = '';
    let explainBuilt = null;      // { parsed, lang } of the Explain please block on screen
    let openToken = 0;            // bumped on every open/reset: stale answers are dropped
    let loggedImpressions = null;
    const notesCache = new Map(); // language -> { subject, notes }

    const $ = (id) => document.getElementById(id);
    // The explanation language the parent picked ("Explain in"): what the
    // notes are written in, and what is logged.
    const lang = () => ($('hwModalLang') && $('hwModalLang').value) || 'English';
    // The language of the chip text itself, picked the way auth-messages.js
    // does it: tutp_ui_lang if set, else the browser's languages, else en.
    const MSG = window.TUTP_CHIP_MESSAGES;
    function uiLang() {
        try {
            const saved = localStorage.getItem('tutp_ui_lang');
            if (saved && MSG[saved]) return saved;
        } catch (e) {}
        const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
        for (const p of prefs) {
            const base = String(p).toLowerCase().split('-')[0];
            if (MSG[base]) return base;
        }
        return 'en';
    }
    // The language of the chip row and the notes card headings: the "Explain
    // in" language when we have text for it, else the page's UI language,
    // else English (labelFor falls back to English per key).
    const CARD_LANG = { English: 'en', Telugu: 'te', Hindi: 'hi' };
    const chipLang = () => CARD_LANG[lang()] || uiLang();
    const labelFor = (key) => (MSG[chipLang()] && MSG[chipLang()][key]) || MSG.en[key] || key;

    function loadConfig() {
        if (config) return Promise.resolve(config);
        if (!configLoad) {
            configLoad = fetch('/api/search-chips')
                .then((r) => (r.ok ? r.json() : null))
                .then((c) => { if (c && Array.isArray(c.chips) && c.chips.length) config = c; return config; })
                .catch(() => null)
                .then((c) => { if (!c) configLoad = null; return c; });
        }
        return configLoad;
    }

    function logEvents(events) {
        if (!events.length) return;
        try {
            fetch('/api/chip-events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                body: JSON.stringify({ studentId: sessionStorage.getItem('tutp_student_id'), language: lang(), events })
            }).catch(() => {});
        } catch (e) { /* logging never blocks the page */ }
    }

    function injectStyle() {
        if ($('hwChipStyle')) return;
        const s = document.createElement('style');
        s.id = 'hwChipStyle';
        s.textContent = STYLE;
        document.head.appendChild(s);
    }

    function renderChips() {
        const wrap = $('hwChips');
        if (!wrap || !config) return;
        wrap.replaceChildren(...config.chips.map((c) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.dataset.chip = c.id;
            b.setAttribute('aria-pressed', String(c.id === selectedId));
            b.textContent = labelFor(c.i18nKey);
            b.addEventListener('click', () => onTap(c));
            return b;
        }));
        const label = $('hwChipLabel');
        if (label) label.textContent = labelFor('chip.group');
    }

    function paintSelection() {
        document.querySelectorAll('#hwChips button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.chip === selectedId)));
    }

    // The row sits under the input in the form; once a result is on screen it
    // moves (the same node) to the top of the results.
    function place(inResults) {
        const row = $('hwChipRow');
        if (!row) return;
        row.classList.add('no-print');   // the chip buttons never print
        const results = $('hwModalResults');
        if (inResults) {
            results.insertBefore(row, results.firstChild);
            row.classList.add('in-results');
        } else {
            const submit = $('hwModalSubmitBtn');
            submit.parentNode.insertBefore(row, submit);
            row.classList.remove('in-results');
        }
    }

    function onTap(chip) {
        selectedId = selectedId === chip.id ? null : chip.id;
        paintSelection();
        logEvents([{ kind: 'tap', chip: chip.id, intent: chip.intent }]);
        if (hasResult) applyMode();
    }

    // ---- the result in the selected mode ----
    function setDetailsOpen(open) {
        document.querySelectorAll('#hwModalQuestionsArea details').forEach((d) => { d.open = open; });
    }

    // The plain look (messages, and the fallback when the reply has no
    // structure) is the beige box; the structured card brings its own design.
    const PLAIN_BOX = 'bg-secondary-container/30 border-l-4 border-secondary rounded-lg px-5 py-5 mt-2';
    function notesBlock() {
        let block = $('hwNotesBlock');
        if (block) return block;
        block = document.createElement('div');
        block.id = 'hwNotesBlock';
        block.className = 'hidden ' + PLAIN_BOX;
        block.setAttribute('aria-live', 'polite');
        const results = $('hwModalResults');
        results.insertBefore(block, $('hwModalHomeworkResultBlock'));
        return block;
    }
    function setBoxLook(block, plain) {
        PLAIN_BOX.split(' ').forEach((c) => block.classList.toggle(c, plain));
    }

    function showNotes(data) {
        const block = notesBlock();
        block.replaceChildren();
        if (data && data.version === 2 && window.TutpNotesCard) {
            setBoxLook(block, false);
            block.appendChild(window.TutpNotesCard.render(data, { lang: chipLang() }));
            return;
        }
        setBoxLook(block, true);
        const title = document.createElement('div');
        title.className = 'font-label-md text-label-md text-secondary';
        title.textContent = (data.subject ? data.subject + ' · ' : '') + labelFor('chip.notes');
        const ol = document.createElement('ol');
        (data.plain || data.notes || []).forEach((n) => { const li = document.createElement('li'); li.textContent = n; ol.appendChild(li); });
        block.append(title, ol);
    }

    function showNotesMessage(text) {
        const block = notesBlock();
        block.replaceChildren();
        setBoxLook(block, true);
        const p = document.createElement('p');
        p.className = 'text-[15px] text-on-surface-variant m-0';
        p.textContent = text;
        block.appendChild(p);
    }

    // The signed concept key of the photo's first question or idea, so Notes shows the same
    // picture as Answer and Explain (the server checks the signature).
    function firstConcept(parsed) {
        const q = parsed && parsed.schema === 2 && Array.isArray(parsed.questions) ? parsed.questions[0] : null;
        return q && q.concept_key && q.concept_sig ? { concept_key: q.concept_key, concept_sig: q.concept_sig } : {};
    }

    async function loadNotes() {
        const l = lang();
        if (notesCache.has(l)) { showNotes(notesCache.get(l)); return; }
        const token = openToken;
        showNotesMessage(labelFor('chip.makingNotes'));
        const parsed = lastParsed || {};
        const questions = (parsed.extracted_questions || []).map((q) => q && q.question).filter(Boolean);
        const topic = parsed.concept_explanation || lastTyped || '';
        try {
            const res = await fetch('/api/homework-notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId: sessionStorage.getItem('tutp_student_id'), language: l, questions, topic, ...firstConcept(parsed) })
            });
            if (token !== openToken) return;
            if (!res.ok) throw new Error('notes ' + res.status);
            const data = await res.json();
            notesCache.set(l, data);
            if (selectedId === 'notes' && lang() === l) showNotes(data);
        } catch (err) {
            if (token !== openToken) return;
            console.error('[chips] notes failed:', err);
            notesCache.delete(l);
            if (selectedId === 'notes') {
                showNotesMessage(labelFor('chip.notesFailed'));
                const retry = document.createElement('button');
                retry.type = 'button';
                retry.dataset.role = 'notes-retry';
                retry.className = 'font-label-md text-xs text-primary underline mt-2';
                retry.textContent = labelFor('chip.retry');
                retry.addEventListener('click', loadNotes);
                notesBlock().appendChild(retry);
            }
        }
    }

    // Explain please (answer-explain v2 replies): every question or idea of the photo
    // is explained in full at once, in its own block next to the answers, all requested
    // in parallel and shown as each arrives (docs/specs/img1.md). A reply without the v2
    // cards keeps the old behaviour (the "Why?" details open).
    function explainBlock() {
        let block = $('hwExplainBlock');
        if (block) return block;
        block = document.createElement('div');
        block.id = 'hwExplainBlock';
        block.className = 'hidden';
        block.setAttribute('aria-live', 'polite');
        $('hwModalResults').insertBefore(block, $('hwModalHomeworkResultBlock'));
        return block;
    }
    const v2Explain = () => !!(lastParsed && lastParsed.schema === 2 && lastParsed.status === 'ok' && window.TutpExplain && typeof window.TutpExplain.explainAll === 'function');
    function showExplain() {
        const l = lang();
        const block = explainBlock();
        if (explainBuilt && explainBuilt.parsed === lastParsed && explainBuilt.lang === l) return;
        explainBuilt = { parsed: lastParsed, lang: l };
        window.TutpExplain.explainAll(block, lastParsed, { studentId: sessionStorage.getItem('tutp_student_id'), language: l });
    }

    function applyMode() {
        const notes = selectedId === 'notes';
        const explainOn = selectedId === 'explain' && v2Explain();
        const block = notesBlock();
        block.classList.toggle('hidden', !notes);
        if ($('hwExplainBlock') || explainOn) explainBlock().classList.toggle('hidden', !explainOn);
        $('hwModalHomeworkResultBlock').classList.toggle('hidden', notes || explainOn);
        if (notes) { loadNotes(); return; }
        if (explainOn) { showExplain(); return; }
        setDetailsOpen(selectedId === 'explain');
    }

    // ---- hooks called by homework-modal.js ----
    window.TutpChips = {
        // A fresh modal (Homework Help only: Quiz has no chips).
        open(mode) {
            injectStyle();
            openToken++;
            hasResult = false;
            lastParsed = null;
            lastTyped = '';
            selectedId = null;
            explainBuilt = null;
            notesCache.clear();
            loggedImpressions = new Set();
            const row = $('hwChipRow');
            if (!row) return;
            if ($('hwNotesBlock')) $('hwNotesBlock').classList.add('hidden');
            if ($('hwExplainBlock')) { $('hwExplainBlock').classList.add('hidden'); $('hwExplainBlock').replaceChildren(); }
            place(false);
            if (mode !== 'homework') { row.classList.add('hidden'); return; }
            const token = openToken;
            loadConfig().then((c) => {
                if (!c || token !== openToken) return;
                renderChips();
                row.classList.remove('hidden');
                logEvents(c.chips.filter((x) => !loggedImpressions.has(x.id)).map((x) => {
                    loggedImpressions.add(x.id);
                    return { kind: 'impression', chip: x.id, intent: x.intent };
                }));
            });
        },
        selected() { return selectedId; },
        // The homework result is on screen. typedIntent is X-Chip-Intent: a
        // typed instruction overrides the selected chip (an intent whose chip
        // is not shown, e.g. exam_prep today, is only logged by the server).
        onResult(parsed, typedIntent, typed) {
            hasResult = true;
            lastParsed = parsed;
            lastTyped = typed || '';
            explainBuilt = null;
            if ($('hwExplainBlock')) $('hwExplainBlock').replaceChildren();
            const chip = config && config.chips.find((c) => c.intent === typedIntent);
            if (chip) selectedId = chip.id;
            paintSelection();
            place(true);
            if ($('hwChipRow') && config) $('hwChipRow').classList.remove('hidden');
            applyMode();
        },
        // Switch to a mode from outside (an answer card's Explain button). Returns true when the
        // mode chip exists and the result is on screen, so the caller knows the click was handled.
        show(id, index) {
            const chip = config && config.chips.find((c) => c.id === id);
            if (!chip || !hasResult) return false;
            if (id === 'explain' && !v2Explain()) return false;
            selectedId = id;
            paintSelection();
            logEvents([{ kind: 'tap', chip: chip.id, intent: chip.intent }]);
            applyMode();
            const card = document.querySelector('#hwExplainBlock [data-qi="' + (Number.isInteger(index) ? index : 0) + '"]');
            if (card && card.scrollIntoView) card.scrollIntoView({ block: 'start' });
            return true;
        },
        reset() {
            openToken++;
            hasResult = false;
            lastParsed = null;
            selectedId = null;
            explainBuilt = null;
            notesCache.clear();
            paintSelection();
            if ($('hwNotesBlock')) $('hwNotesBlock').classList.add('hidden');
            if ($('hwExplainBlock')) { $('hwExplainBlock').classList.add('hidden'); $('hwExplainBlock').replaceChildren(); }
            $('hwModalHomeworkResultBlock') && $('hwModalHomeworkResultBlock').classList.remove('hidden');
            if ($('hwChipRow')) place(false);
        }
    };

    document.addEventListener('change', (e) => {
        // The chip row and the notes follow the "Explain in" language.
        if (!e.target || e.target.id !== 'hwModalLang' || !config) return;
        renderChips();
        if (hasResult && (selectedId === 'notes' || selectedId === 'explain')) applyMode();
    });
})();
