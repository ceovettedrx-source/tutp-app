/* weekly-goal.js — fills the "This Week's Goal" card and the greeting line on
   the mother / father / family-member dashboards from the family's real
   session.completed count (GET /api/weekly-sessions/:familyId).

   Family-level on purpose: Play-Based Learning events carry no student_id,
   so a per-child count would silently miss them. Week = Monday-Sunday, IST
   (computed server-side). Only DOM ids are touched, so pages that lack any
   of them (or hide the card behind a permission) are unaffected. */
(function () {
  var RING_LEN = 282.7; // 2 * PI * r(45), matches the SVG in each page

  function $(id) { return document.getElementById(id); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }

  function render(count, target) {
    var pct = Math.max(0, Math.min(1, count / target));
    var bar = $('weeklyGoalBar');
    if (bar) bar.style.strokeDashoffset = String(RING_LEN * (1 - pct));
    var ring = $('weeklyGoalRing');
    if (ring) {
      ring.classList.toggle('dc-ring--done', count >= target);
      ring.setAttribute('aria-label', count + ' of ' + target + ' sessions this week');
    }
    setText('weeklyGoalCount', String(count));
    setText('weeklyGoalOf', 'of ' + target);

    var msg;
    if (count <= 0) msg = 'No sessions yet this week. Start one to get going!';
    else if (count < target) msg = plural(target - count, 'more session') + ' to reach this week’s goal.';
    else msg = 'Goal reached — a great week of learning together!';
    setText('weeklyGoalMsg', msg);

    setText('greetingGoalLine', count <= 0
      ? 'No learning sessions yet this week — a good day to start one.'
      : 'Your family has completed ' + count + ' of ' + target + ' learning sessions this week.');
  }

  function renderError() {
    setText('weeklyGoalCount', '—');
    setText('weeklyGoalOf', '');
    setText('weeklyGoalMsg', 'Couldn’t load this week’s sessions right now.');
  }

  function init() {
    if (!$('weeklyGoalBar') && !$('greetingGoalLine')) return;
    var familyId = null;
    try { familyId = sessionStorage.getItem('tutp_family_id'); } catch (e) {}
    if (!familyId) { renderError(); return; }
    fetch('/api/weekly-sessions/' + encodeURIComponent(familyId), { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('Request failed'); return res.json(); })
      .then(function (data) {
        var count = Number(data.count);
        var target = Number(data.target) || 5;
        if (!isFinite(count) || count < 0) throw new Error('Bad payload');
        render(count, target);
      })
      .catch(function (err) { console.error('[weekly-goal] Could not load weekly sessions:', err); renderError(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
