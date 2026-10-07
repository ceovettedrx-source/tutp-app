// Explain Please (docs/specs/answer-explain-v2.md section B, img1 changes).
//
// Two ways to show it, one builder:
//   TutpExplain.explainAll(area, parsed, ctx)    "Explain please" mode: EVERY question or idea of
//                                                the photo gets its full explanation straight away,
//                                                all requested in parallel, each one shown as soon as
//                                                it arrives. No Explain tap.
//   TutpExplain.toggle(cardEl, question, buttonEl, ctx)   the older one-card panel opened from an
//                                                answer card, used only when the mode chips are not
//                                                on the page.
// Both ask POST /api/explain-please. The server decides what this family may see
// (free: title, the 30 second layer and the picture; Pro: everything), so a free
// reply simply has no other fields.
//
// Pro layout (stacked in Explain please mode, tabs in the one-card panel): the
// picture (shared component, public/app/shared/concept-picture.js, labels on top as
// HTML), the 30 second / full / exam traps layers, the misconception box (the "Tut-P
// Knowledge Graph" source line only when source is "kg"), previous/next tiles, the
// dark "tonight, 2 minutes" parent card with "I asked", a one-question check, Save
// to notes, PDF. Until the picture is ready (or when there is none) the diagram the
// answer already drew is shown, and print uses that too.
(function () {
    'use strict';

    var A = window.TutpAnswer;
    var el = A.el, btn = A.btn;
    var uid = 0;

    function api(path, body) {
        return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }

    function hero(view, q, ctx) {
        if (!window.TutpPicture || !view.illustration) return null;
        var host = el('div', 'ae-hero-host');
        var fallback = q.diagram && q.diagram.svg ? A.diagramNode(q.diagram.svg) : null;
        window.TutpPicture.mount(host, { concept_key: view.concept_key, status: view.illustration.status },
            { studentId: ctx.studentId, surface: 'explain' },
            { labels: view.illustration.labels || [], fallback: fallback, variant: 'hero', alt: view.title });
        return host;
    }

    // The three layers as tabs (one-card panel) or stacked (Explain please mode).
    function layers(view, stacked) {
        var wrap = el('div');
        var trapsList = null;
        if (!view.locked) {
            trapsList = el('ol');
            trapsList.style.margin = '0'; trapsList.style.paddingLeft = '20px';
            view.traps.forEach(function (t) { var li = el('li', null, t); li.style.marginBottom = '6px'; trapsList.appendChild(li); });
        }
        if (stacked) {
            var sec = function (title, node) {
                var s = el('section', 'ae-layer');
                s.appendChild(el('h4', 'ae-layer-h', title));
                s.appendChild(node);
                wrap.appendChild(s);
            };
            sec('In 30 seconds', el('p', null, view.quick));
            if (!view.locked) {
                sec('The full explanation', el('p', null, view.full));
                sec('Exam traps', trapsList);
            }
            return wrap;
        }
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
            panels.traps.appendChild(trapsList);
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
        panel.dataset.locked = view.locked ? '1' : '0';
        var h = hero(view, q, ctx);
        if (h) panel.appendChild(h);
        panel.appendChild(layers(view, ctx.layout === 'stacked'));
        if (view.locked) {
            // In Explain please mode one upsell closes the whole list, not one per question.
            if (!ctx.sharedUpsell) panel.appendChild(upsell(view));
            if (typeof ctx.onLocked === 'function') ctx.onLocked(view);
            return;
        }
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
        return api('/api/explain-please', {
            studentId: ctx.studentId, question: q.context || q.q_text, qType: q.q_type, subject: ctx.subject || '',
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

    // Explain please mode: one card per question or idea, each with its full explanation,
    // every one requested at once and filled in as it arrives.
    function explainAll(area, parsed, ctx) {
        area.innerHTML = '';
        area.classList.add('ae-root');
        var qs = parsed.questions || [];
        var content = parsed.mode === 'content';
        var c = {
            studentId: ctx.studentId, language: ctx.language, subject: parsed.subject || '', layout: 'stacked', sharedUpsell: true,
            onLocked: function (view) { lockedView = lockedView || view; showUpsell(); }
        };
        var lockedView = null, upsellEl = null;
        function showUpsell() {
            if (upsellEl || !lockedView) return;
            upsellEl = upsell(lockedView);
            upsellEl.dataset.role = 'explain-upsell';
            area.appendChild(upsellEl);
        }
        qs.forEach(function (q, i) {
            var card = el('article', 'ae-card ae-explain-card');
            card.dataset.qi = String(i);
            var head = el('div', 'ae-head');
            head.appendChild(el('span', 'ae-qno', (content ? 'Idea ' : 'Question ') + (i + 1)));
            card.appendChild(head);
            var qt = el('p', 'ae-qtext', q.q_text);
            qt.dataset.script = q.script || 'latin';
            card.appendChild(qt);
            var panel = el('section', 'ae-explain');
            panel.setAttribute('aria-live', 'polite');
            card.appendChild(panel);
            area.appendChild(card);
            load(panel, q, c);
        });
        if (parsed.more_questions) {
            var m = el('div', 'ae-msg', 'There are ' + parsed.more_questions + ' more question(s) on this homework than shown here. Send the rest in another photo.');
            m.setAttribute('role', 'status');
            area.appendChild(m);
        }
    }

    window.TutpExplain = { toggle: toggle, explainAll: explainAll };
})();
