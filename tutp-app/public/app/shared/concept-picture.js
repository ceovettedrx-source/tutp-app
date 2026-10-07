// One picture per concept, on every surface that explains a concept to a child
// (docs/specs/img1.md section D): Explain, Notes, Story, Answer cards and the
// Experiential Learning lessons all call this one component.
//
//   TutpPicture.mount(host, picture, { studentId, surface }, { labels, fallback, variant, alt })
//
// picture is what the server put in the reply:
//   { concept_key, scene_prompt, sig }   asks POST /api/illustration/request first, then polls
//   { concept_key, status }              Explain: the server already asked, just poll
// The figure shows a shimmer while the picture is made, then the picture; if the
// server cannot make one (no key, daily cap, error) it shows `fallback` (the SVG
// the answer already drew) or nothing at all. A free family sees one picture a
// day in full; the rest arrive from the server as a tiny preview, which is shown
// blurred with "See every picture in Pro" (picture_upsell_view / picture_upsell_click
// are logged). The picture itself never carries text: labels are an HTML overlay.
// Everything goes in with textContent and DOM calls, never innerHTML.
(function () {
    'use strict';

    var POS = {
        'top-left': [18, 16], 'top': [50, 14], 'top-right': [82, 16], 'left': [16, 50], 'center': [50, 50], 'right': [84, 50],
        'bottom-left': [18, 84], 'bottom': [50, 86], 'bottom-right': [82, 84]
    };
    var POLL_MS = 2000, POLL_MAX = 40;

    var STYLE = '' +
        '.tp-pic{position:relative;border-radius:12px;overflow:hidden;background:#EAF2FC;margin:10px 0;font-family:"Plus Jakarta Sans","Noto Sans",system-ui,sans-serif}' +
        '.tp-pic[data-variant="hero"]{aspect-ratio:16/9}' +
        '.tp-pic[data-variant="small"]{aspect-ratio:16/9;max-width:320px}' +
        '.tp-pic img,.tp-pic .tp-pic-fallback{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
        '.tp-pic .tp-pic-fallback{display:flex;align-items:center;justify-content:center;padding:8px}' +
        '.tp-pic .tp-pic-fallback svg{max-height:100%;width:auto}' +
        '.tp-pic[data-state="ready"] .tp-pic-fallback,.tp-pic[data-state="blurred"] .tp-pic-fallback{display:none}' +
        '.tp-pic-shimmer{position:absolute;inset:0;background:linear-gradient(100deg,rgba(255,255,255,0) 30%,rgba(255,255,255,.7) 50%,rgba(255,255,255,0) 70%);background-size:200% 100%;animation:tp-shimmer 1.4s linear infinite}' +
        '@keyframes tp-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}' +
        '@media (prefers-reduced-motion:reduce){.tp-pic-shimmer{animation:none}}' +
        '.tp-pic-label{position:absolute;background:#fff;color:#0F1B2D;border:1px solid #005bbf;border-radius:999px;padding:4px 12px;font-size:13px;font-weight:700;max-width:45%;transform:translate(-50%,-50%);text-align:center}' +
        '.tp-pic-tag{position:absolute;right:6px;bottom:6px;background:rgba(15,27,45,.72);color:#fff;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600}' +
        '.tp-pic[data-state="blurred"] img{filter:blur(16px);transform:scale(1.25)}' +
        '.tp-pic-upsell{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:12px;text-align:center;background:rgba(255,255,255,.55)}' +
        '.tp-pic-upsell b{color:#0F1B2D;font-size:15px}' +
        '.tp-pic-upsell span{color:#0F1B2D;font-size:12.5px;max-width:30em}' +
        '.tp-pic-upsell button{min-height:44px;min-width:44px;padding:0 16px;border-radius:10px;border:2px solid #005bbf;background:#005bbf;color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer}' +
        '.tp-pic-upsell button:focus-visible{outline:3px solid #0F1B2D;outline-offset:2px}' +
        '@media print{.tp-pic[data-state="blurred"],.tp-pic[data-state="loading"],.tp-pic-shimmer{display:none!important}.tp-pic{break-inside:avoid}.tp-pic-label{background:#fff!important}}';

    function injectStyle() {
        if (document.getElementById('tpPicStyle')) return;
        var s = document.createElement('style');
        s.id = 'tpPicStyle';
        s.textContent = STYLE;
        document.head.appendChild(s);
    }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function post(path, body) {
        return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    }

    function mount(host, picture, ctx, opts) {
        opts = opts || {};
        ctx = ctx || {};
        injectStyle();
        var fig = el('figure');
        fig.className = 'tp-pic';
        fig.style.margin = '10px 0';
        fig.dataset.variant = opts.variant === 'small' ? 'small' : 'hero';
        fig.dataset.state = 'loading';
        fig.dataset.surface = ctx.surface || '';
        var fb = el('div', 'tp-pic-fallback');
        if (opts.fallback) fb.appendChild(opts.fallback);
        fig.appendChild(fb);
        var shimmer = el('div', 'tp-pic-shimmer');
        shimmer.setAttribute('aria-hidden', 'true');
        fig.appendChild(shimmer);
        (opts.labels || []).forEach(function (l) {
            var p = POS[l.position] || POS.center;
            var chip = el('span', 'tp-pic-label', l.text);
            chip.style.left = p[0] + '%';
            chip.style.top = p[1] + '%';
            fig.appendChild(chip);
        });
        host.appendChild(fig);

        var key = picture && picture.concept_key;
        var done = false;

        // No picture and nothing to show instead: the figure is removed, the page stays clean.
        function giveUp() {
            done = true;
            shimmer.remove();
            if (opts.fallback) { fig.dataset.state = 'fallback'; return; }
            fig.remove();
        }

        function showFull(url) {
            var img = el('img');
            img.alt = opts.alt || '';
            img.onload = function () {
                done = true;
                fig.dataset.state = 'ready';
                shimmer.remove();
                fig.appendChild(el('span', 'tp-pic-tag', 'AI-made illustration'));
                fig.dispatchEvent(new CustomEvent('tp-picture-ready', { bubbles: true }));
            };
            img.onerror = giveUp;
            img.src = url;
            fig.insertBefore(img, fb);
        }

        function showBlurred(st) {
            done = true;
            shimmer.remove();
            fig.dataset.state = 'blurred';
            if (st.thumb) {
                var img = el('img');
                img.alt = '';
                img.setAttribute('aria-hidden', 'true');
                img.src = st.thumb;
                fig.insertBefore(img, fb);
            }
            var up = el('div', 'tp-pic-upsell tp-noprint ae-noprint');
            up.appendChild(el('b', null, (st.upsell && st.upsell.label) || 'See every picture in Pro'));
            if (st.upsell && st.upsell.text) up.appendChild(el('span', null, st.upsell.text));
            if (window.TutpBilling && window.TutpBilling.canPay) {
                var b = el('button', null, 'See Pro');
                b.type = 'button';
                b.addEventListener('click', function () {
                    post('/api/answer-events', { event: 'picture_upsell_click', studentId: ctx.studentId, surface: ctx.surface }).catch(function () {});
                    window.TutpBilling.choosePlan(ctx.studentId || '');
                });
                up.appendChild(b);
            }
            fig.appendChild(up);
            post('/api/answer-events', { event: 'picture_upsell_view', studentId: ctx.studentId, surface: ctx.surface }).catch(function () {});
        }

        function poll(n) {
            if (n >= POLL_MAX) { giveUp(); return; }
            setTimeout(function () {
                // the card may have been replaced while we waited
                if (!fig.isConnected) return;
                fetch('/api/illustration/' + encodeURIComponent(key) + '?studentId=' + encodeURIComponent(ctx.studentId || ''), { credentials: 'same-origin' })
                    .then(function (r) { return r.ok ? r.json() : { status: 'fallback' }; })
                    .then(function (s) {
                        if (!fig.isConnected) return;
                        if (s.status === 'ready' && s.blurred) showBlurred(s);
                        else if (s.status === 'ready' && s.url) showFull(s.url);
                        else if (s.status === 'pending') poll(n + 1);
                        else giveUp();
                    })
                    .catch(giveUp);
            }, n === 0 ? 400 : POLL_MS);
        }

        function start() {
            if (!key) { giveUp(); return; }
            if (picture.sig) {
                post('/api/illustration/request', { studentId: ctx.studentId, picture: { concept_key: picture.concept_key, scene_prompt: picture.scene_prompt, sig: picture.sig } })
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (j) {
                        if (!j || j.status === 'fallback') { giveUp(); return; }
                        key = j.concept_key || key;
                        poll(0);
                    })
                    .catch(giveUp);
            } else if (picture.status === 'fallback') {
                giveUp();
            } else {
                poll(0);
            }
        }
        start();
        return fig;
    }

    window.TutpPicture = { mount: mount };
})();
