/* Singapore Maths Method card on the mother / father / family-member dashboards (TUT-43,
   spec sections 5, 6 and 9). The card's words are fixed English in the HTML (the
   dashboards have no UI translation layer); this script sets the button for the
   selected child's tier and draws the progress block once a session is finished.
     start / free_left  -> "Start session" / "Start this week's free session" -> the page
     free_used          -> "Start session" (the page explains the week and Max)
     locked (Free)      -> "Unlock with Pro" (plan chooser) + "See an example" (preview)
     grade              -> a note: classes 1 to 6 for now
   The button always opens /app/singapore-maths/, never the Homework Help modal.
   Inline styles only: Tailwind's build scans HTML, not this script. */
(function () {
  var card = document.getElementById('sgmathCard');
  if (!card) return;
  var role = card.getAttribute('data-role') || 'mother';
  var btn = document.getElementById('sgmathStart');
  var extra = document.getElementById('sgmathExtra');
  var prog = document.getElementById('sgmathProgress');
  var LABELS = { not_tried: 'Not tried', learning: 'Learning', getting_there: 'Getting there', strong: 'Strong' };
  var NAMES = { part_whole: 'Part and whole', comparison: 'Comparison', before_after: 'Before and after', fraction: 'Fractions', ratio: 'Ratio' };
  var COLORS = { not_tried: '#c9d3e0', learning: '#f2b84b', getting_there: '#7fb2e5', strong: '#1e7b4a' };

  function pageUrl(studentId) {
    return '/app/singapore-maths/?from=' + encodeURIComponent(role) + '&studentId=' + encodeURIComponent(studentId);
  }
  function json(url) {
    return fetch(url, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function el(tag, style, text) {
    var n = document.createElement(tag);
    if (style) n.style.cssText = style;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function drawProgress(studentId) {
    json('/api/sgmath/progress?studentId=' + encodeURIComponent(studentId)).then(function (d) {
      if (!d || !d.hasProgress) { prog.hidden = true; return; }
      prog.replaceChildren();
      prog.appendChild(el('p', 'margin:12px 0 6px;font-weight:700;font-size:14px;', 'Singapore Maths progress'));
      (d.rows || []).forEach(function (r) {
        var row = el('div', 'display:flex;align-items:center;gap:8px;margin:4px 0;font-size:13px;');
        row.appendChild(el('span', 'width:9px;height:9px;border-radius:50%;flex:none;background:' + (COLORS[r.label] || '#c9d3e0') + ';'));
        row.appendChild(el('span', 'flex:1;', NAMES[r.type] || r.type));
        row.appendChild(el('span', 'color:#5b6678;', LABELS[r.label] || r.label));
        prog.appendChild(row);
      });
      var pts = (d.weekly || []).map(function (w, i) { return { x: 10 + i * 40, y: w.value === null ? null : 50 - (w.value / 100) * 40 }; });
      if (pts.some(function (p) { return p.y !== null; })) {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 300 60');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Weekly growth over the last 8 weeks');
        svg.style.cssText = 'width:100%;height:auto;margin-top:6px;';
        var d2 = '', open = false;
        pts.forEach(function (p) {
          if (p.y === null) { open = false; return; }                // a week with no practice is a gap
          d2 += (open ? 'L' : 'M') + p.x + ',' + p.y + ' ';
          open = true;
          var c = document.createElementNS(ns, 'circle');
          c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', 3); c.setAttribute('fill', '#005bbf');
          svg.appendChild(c);
        });
        var path = document.createElementNS(ns, 'path');
        path.setAttribute('d', d2.trim()); path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#005bbf'); path.setAttribute('stroke-width', '2');
        svg.insertBefore(path, svg.firstChild);
        prog.appendChild(el('p', 'margin:10px 0 0;font-size:12px;color:#5b6678;', 'Weekly growth'));
        prog.appendChild(svg);
      }
      prog.hidden = false;
    });
  }

  function apply(studentId) {
    if (!studentId) return;
    btn.href = pageUrl(studentId);
    btn.textContent = 'Start session';
    btn.onclick = null;
    extra.replaceChildren();
    json('/api/sgmath/card?studentId=' + encodeURIComponent(studentId)).then(function (c) {
      if (!c) return;                                   // not set up yet: the plain link still works
      card.setAttribute('data-state', c.state);
      if (c.state === 'free_left') btn.textContent = "Start this week's free session";
      if (c.state === 'grade') extra.appendChild(el('p', 'margin:8px 0 0;font-size:13px;color:#5b6678;', 'For classes 1 to 6 for now.'));
      if (c.state === 'locked') {
        btn.textContent = 'Unlock with Pro';
        btn.onclick = function (e) {
          fetch('/api/sgmath/upgrade-click', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: studentId, source: 'card' }) }).catch(function () {});
          if (window.TutpBilling && window.TutpBilling.canPay) { e.preventDefault(); window.TutpBilling.choosePlan(studentId); }
        };
        var ex = el('a', 'display:inline-flex;align-items:center;min-height:44px;margin-left:12px;font-size:14px;font-weight:600;color:#005bbf;', 'See an example');
        ex.href = pageUrl(studentId);
        ex.id = 'sgmathExample';
        extra.appendChild(ex);
      }
      if (c.hasProgress) drawProgress(studentId); else prog.hidden = true;
    });
  }

  var ready = window.tutpChildReady && typeof window.tutpChildReady.then === 'function' ? window.tutpChildReady : Promise.resolve(null);
  ready.then(function (id) {
    var sid = id;
    try { sid = sid || sessionStorage.getItem('tutp_student_id'); } catch (e) { /* private mode */ }
    apply(sid);
  });
  // The dashboards switch child in place; follow it.
  window.addEventListener('storage', function () { try { apply(sessionStorage.getItem('tutp_student_id')); } catch (e) { /* ignore */ } });
  window.TutpSgmathCard = { refresh: function () { try { apply(sessionStorage.getItem('tutp_student_id')); } catch (e) { /* ignore */ } } };
})();
