// Answer Please cards (docs/specs/answer-explain-v2.md section A). Loaded on
// demand by homework-modal.js when a reply has schema 2 (ANSWER_V2_ENABLED).
//
//   TutpAnswer.render(parsed, { area, language, studentId, childName, decorate })
//
// parsed is the server-checked reply (server/answer-schema.js). One card per
// question: marks chip, the answer as blocks (compare table / steps / text),
// exam keywords highlighted, a "Why?" toggle per formula, a Notebook toggle
// (ruled lines, also printed), listen, print, and the "Did <child>
// understand? Explain" button, which opens explain-panel.js. All text goes in
// with textContent; the only markup inserted is the diagram SVG the server
// drew, parsed and imported as an SVG element (never innerHTML).
(function () {
    'use strict';

    var BCP = { telugu: 'te-IN', devanagari: 'hi-IN', tamil: 'ta-IN', kannada: 'kn-IN', malayalam: 'ml-IN', arabic: 'ar-SA', latin: 'en-IN' };
    var NOTO = { telugu: 'Noto Sans Telugu', devanagari: 'Noto Sans Devanagari', tamil: 'Noto Sans Tamil', kannada: 'Noto Sans Kannada', malayalam: 'Noto Sans Malayalam', arabic: 'Noto Sans Arabic' };
    var loaded = {};
    var counter = 0;

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function btn(label, cls) {
        var b = el('button', 'ae-btn' + (cls ? ' ' + cls : ''), label);
        b.type = 'button';
        return b;
    }

    // Plus Jakarta Sans always; the Noto Sans font of a script only when that script is on screen.
    function ensureFonts(scripts) {
        var want = ['Plus Jakarta Sans:wght@400;600;700;800'];
        scripts.forEach(function (s) { if (NOTO[s]) want.push(NOTO[s] + ':wght@400;700'); });
        want.forEach(function (w) {
            if (loaded[w]) return;
            loaded[w] = true;
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=' + w.replace(/ /g, '+') + '&display=swap';
            document.head.appendChild(link);
        });
    }

    // text with the exam keywords wrapped in <mark class="ae-kw">
    function highlighted(parent, text, keywords) {
        var kws = (keywords || []).filter(Boolean).sort(function (a, b) { return b.length - a.length; });
        if (!kws.length) { parent.appendChild(document.createTextNode(text)); return; }
        var lower = text.toLowerCase(), i = 0;
        while (i < text.length) {
            var best = null, at = -1;
            for (var k = 0; k < kws.length; k++) {
                var p = lower.indexOf(kws[k].toLowerCase(), i);
                if (p >= 0 && (at < 0 || p < at)) { at = p; best = kws[k]; }
            }
            if (at < 0) { parent.appendChild(document.createTextNode(text.slice(i))); return; }
            if (at > i) parent.appendChild(document.createTextNode(text.slice(i, at)));
            var m = el('mark', 'ae-kw', text.slice(at, at + best.length));
            parent.appendChild(m);
            i = at + best.length;
        }
    }

    function listOf(items, kws) {
        var ul = el('ul', 'ae-list');
        items.forEach(function (t) { var li = el('li'); highlighted(li, t, kws); ul.appendChild(li); });
        return ul;
    }

    function stepsBlock(b, kws) {
        var wrap = el('div', 'ae-block');
        if (b.given && b.given.length) { wrap.appendChild(el('p', 'ae-label', 'Given')); wrap.appendChild(listOf(b.given, kws)); }
        if (b.find) { wrap.appendChild(el('p', 'ae-label', 'To find')); var f = el('p'); highlighted(f, b.find, kws); wrap.appendChild(f); }
        if (b.formula && b.formula.length) {
            wrap.appendChild(el('p', 'ae-label', 'Formula'));
            b.formula.forEach(function (f) {
                var row = el('div');
                var line = el('span');
                highlighted(line, f.text, kws);
                row.appendChild(line);
                if (f.why_text) {
                    var id = 'ae-why-' + (++counter);
                    var why = btn('Why?', 'ae-why ae-noprint');
                    why.setAttribute('aria-expanded', 'false');
                    why.setAttribute('aria-controls', id);
                    var txt = el('div', 'ae-whytext', f.why_text);
                    txt.id = id;
                    txt.hidden = true;
                    why.addEventListener('click', function () {
                        var open = txt.hidden;
                        txt.hidden = !open;
                        why.setAttribute('aria-expanded', open ? 'true' : 'false');
                    });
                    row.appendChild(why);
                    row.appendChild(txt);
                }
                wrap.appendChild(row);
            });
        }
        if (b.substitution && b.substitution.length) { wrap.appendChild(el('p', 'ae-label', 'Substitute')); wrap.appendChild(listOf(b.substitution, kws)); }
        var fin = el('div', 'ae-final');
        fin.appendChild(el('b', null, 'Answer: '));
        highlighted(fin, b.final_answer, kws);
        wrap.appendChild(fin);
        return wrap;
    }

    function tableBlock(b, kws) {
        var wrap = el('div', 'ae-block');
        var t = el('table', 'ae-table');
        var head = el('tr');
        head.appendChild(el('th', null, 'No.'));
        b.headers.forEach(function (h) { head.appendChild(el('th', null, h)); });
        var thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
        var tb = el('tbody');
        b.rows.forEach(function (r, i) {
            var tr = el('tr');
            tr.appendChild(el('td', 'ae-n', String(i + 1)));
            r.forEach(function (c) { var td = el('td'); highlighted(td, c, kws); tr.appendChild(td); });
            tb.appendChild(tr);
        });
        t.appendChild(tb);
        wrap.appendChild(t);
        return wrap;
    }

    function textBlock(b, kws) {
        var p = el('p', 'ae-block');
        highlighted(p, b.text, kws);
        return p;
    }

    // The server's own SVG, as an SVG element: parsed as XML, scripts and
    // event handlers refused, then imported.
    function diagramNode(svg) {
        try {
            var doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
            var root = doc.documentElement;
            if (!root || root.nodeName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
            if (doc.getElementsByTagName('script').length) return null;
            var all = root.getElementsByTagName('*');
            for (var i = 0; i < all.length; i++) for (var a = 0; a < all[i].attributes.length; a++) if (/^on/i.test(all[i].attributes[a].name)) return null;
            return document.importNode(root, true);
        } catch (e) { return null; }
    }

    function spokenText(q) {
        var parts = [q.q_text];
        q.blocks.forEach(function (b) {
            if (b.type === 'text') parts.push(b.text);
            else if (b.type === 'compare_table') b.rows.forEach(function (r, i) { parts.push((i + 1) + '. ' + r[0] + '. ' + r[1]); });
            else { (b.given || []).forEach(function (g) { parts.push(g); }); (b.formula || []).forEach(function (f) { parts.push(f.text); }); (b.substitution || []).forEach(function (s) { parts.push(s); }); parts.push(b.final_answer); }
        });
        return parts.join('. ');
    }

    function haveVoice(bcp, cb) {
        if (!('speechSynthesis' in window)) { cb(false); return; }
        var check = function (list) { var p = bcp.slice(0, 2); cb(list.some(function (v) { return (v.lang || '').slice(0, 2).toLowerCase() === p; })); };
        var now = window.speechSynthesis.getVoices();
        if (now && now.length) { check(now); return; }
        var done = false;
        window.speechSynthesis.onvoiceschanged = function () { if (!done) { done = true; check(window.speechSynthesis.getVoices()); } };
        setTimeout(function () { if (!done) { done = true; check(window.speechSynthesis.getVoices() || []); } }, 1500);
    }

    function card(q, index, ctx) {
        var c = el('article', 'ae-card');
        c.dataset.qi = String(index);
        var head = el('div', 'ae-head');
        head.appendChild(el('span', 'ae-qno', 'Question ' + (index + 1)));
        head.appendChild(el('span', 'ae-marks', q.marks + (q.marks === 1 ? ' mark' : ' marks')));
        c.appendChild(head);
        var qt = el('p', 'ae-qtext', q.q_text);
        qt.dataset.script = q.script || 'latin';
        c.appendChild(qt);

        var body = el('div', 'ae-body');
        body.dataset.script = q.script || 'latin';
        q.blocks.forEach(function (b) {
            body.appendChild(b.type === 'steps' ? stepsBlock(b, q.keywords) : b.type === 'compare_table' ? tableBlock(b, q.keywords) : textBlock(b, q.keywords));
        });
        c.appendChild(body);

        if (q.diagram && q.diagram.svg) {
            var node = diagramNode(q.diagram.svg);
            if (node) { var d = el('div', 'ae-diagram'); d.appendChild(node); c.appendChild(d); }
        }
        if (q.unit_direction_note) c.appendChild(el('p', 'ae-note', q.unit_direction_note));
        if (q.keywords && q.keywords.length) {
            var kr = el('div', 'ae-kwrow');
            kr.appendChild(el('span', 'ae-label', 'Words examiners look for:'));
            q.keywords.forEach(function (k) { kr.appendChild(el('span', 'ae-chip', k)); });
            c.appendChild(kr);
        }

        var tools = el('div', 'ae-tools ae-noprint');
        var nb = btn('Notebook');
        nb.setAttribute('aria-pressed', 'false');
        nb.addEventListener('click', function () {
            var on = !c.classList.contains('ae-notebook');
            c.classList.toggle('ae-notebook', on);
            nb.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        tools.appendChild(nb);
        var bcp = BCP[q.script] || 'en-IN';
        var listen = btn('Listen');
        listen.hidden = true;
        haveVoice(bcp, function (ok) { listen.hidden = !ok; });
        var speaking = false;
        listen.addEventListener('click', function () {
            if (speaking) { window.speechSynthesis.cancel(); speaking = false; listen.textContent = 'Listen'; return; }
            window.speechSynthesis.cancel();
            var u = new SpeechSynthesisUtterance(spokenText(q));
            u.lang = bcp;
            u.onend = u.onerror = function () { speaking = false; listen.textContent = 'Listen'; };
            speaking = true;
            listen.textContent = 'Stop';
            window.speechSynthesis.speak(u);
        });
        tools.appendChild(listen);
        var pr = btn('PDF / Print');
        pr.addEventListener('click', function () {
            if (typeof window.printResult !== 'function') { window.print(); return; }
            if (!c.id) c.id = 'ae-card-' + (++counter);
            window.printResult(c.id);
        });
        tools.appendChild(pr);
        c.appendChild(tools);

        var cta = el('div', 'ae-cta ae-noprint');
        cta.appendChild(el('span', null, 'Did ' + (ctx.childName || 'your child') + ' understand?'));
        var ex = btn('Explain', 'ae-btn-primary');
        ex.setAttribute('aria-expanded', 'false');
        ex.addEventListener('click', function () {
            if (!window.TutpExplain) return;
            window.TutpExplain.toggle(c, q, ex, ctx);
        });
        cta.appendChild(ex);
        c.appendChild(cta);
        if (typeof ctx.decorate === 'function') ctx.decorate(c, index);
        return c;
    }

    function post(path, body) {
        return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }

    function comingSoon(ctx) {
        var s = el('div', 'ae-soon ae-noprint');
        var t = el('div');
        t.appendChild(el('b', null, 'Coming soon: '));
        t.appendChild(document.createTextNode('check ' + (ctx.childName || 'your child') + '’s written answer.'));
        s.appendChild(t);
        var b = btn('I’d use this');
        b.addEventListener('click', function () {
            b.disabled = true;
            b.textContent = 'Thanks, noted';
            post('/api/answer-events', { event: 'answer_check_interest', studentId: ctx.studentId }).catch(function () {});
        });
        s.appendChild(b);
        return s;
    }

    function message(text) {
        var m = el('div', 'ae-msg');
        m.setAttribute('role', 'status');
        m.textContent = text;
        return m;
    }

    function render(parsed, ctx) {
        var area = ctx.area;
        area.innerHTML = '';
        area.classList.add('ae-root');
        if (parsed.status === 'unreadable') {
            area.appendChild(message('We could not read this photo clearly enough to answer it. Please take another photo in good light, with the whole page in the frame and the camera held steady.'));
            return;
        }
        if (parsed.status === 'not_homework') {
            area.appendChild(message('This does not look like a homework or exam question. Please attach a photo of the question page, or type the question.'));
            return;
        }
        var qs = parsed.questions || [];
        ctx.subject = parsed.subject || '';
        ensureFonts(qs.map(function (q) { return q.script; }).filter(Boolean));
        qs.forEach(function (q, i) { area.appendChild(card(q, i, ctx)); });
        if (parsed.more_questions) area.appendChild(message('There are ' + parsed.more_questions + ' more question(s) on this homework than shown here. Send the rest in another photo.'));
        area.appendChild(comingSoon(ctx));
    }

    window.TutpAnswer = { render: render, ensureFonts: ensureFonts, post: post, el: el, btn: btn, diagramNode: diagramNode };
})();
