// Family Library (TUT-69): everything generated for a child, saved on the server.
// The dashboards show a "Family Library" card (#tutpLibraryCard: "<N> saved" + newest title); tapping it opens
// the full view (#tutpLibraryFull, Back button #tutpLibraryBack) that holds <div id="tutpLibrary">.
// Mounts into that div on the mother/father/family-member and child pages.
//   subject chips with counts -> cards (newest first) -> open with the page's own renderers,
//   read-only: answer-cards.js (answers), explain-panel.js (explanations), notes-card.js (notes),
//   story-modal.js (stories). Quizzes and Experiential Learning have no stand-alone renderer, so
//   they show as plain read-only text. Save as PDF = print; Listen = tts-listen.js.
// Also moves the browser's old saved explanations (localStorage) to the server, once.
// All server text goes in with textContent, never as HTML.
(function () {
    'use strict';
    var MODE_ICON = { answer: 'task_alt', explain: 'lightbulb', notes: 'sticky_note_2', story: 'auto_stories', quiz: 'quiz', experiential: 'science' };
    var MODE_LABEL = { answer: 'Answer', explain: 'Explanation', notes: 'Notes', story: 'Story', quiz: 'Quiz', experiential: 'Experiential' };
    var isChild = /^\/app\/child\b/.test(location.pathname);
    var root = null, state = { subject: null, items: [], next: null, subjects: [], studentId: null, upsell: null };

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function studentId() { try { return sessionStorage.getItem('tutp_student_id') || ''; } catch (e) { return ''; } }
    function headers(extra) {
        var h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
        if (isChild) h['X-Tutp-View'] = 'child';
        return h;
    }
    function api(path, opts) {
        opts = opts || {};
        return fetch(path, { method: opts.method || 'GET', credentials: 'same-origin', headers: headers(), body: opts.body ? JSON.stringify(opts.body) : undefined });
    }
    function needScript(test, src) {
        if (test()) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('Could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    function needCss(href) {
        if (document.querySelector('link[href="' + href + '"]')) return;
        var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
    }

    var CSS = '#tutpLibrary{margin:16px 0}'
        + '.tl-full{position:fixed;inset:0;z-index:60;background:#faf8f2;color:#222;overflow:auto;padding:16px}.tl-full[hidden]{display:none}'
        + '.tl-fullbar{max-width:760px;margin:0 auto}.tl-full #tutpLibrary{max-width:760px;margin:12px auto}'
        + '.tl-h{font:600 18px/1.3 inherit;margin:0 0 4px}.tl-sub{margin:0 0 12px;opacity:.75;font-size:14px}'
        + '.tl-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}'
        + '.tl-chip{min-height:44px;padding:8px 14px;border-radius:22px;border:1px solid #c9c4b8;background:#fff;color:inherit;font:inherit;cursor:pointer}'
        + '.tl-chip[aria-pressed="true"]{background:#2f6f4f;color:#fff;border-color:#2f6f4f}'
        + '.tl-list{display:grid;gap:10px;grid-template-columns:1fr}@media(min-width:700px){.tl-list{grid-template-columns:1fr 1fr}}'
        + '.tl-card{display:flex;gap:12px;align-items:flex-start;text-align:left;min-height:64px;padding:12px;border-radius:14px;border:1px solid #d8d3c7;background:#fff;color:inherit;font:inherit;cursor:pointer;width:100%}'
        + '.tl-card[data-locked="1"]{opacity:.7}'
        + '.tl-ico{font-family:"Material Symbols Outlined";font-size:26px;line-height:1;flex:none}'
        + '.tl-t{font-weight:600;overflow-wrap:anywhere}.tl-m{font-size:13px;opacity:.75}'
        + '.tl-label{display:inline-block;margin-top:4px;padding:2px 8px;border-radius:10px;background:#efe9da;font-size:12px}'
        + '.tl-empty{padding:20px;border-radius:14px;background:#f7f3e8;text-align:center}'
        + '.tl-more{margin:12px auto 0;display:block}'
        + '.tl-viewer{position:fixed;inset:0;z-index:70;background:#fff;color:#222;overflow:auto;padding:16px}'
        + '.tl-bar{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}'
        + '.tl-btn{min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid #c9c4b8;background:#fff;color:inherit;font:inherit;cursor:pointer}'
        + '.tl-body{max-width:760px;margin:0 auto}.tl-q{margin:0 0 14px;padding:12px;border:1px solid #d8d3c7;border-radius:12px}'
        + '.tl-opt{margin:6px 0;padding:8px 10px;border-radius:8px;border:1px solid #d8d3c7}.tl-opt.ok{background:#e3f3e8;border-color:#2f6f4f}'
        + '.tl-err{color:#a33;margin:8px 0}'
        + '@media print{body.tl-printing>*:not(.tl-viewer){display:none!important}.tl-viewer{position:static;padding:0}.tl-bar{display:none}}';

    function injectCss() {
        if (document.getElementById('tutpLibraryCss')) return;
        var s = document.createElement('style'); s.id = 'tutpLibraryCss'; s.textContent = CSS; document.head.appendChild(s);
    }

    // ---- old localStorage explanations -> server, once --------------------------------------------
    function importLocal(sid) {
        var key = 'tutp_saved_explanations_' + sid, list = [];
        try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { list = []; }
        if (isChild || !Array.isArray(list) || !list.length) return Promise.resolve();
        return fetch('/api/library/import', { method: 'POST', credentials: 'same-origin', headers: headers(), body: JSON.stringify({ studentId: sid, items: list.slice(0, 50) }) })
            .then(function (r) { if (r.ok) { try { localStorage.removeItem(key); } catch (e) { /* kept */ } } })
            .catch(function () { /* the key stays; the next visit tries again */ });
    }

    // ---- list -------------------------------------------------------------------------------------
    // Every load takes the next number. A reply that is no longer the newest load (the child, the subject
    // or the page changed since it was sent) is dropped: it must neither replace nor extend the list.
    var loadSeq = 0;
    function load(reset) {
        var sid = state.studentId, mine = ++loadSeq;
        if (!sid) { draw(); return Promise.resolve(); }
        var q = '/api/library?studentId=' + encodeURIComponent(sid) + (state.subject != null ? '&subject=' + encodeURIComponent(state.subject) : '') + (!reset && state.next ? '&cursor=' + encodeURIComponent(state.next) : '');
        return api(q).then(function (r) { if (!r.ok) throw new Error('library ' + r.status); return r.json(); }).then(function (d) {
            if (mine !== loadSeq) return;
            state.items = reset ? d.items : state.items.concat(d.items);
            state.next = d.next; state.subjects = d.subjects; state.upsell = d.upsell || null; state.failed = false;
            if (state.subject == null) updateCard();
            draw();
        }).catch(function () { if (mine !== loadSeq) return; state.failed = true; draw(); });
    }

    // The dashboard card: how many are saved and the newest title. Only the unfiltered list says that.
    function updateCard() {
        var c = document.getElementById('tutpLibCount'), l = document.getElementById('tutpLibLatest');
        if (!c || !l) return;
        c.textContent = state.subjects.reduce(function (n, s) { return n + s.count; }, 0) + ' saved';
        l.textContent = state.items.length ? state.items[0].title : 'Your child’s learning will collect here.';
    }

    // ---- the full view: opened from the card, closed with Back (also the phone's back button) -------
    var full = null, wired = false, pushed = false, prevOverflow = '';
    function showFull() {
        if (!full || !full.hidden) return;
        full.hidden = false;
        try { prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; } catch (e) { /* kept */ }
        try { history.pushState({ tlFull: 1 }, ''); pushed = true; } catch (e) { pushed = false; }
        full.scrollTop = 0;
        var b = document.getElementById('tutpLibraryBack'); if (b) b.focus();
    }
    function hideFull() {
        if (!full || full.hidden) return;
        full.hidden = true; pushed = false;
        try { document.body.style.overflow = prevOverflow; } catch (e) { /* kept */ }
    }
    function wire() {
        if (wired) return;
        full = document.getElementById('tutpLibraryFull');
        var cardEl = document.getElementById('tutpLibraryCard'), back = document.getElementById('tutpLibraryBack');
        if (!full || !cardEl || !back) return;
        wired = true;
        if (full.parentNode !== document.body) document.body.appendChild(full);
        cardEl.addEventListener('click', showFull);
        back.addEventListener('click', function () { if (pushed) history.back(); else hideFull(); });
        window.addEventListener('popstate', hideFull);
    }

    function card(item) {
        var b = el('button', 'tl-card');
        b.type = 'button';
        if (item.locked) b.setAttribute('data-locked', '1');
        var ico = el('span', 'tl-ico', MODE_ICON[item.mode] || 'description'); ico.setAttribute('aria-hidden', 'true');
        var txt = el('span');
        txt.appendChild(el('span', 'tl-t', item.title));
        txt.appendChild(document.createElement('br'));
        var meta = [MODE_LABEL[item.mode] || item.mode, item.subject, new Date(item.created_at).toLocaleDateString()].filter(Boolean).join(' · ');
        txt.appendChild(el('span', 'tl-m', meta));
        if (item.topic && item.topic !== item.title) { txt.appendChild(document.createElement('br')); txt.appendChild(el('span', 'tl-m', item.topic)); }
        if (item.lesson_label) { txt.appendChild(document.createElement('br')); txt.appendChild(el('span', 'tl-label', item.lesson_label)); }
        if (item.locked) { txt.appendChild(document.createElement('br')); txt.appendChild(el('span', 'tl-m', 'Pro keeps every saved lesson open')); }
        b.appendChild(ico); b.appendChild(txt);
        b.addEventListener('click', function () { openItem(item); });
        return b;
    }

    function draw() {
        if (!root) return;
        root.textContent = '';
        root.appendChild(el('h2', 'tl-h', 'Family Library'));
        root.appendChild(el('p', 'tl-sub', 'Every answer, explanation, note and story for your child, kept safe here so you can come back to it any time.'));
        if (state.failed) { root.appendChild(el('p', 'tl-err', 'The Library could not load right now. Please try again in a moment.')); return; }
        if (state.subjects.length > 1) {
            var chips = el('div', 'tl-chips'), total = state.subjects.reduce(function (n, s) { return n + s.count; }, 0);
            var mk = function (label, subj) {
                var c = el('button', 'tl-chip', label); c.type = 'button';
                c.setAttribute('aria-pressed', state.subject === subj ? 'true' : 'false');
                c.addEventListener('click', function () { state.subject = subj; load(true); });
                chips.appendChild(c);
            };
            mk('All (' + total + ')', null);
            state.subjects.forEach(function (s) { mk((s.subject || 'Other') + ' (' + s.count + ')', s.subject == null ? '' : s.subject); });
            root.appendChild(chips);
        }
        if (!state.items.length) {
            var e = el('div', 'tl-empty');
            e.appendChild(el('p', null, 'Your child’s learning will collect here.'));
            e.appendChild(el('p', 'tl-m', 'Ask for an answer, an explanation, notes or a story and it is saved automatically, ready to revisit before the next test.'));
            root.appendChild(e);
            return;
        }
        var list = el('div', 'tl-list');
        state.items.forEach(function (i) { list.appendChild(card(i)); });
        root.appendChild(list);
        if (state.next) {
            var more = el('button', 'tl-btn tl-more', 'Show more'); more.type = 'button';
            more.addEventListener('click', function () { load(false); });
            root.appendChild(more);
        }
    }

    // ---- open one item, read-only ------------------------------------------------------------------
    function viewer(title) {
        var v = el('div', 'tl-viewer'); v.setAttribute('role', 'dialog'); v.setAttribute('aria-modal', 'true'); v.setAttribute('aria-label', title);
        var bar = el('div', 'tl-bar');
        var close = el('button', 'tl-btn', 'Close'); close.type = 'button';
        close.addEventListener('click', function () { if (window.TutpListen) window.TutpListen.stop(); document.body.classList.remove('tl-printing'); v.remove(); });
        bar.appendChild(close);
        var body = el('div', 'tl-body');
        v.appendChild(bar); v.appendChild(body);
        document.body.appendChild(v);
        return { node: v, bar: bar, body: body };
    }
    function addTools(v, spoken, lang) {
        var pdf = el('button', 'tl-btn', 'Save as PDF / Print'); pdf.type = 'button';
        pdf.addEventListener('click', function () { document.body.classList.add('tl-printing'); window.print(); setTimeout(function () { document.body.classList.remove('tl-printing'); }, 500); });
        v.bar.appendChild(pdf);
        if (window.TutpListen && spoken) v.bar.appendChild(window.TutpListen.button(function () { return spoken; }, lang || 'English', { className: 'tl-btn' }));
    }
    function lockedNotice(d) {
        var v = viewer('Pro');
        var t = (d && d.upsell) || state.upsell || {};
        v.body.appendChild(el('h3', 'tl-h', 'Keep every saved lesson open'));
        v.body.appendChild(el('p', null, t.text || 'Pro keeps all of your child’s saved lessons open.'));
        if (window.TutpBilling && window.TutpBilling.canPay) {
            var b = el('button', 'tl-btn', 'See Pro'); b.type = 'button';
            b.addEventListener('click', function () { window.TutpBilling.choosePlan(state.studentId); });
            v.bar.appendChild(b);
        }
    }

    function renderQuiz(body, p) {
        if (p.explanation) body.appendChild(el('p', null, p.explanation));
        (p.quiz || []).forEach(function (q, i) {
            var box = el('div', 'tl-q');
            box.appendChild(el('p', 'tl-t', (i + 1) + '. ' + q.question));
            (q.options || []).forEach(function (o, oi) { box.appendChild(el('div', 'tl-opt' + (oi === q.correct ? ' ok' : ''), (oi === q.correct ? '✓ ' : '') + o)); });
            if (q.explanation) box.appendChild(el('p', 'tl-m', q.explanation));
            body.appendChild(box);
        });
    }
    function plainText(p) {
        if (typeof p.text === 'string') return p.text;
        if (Array.isArray(p.notes)) return p.notes.join('\n');
        return Object.keys(p).map(function (k) { return typeof p[k] === 'string' ? p[k] : ''; }).filter(Boolean).join('\n');
    }

    // The fields explain-panel.js reads without a guard.
    function hasExplainSchema(p) {
        return Array.isArray(p.traps) && Array.isArray(p.parent_questions) && !!p.check_question && Array.isArray(p.check_question.options);
    }

    function render(item) {
        var p = item.payload || {}, lang = item.language || 'English';
        if (item.mode === 'story') {
            return needScript(function () { return !!window.TutpStoryView; }, '/app/shared/story-modal.js').then(function () { if (!window.TutpStoryView.open(p, lang)) throw new Error('story'); });
        }
        var v = viewer(item.title), spoken = '';
        if (item.mode === 'answer') {
            needCss('/css/answer-explain.css');
            return needScript(function () { return window.TutpAnswer && window.TutpExplain; }, '/app/shared/answer-cards.js')
                .then(function () { return needScript(function () { return !!window.TutpExplain; }, '/app/shared/explain-panel.js'); })
                .then(function () {
                    window.TutpAnswer.render(p, { area: v.body, language: lang, studentId: state.studentId, childName: '', fromLibrary: true,
                        // Read-only: no "Explain" button here (it would start a new model call).
                        decorate: function (card) { var cta = card.querySelector('.ae-cta'); if (cta) cta.remove(); } });
                    addTools(v, null, lang);
                });
        }
        if (item.mode === 'explain' && !hasExplainSchema(p)) {
            // Explanations moved from the browser (or saved by an older build) keep only title, quick, full and
            // traps. The explain panel needs the whole schema, so these open as plain read-only text.
            v.body.appendChild(el('h3', 'tl-h', item.title));
            if (p.quick) v.body.appendChild(el('p', null, p.quick));
            if (p.full) v.body.appendChild(el('p', null, p.full));
            if (Array.isArray(p.traps) && p.traps.length) {
                v.body.appendChild(el('h4', 'tl-m', 'Exam traps'));
                var ol = el('ol'); p.traps.forEach(function (t) { ol.appendChild(el('li', null, String(t))); }); v.body.appendChild(ol);
            }
            addTools(v, [p.title, p.quick, p.full].filter(Boolean).join('. '), lang);
            return Promise.resolve();
        }
        if (item.mode === 'explain') {
            needCss('/css/answer-explain.css');
            // explain-panel.js reads window.TutpAnswer when it loads, so the answer cards come first.
            return needScript(function () { return !!window.TutpAnswer; }, '/app/shared/answer-cards.js')
                .then(function () { return needScript(function () { return !!(window.TutpExplain && window.TutpExplain.view); }, '/app/shared/explain-panel.js'); })
                .then(function () {
                var panel = el('section', 'ae-explain ae-root'); v.body.appendChild(panel);
                window.TutpExplain.view(panel, p, { q_text: item.title }, { studentId: state.studentId, language: lang, fromLibrary: true });
                addTools(v, [p.title, p.quick, p.full].filter(Boolean).join('. '), lang);
            });
        }
        if (item.mode === 'notes') {
            return needScript(function () { return !!window.TutpNotesCard; }, '/app/shared/notes-card.js').then(function () {
                v.body.appendChild(window.TutpNotesCard.render(p, { lang: lang }));
                addTools(v, null, lang);
            });
        }
        if (item.mode === 'quiz') { renderQuiz(v.body, p); spoken = ''; }
        else { v.body.appendChild(el('h3', 'tl-h', item.title)); v.body.appendChild(el('p', null, spoken = plainText(p))); }
        addTools(v, spoken, lang);
        return Promise.resolve();
    }

    function openItem(item) {
        api('/api/library/' + encodeURIComponent(item.id)).then(function (r) {
            if (r.status === 402) return r.json().then(function (d) { lockedNotice(d); });
            if (!r.ok) throw new Error('open ' + r.status);
            return r.json().then(render);
        }).catch(function () {
            // A viewer that was opened before the failure would otherwise stay behind, empty.
            Array.prototype.forEach.call(document.querySelectorAll('.tl-viewer'), function (n) { n.remove(); });
            var v = viewer('Library'); v.body.appendChild(el('p', 'tl-err', 'This item could not be opened. Please try again.'));
        });
    }

    function mount() {
        root = document.getElementById('tutpLibrary');
        if (!root) return;
        injectCss(); wire();
        var sid = studentId();
        state.studentId = sid; state.subject = null;
        importLocal(sid).then(function () { return load(true); });
    }
    // The page switches child without a reload: reload the Library when the chosen child changes.
    function watch() {
        // Compare with the child the list was loaded for, not with the id seen when this started: the
        // dashboards set the child late, and the old copy made the first click look like a switch.
        var check = function () { if (studentId() !== state.studentId) mount(); };
        document.addEventListener('visibilitychange', check);
        document.addEventListener('click', function () { setTimeout(check, 250); }, true);
    }

    window.TutpLibrary = { refresh: mount };
    // The dashboards pick the child asynchronously (tutpChildReady); mount again once it has.
    function start() {
        mount(); watch();
        if (window.tutpChildReady && typeof window.tutpChildReady.then === 'function') {
            window.tutpChildReady.then(function () { if (studentId() !== state.studentId) mount(); }, function () {});
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
}());
