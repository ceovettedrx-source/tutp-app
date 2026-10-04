// Explain Please panel (docs/specs/answer-explain-v2.md section B). Opened
// from an answer card's "Explain" button; asks POST /api/explain-please only
// then. The server decides what this family may see (free: title and the 30
// second layer; Pro: everything), so a free reply simply has no other fields.
//
//   TutpExplain.toggle(cardEl, question, buttonEl, ctx)
//
// Pro layout: hero picture with HTML label chips on top (the picture itself
// never has text), layer tabs (30 sec / Full / Exam traps), misconception
// box (the "Tut-P Knowledge Graph" source line only when source is "kg"),
// previous/next tiles, the dark "tonight, 2 minutes" card with "I asked", a
// one-question check, Save to notes, PDF. The picture is polled from
// GET /api/illustration/:key; until it is ready (or when it falls back) the
// diagram the answer already drew is shown, and print uses that too.
(function () {
    'use strict';

    var A = window.TutpAnswer;
    var el = A.el, btn = A.btn;
    var POS = {
        'top-left': [18, 16], 'top': [50, 14], 'top-right': [82, 16], 'left': [16, 50], 'center': [50, 50], 'right': [84, 50],
        'bottom-left': [18, 84], 'bottom': [50, 86], 'bottom-right': [82, 84]
    };
    var POLL_MS = 2000, POLL_MAX = 30;
    var uid = 0;

    function api(path, body) {
        return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }

    function hero(view, q, ctx) {
        var box = el('div', 'ae-hero');
        box.dataset.ready = '0';
        var svgWrap = el('div', 'ae-hero-svg');
        if (q.diagram && q.diagram.svg) {
            var n = A.diagramNode(q.diagram.svg);
            if (n) svgWrap.appendChild(n);
        }
        box.appendChild(svgWrap);
        var shimmer = el('div', 'ae-shimmer');
        shimmer.setAttribute('aria-hidden', 'true');
        box.appendChild(shimmer);
        (view.illustration.labels || []).forEach(function (l) {
            var p = POS[l.position] || POS.center;
            var chip = el('span', 'ae-hero-label', l.text);
            chip.style.left = p[0] + '%';
            chip.style.top = p[1] + '%';
            box.appendChild(chip);
        });
        function showImage(url) {
            var img = el('img');
            img.alt = '';
            img.onload = function () { box.dataset.ready = '1'; shimmer.remove(); };
            img.onerror = function () { shimmer.remove(); };
            img.src = url;
            box.insertBefore(img, svgWrap);
        }
        var st = view.illustration;
        if (st.status === 'ready' && st.url) showImage(st.url);
        else if (st.status === 'fallback') shimmer.remove();
        else poll(0);
        function poll(n) {
            if (n >= POLL_MAX) { shimmer.remove(); return; }
            setTimeout(function () {
                // the panel may have been replaced (a new result) while we waited
                if (!box.isConnected) return;
                fetch('/api/illustration/' + encodeURIComponent(view.concept_key) + '?studentId=' + encodeURIComponent(ctx.studentId), { credentials: 'same-origin' })
                    .then(function (r) { return r.ok ? r.json() : { status: 'fallback' }; })
                    .then(function (s) {
                        if (s.status === 'ready' && s.url) showImage(s.url);
                        else if (s.status === 'pending') poll(n + 1);
                        else shimmer.remove();
                    })
                    .catch(function () { shimmer.remove(); });
            }, POLL_MS);
        }
        return box;
    }

    function tabs(view) {
        var wrap = el('div');
        var list = el('div', 'ae-tabs ae-noprint');
        list.setAttribute('role', 'tablist');
        var defs = [{ id: 'quick', label: '30 sec' }];
        if (!view.locked) { defs.push({ id: 'full', label: 'Full' }); defs.push({ id: 'traps', label: 'Exam traps' }); }
        var panels = {}, tabEls = {}, base = 'ae-t' + (++uid) + '-';
        function select(id) {
            defs.forEach(function (d) {
                var on = d.id === id;
                tabEls[d.id].setAttribute('aria-selected', on ? 'true' : 'false');
                tabEls[d.id].tabIndex = on ? 0 : -1;
                panels[d.id].hidden = !on;
            });
        }
        defs.forEach(function (d, i) {
            var t = el('button', 'ae-tab', d.label);
            t.type = 'button';
            t.setAttribute('role', 'tab');
            t.id = base + 'tab-' + d.id;
            t.setAttribute('aria-controls', base + d.id);
            t.addEventListener('click', function () { select(d.id); });
            t.addEventListener('keydown', function (e) {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                var j = (i + (e.key === 'ArrowRight' ? 1 : defs.length - 1)) % defs.length;
                select(defs[j].id);
                tabEls[defs[j].id].focus();
            });
            tabEls[d.id] = t;
            list.appendChild(t);
            var p = el('div', 'ae-panel');
            p.setAttribute('role', 'tabpanel');
            p.id = base + d.id;
            p.setAttribute('aria-labelledby', t.id);
            panels[d.id] = p;
        });
        panels.quick.appendChild(el('p', null, view.quick));
        if (!view.locked) {
            panels.full.appendChild(el('p', null, view.full));
            var ol = el('ol');
            ol.style.margin = '0'; ol.style.paddingLeft = '20px';
            view.traps.forEach(function (t) { var li = el('li', null, t); li.style.marginBottom = '6px'; ol.appendChild(li); });
            panels.traps.appendChild(ol);
        }
        wrap.appendChild(list);
        defs.forEach(function (d) { wrap.appendChild(panels[d.id]); });
        select('quick');
        return wrap;
    }

    function misconception(view) {
        var m = view.misconception;
        if (!m || !m.text) return null;
        var box = el('div', 'ae-miscon');
        box.appendChild(el('h4', null, 'A common mix-up'));
        box.appendChild(el('p', null, m.text));
        // Honest label: only a knowledge graph record is called one.
        if (m.source === 'kg') box.appendChild(el('div', 'ae-source', 'Source: Tut-P Knowledge Graph'));
        return box;
    }

    function tiles(view) {
        if (!view.prev_link && !view.next_link) return null;
        var g = el('div', 'ae-tiles');
        [['Before this', view.prev_link], ['Next', view.next_link]].forEach(function (x) {
            if (!x[1]) return;
            var t = el('div', 'ae-tile');
            t.appendChild(el('small', null, x[0]));
            t.appendChild(document.createTextNode(x[1].title));
            g.appendChild(t);
        });
        return g;
    }

    function tonight(view, ctx) {
        var c = el('div', 'ae-tonight');
        c.appendChild(el('h4', null, 'Tonight, 2 minutes'));
        var ol = el('ol');
        view.parent_questions.forEach(function (p) {
            var li = el('li', null, p.q);
            if (p.expected_answer_hint) li.appendChild(el('span', 'ae-hint', 'Good answer: ' + p.expected_answer_hint));
            ol.appendChild(li);
        });
        c.appendChild(ol);
        var b = btn('I asked', 'ae-noprint');
        b.addEventListener('click', function () {
            b.disabled = true;
            b.textContent = 'Noted, well done';
            api('/api/answer-events', { event: 'parent_asked', studentId: ctx.studentId, concept_key: view.concept_key }).catch(function () {});
        });
        c.appendChild(b);
        return c;
    }

    function checkBox(view, ctx) {
        var cq = view.check_question;
        var box = el('div', 'ae-check');
        box.appendChild(el('p', 'ae-label', 'One-question check'));
        box.appendChild(el('p', null, cq.q));
        var fb = el('div', 'ae-feedback');
        fb.setAttribute('role', 'status');
        var opts = [];
        cq.options.forEach(function (o, i) {
            var b = btn(o, 'ae-opt');
            b.addEventListener('click', function () {
                var ok = i === cq.correct_index;
                opts.forEach(function (x, j) {
                    x.disabled = true;
                    if (j === cq.correct_index) x.dataset.state = 'right';
                    else if (j === i) x.dataset.state = 'wrong';
                });
                fb.dataset.ok = ok ? '1' : '0';
                fb.textContent = ok ? cq.right_feedback : cq.wrong_feedback;
                api('/api/answer-events', { event: 'explain_check', studentId: ctx.studentId, concept_key: view.concept_key, correct: ok }).catch(function () {});
            });
            opts.push(b);
            box.appendChild(b);
        });
        box.appendChild(fb);
        return box;
    }

    // "Save to notes": kept on this device (no server notes store exists).
    function saveToNotes(view, ctx) {
        var key = 'tutp_saved_explanations_' + (ctx.studentId || 'x');
        var list = [];
        try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { list = []; }
        list = list.filter(function (x) { return x.concept_key !== view.concept_key; });
        list.unshift({ concept_key: view.concept_key, title: view.title, quick: view.quick, full: view.full || null, traps: view.traps || null, saved_at: Date.now() });
        try { localStorage.setItem(key, JSON.stringify(list.slice(0, 50))); return true; } catch (e) { return false; }
    }

    function upsell(view) {
        var u = el('div', 'ae-upsell ae-noprint');
        var h = el('p');
        h.appendChild(el('b', null, view.upsell.label));
        u.appendChild(h);
        u.appendChild(el('p', null, view.upsell.text));
        if (window.TutpBilling && window.TutpBilling.canPay) {
            var b = btn('See Pro', 'ae-btn-primary');
            b.addEventListener('click', function () { window.TutpBilling.choosePlan(window.TutpAnswerStudentId || ''); });
            u.appendChild(b);
        }
        return u;
    }

    function build(panel, view, q, ctx) {
        panel.innerHTML = '';
        panel.appendChild(el('h3', null, view.title));
        panel.dataset.script = q.script || 'latin';
        if (!view.locked) panel.appendChild(hero(view, q, ctx));
        panel.appendChild(tabs(view));
        if (view.locked) { panel.appendChild(upsell(view)); return; }
        var m = misconception(view); if (m) panel.appendChild(m);
        var t = tiles(view); if (t) panel.appendChild(t);
        panel.appendChild(tonight(view, ctx));
        panel.appendChild(checkBox(view, ctx));
        var bar = el('div', 'ae-tools ae-noprint');
        var save = btn('Save to notes');
        save.addEventListener('click', function () {
            var ok = saveToNotes(view, ctx);
            save.textContent = ok ? 'Saved on this device' : 'Could not save';
            save.disabled = ok;
        });
        bar.appendChild(save);
        var pr = btn('PDF / Print');
        pr.addEventListener('click', function () {
            if (typeof window.printResult !== 'function') { window.print(); return; }
            if (!panel.id) panel.id = 'ae-explain-' + (++uid);
            window.printResult(panel.id);
        });
        bar.appendChild(pr);
        panel.appendChild(bar);
    }

    function load(panel, q, ctx) {
        panel.innerHTML = '';
        var l = el('div', 'ae-loading', 'Preparing the explanation…');
        l.setAttribute('role', 'status');
        panel.appendChild(l);
        window.TutpAnswerStudentId = ctx.studentId;
        api('/api/explain-please', {
            studentId: ctx.studentId, question: q.q_text, qType: q.q_type, subject: ctx.subject || '',
            language: ctx.language, concept_key: q.concept_key || undefined, concept_sig: q.concept_sig || undefined
        }).then(function (r) {
            if (!r.ok) return r.json().catch(function () { return {}; }).then(function (e) { throw new Error(e.error || ('Server returned ' + r.status)); });
            return r.json();
        }).then(function (view) {
            build(panel, view, q, ctx);
        }).catch(function (err) {
            panel.innerHTML = '';
            panel.appendChild(el('p', 'ae-err', (err && err.message) || 'Could not prepare the explanation right now.'));
            var retry = btn('Try again');
            retry.addEventListener('click', function () { load(panel, q, ctx); });
            panel.appendChild(retry);
        });
    }

    function toggle(cardEl, q, buttonEl, ctx) {
        var existing = cardEl.querySelector('.ae-explain');
        if (existing) {
            var open = existing.hidden;
            existing.hidden = !open;
            buttonEl.setAttribute('aria-expanded', open ? 'true' : 'false');
            return;
        }
        var panel = el('section', 'ae-explain');
        panel.setAttribute('aria-live', 'polite');
        cardEl.appendChild(panel);
        buttonEl.setAttribute('aria-expanded', 'true');
        load(panel, q, ctx);
    }

    window.TutpExplain = { toggle: toggle };
})();
