/* exam-prep.js — exam prep on the mother / father dashboards (round 4,
   docs/specs/round-4-exam-prep-pilot.md).

   - #examPrepCard: "Exam prep" for the selected child. Class 5 in Andhra
     Pradesh or Telangana (state board): opens the chapter page. Anyone else:
     "coming soon". The server decides (GET /api/exam-prep/:studentId).
   - The chapter page is an overlay: Revision notes (free), Key points,
     Flashcards, Practice questions, Mind map (the exam prep pack, open with
     the child's Pro period), in English or Telugu. A note that isn't
     approved yet shows "coming soon", never an error.
   - "Hand to child": the same page full screen, larger, without the parent
     controls, until Exit.
   - Time on the page (visible time only, at most 30 minutes per open) and
     flashcards / questions answered go to POST /api/exam-prep/event and
     fill #examPrepWeekCard ("Exam prep this week", per child).

   Needs /app/shared/exam-prep-render.js and /css/exam-prep.css. Uses
   window.tutpChildReady and window.TutpBilling from the page. */
(function () {
  var R = window.TutpExamPrepRender;
  var MODES = [
    { mode: 'revision_notes', label: 'Revision notes' },
    { mode: 'key_points', label: 'Key points' },
    { mode: 'flashcards', label: 'Flashcards' },
    { mode: 'practice_questions', label: 'Practice questions' },
    { mode: 'mind_map', label: 'Mind map' },
  ];
  var LANG_KEY = 'tutp_exam_prep_lang';
  var state = { studentId: null, overview: null, mode: 'revision_notes', lang: 'en', openId: null, visibleMs: 0, visibleSince: null, beat: null };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { return R.el(tag, cls, text); }
  function icon(name) { return el('span', 'material-symbols-outlined', name); }
  function canPay() { return !!(window.TutpBilling && window.TutpBilling.canPay); }
  function familyId() { try { return sessionStorage.getItem('tutp_family_id'); } catch (e) { return null; } }

  function defaultLang() {
    try { var v = localStorage.getItem(LANG_KEY); if (v === 'en' || v === 'te') return v; } catch (e) {}
    var hw = $('hwModalLang');
    return hw && hw.value === 'Telugu' ? 'te' : 'en';
  }

  // ---------------------------------------------------------------- events

  function newOpenId() {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function seconds() {
    var ms = state.visibleMs + (state.visibleSince ? Date.now() - state.visibleSince : 0);
    return Math.min(1800, Math.round(ms / 1000));
  }
  function send(type, extra, beacon) {
    if (!state.openId || !state.studentId) return;
    var body = JSON.stringify(Object.assign({ studentId: state.studentId, type: type, openId: state.openId, mode: state.mode }, extra || {}));
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/exam-prep/event', new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/api/exam-prep/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
  }
  function reportTime(beacon) { send('closed', { seconds: seconds() }, beacon); }
  function onVisibility() {
    if (!state.openId) return;
    if (document.hidden) {
      if (state.visibleSince) { state.visibleMs += Date.now() - state.visibleSince; state.visibleSince = null; }
      reportTime(true);
    } else if (!state.visibleSince) {
      state.visibleSince = Date.now();
    }
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', function () { if (state.openId) reportTime(true); });

  // ---------------------------------------------------------------- page

  var overlay, sheet, body, tabs, langBtns = {};

  function build() {
    overlay = el('div', 'ep-overlay');
    overlay.id = 'examPrepOverlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    sheet = el('div', 'ep-sheet');
    var head = el('div', 'ep-head');
    var row = el('div', 'ep-head__row');
    var titles = el('div', 'ep-head__title');
    var title = el('h2', 'ep-title');
    title.id = 'examPrepTitle';
    var sub = el('p', 'ep-sub');
    sub.id = 'examPrepSub';
    titles.appendChild(title);
    titles.appendChild(sub);
    var close = el('button', 'ep-icon-btn ep-parent-only');
    close.type = 'button';
    close.id = 'examPrepClose';
    close.setAttribute('aria-label', 'Close exam prep');
    close.appendChild(icon('close'));
    close.addEventListener('click', closePage);
    var exit = el('button', 'dc-btn dc-btn--outline ep-child-exit', 'Exit');
    exit.type = 'button';
    exit.id = 'examPrepChildExit';
    exit.addEventListener('click', exitChildMode);
    row.appendChild(titles);
    row.appendChild(exit);
    row.appendChild(close);
    head.appendChild(row);

    var tools = el('div', 'ep-tools');
    var lang = el('div', 'ep-lang');
    lang.setAttribute('role', 'group');
    lang.setAttribute('aria-label', 'Language');
    [['en', 'English'], ['te', 'తెలుగు']].forEach(function (l) {
      var b = el('button', null, l[1]);
      b.type = 'button';
      b.setAttribute('data-lang', l[0]);
      b.addEventListener('click', function () { setLang(l[0]); });
      langBtns[l[0]] = b;
      lang.appendChild(b);
    });
    var hand = el('button', 'dc-btn dc-btn--blue ep-hand ep-parent-only');
    hand.type = 'button';
    hand.id = 'examPrepHandToChild';
    hand.appendChild(icon('child_care'));
    hand.appendChild(document.createTextNode(' Hand to child'));
    hand.addEventListener('click', enterChildMode);
    tools.appendChild(lang);
    tools.appendChild(hand);
    head.appendChild(tools);

    tabs = el('div', 'ep-tabs');
    tabs.setAttribute('role', 'tablist');
    head.appendChild(tabs);
    body = el('div', 'ep-body');
    body.id = 'examPrepBody';
    sheet.appendChild(head);
    sheet.appendChild(body);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !overlay.classList.contains('ep-child')) closePage(); });
  }

  function drawTabs() {
    tabs.replaceChildren();
    var byMode = {};
    (state.overview.modes || []).forEach(function (m) { byMode[m.mode] = m; });
    MODES.forEach(function (m) {
      var info = byMode[m.mode] || {};
      var t = el('button', 'ep-tab');
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.setAttribute('data-mode', m.mode);
      t.setAttribute('aria-selected', String(state.mode === m.mode));
      t.appendChild(document.createTextNode(m.label + (info.free ? ' (free)' : '')));
      if (info.locked) t.appendChild(icon('lock'));
      t.addEventListener('click', function () { state.mode = m.mode; drawTabs(); load(); });
      tabs.appendChild(t);
    });
    Object.keys(langBtns).forEach(function (k) { langBtns[k].setAttribute('aria-pressed', String(state.lang === k)); });
  }

  function setLang(l) {
    state.lang = l;
    try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
    drawTabs();
    load();
  }

  function coverage() {
    var ch = state.overview.chapter;
    var n = el('p', 'ep-note');
    n.id = 'examPrepCoverage';
    var skills = (ch.covers || []).map(function (c) { return state.lang === 'te' && c.te ? c.te : c.en; });
    n.textContent = 'These notes cover ' + skills.length + ' skills of this chapter: ' + skills.join('; ') + '.' + (ch.editionNote ? ' ' + ch.editionNote + '.' : '');
    return n;
  }

  function stateBox(iconName, lines, button) {
    var box = el('div', 'ep-state');
    box.setAttribute('data-state', iconName);
    box.appendChild(icon(iconName));
    lines.forEach(function (t) { box.appendChild(el('p', null, t)); });
    if (button) box.appendChild(button);
    return box;
  }

  // "Report a mistake" under every ready note (parent only, hidden in child
  // mode). The note stays as it is; the founder gets it in his review list.
  function reportBox(mode, lang) {
    var wrap = el('div', 'ep-report ep-parent-only');
    var open = el('button', 'dc-btn dc-btn--outline', 'Report a mistake');
    open.type = 'button';
    open.id = 'examPrepReport';
    var form = el('div', 'ep-report__form');
    form.hidden = true;
    var text = el('textarea');
    text.id = 'examPrepReportText';
    text.maxLength = 500;
    text.rows = 3;
    text.placeholder = 'What looks wrong? (optional)';
    text.setAttribute('aria-label', 'What looks wrong?');
    var send = el('button', 'dc-btn dc-btn--blue', 'Send report');
    send.type = 'button';
    send.id = 'examPrepReportSend';
    var msg = el('p', 'ep-expl');
    msg.id = 'examPrepReportMsg';
    msg.setAttribute('role', 'status');
    form.appendChild(text);
    form.appendChild(send);
    open.addEventListener('click', function () { form.hidden = !form.hidden; });
    send.addEventListener('click', function () {
      send.disabled = true;
      fetch('/api/exam-prep/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: state.studentId, mode: mode, lang: lang, message: text.value }),
      }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function () {
          form.hidden = true;
          open.hidden = true;
          msg.textContent = 'Thank you. We will check this note.';
        })
        .catch(function (err) {
          console.error('[exam prep] Could not send the report:', err);
          send.disabled = false;
          msg.textContent = 'Could not send the report. Please try again.';
        });
    });
    wrap.appendChild(open);
    wrap.appendChild(form);
    wrap.appendChild(msg);
    return wrap;
  }

  var loadSeq = 0;
  function load() {
    var seq = ++loadSeq;
    body.replaceChildren(el('p', 'ep-expl', 'Loading…'));
    body.setAttribute('data-mode', state.mode);
    body.removeAttribute('data-status');
    fetch('/api/exam-prep/' + encodeURIComponent(state.studentId) + '/' + state.mode + '?lang=' + state.lang, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        if (seq !== loadSeq) return;
        body.setAttribute('data-status', d.status);
        body.replaceChildren(coverage());
        var holder = el('div');
        body.appendChild(holder);
        if (d.status === 'ready') {
          body.setAttribute('data-version', d.versionId);
          R.render(holder, state.mode, d, {
            onFlashcard: function () { send('flashcard_answered'); },
            onQuestion: function () { send('question_answered'); },
          });
          body.appendChild(reportBox(d.mode, d.lang));
        } else if (d.status === 'locked') {
          var btn = null;
          if (canPay()) {
            btn = el('button', 'dc-btn dc-btn--blue ep-parent-only', 'Unlock with Pro');
            btn.type = 'button';
            btn.id = 'examPrepUnlock';
            btn.addEventListener('click', function () { window.TutpBilling.choosePlan(state.studentId); });
          }
          holder.appendChild(stateBox('lock', ['This is part of the chapter exam prep pack, included in Pro for this child.', canPay() ? 'Revision notes stay free.' : 'Ask a parent to unlock it. Revision notes stay free.'], btn));
        } else if (d.reason === 'telugu_pending') {
          var en = null;
          if (d.englishReady) {
            en = el('button', 'dc-btn dc-btn--outline', 'Read it in English');
            en.type = 'button';
            en.addEventListener('click', function () { setLang('en'); });
          }
          holder.appendChild(stateBox('translate', ['Coming soon in Telugu.', 'We check every Telugu note by hand before your child sees it.'], en));
        } else {
          holder.appendChild(stateBox('schedule', ['Coming soon.', 'This note is being checked before your child sees it.']));
        }
      })
      .catch(function (err) {
        if (seq !== loadSeq) return;
        console.error('[exam prep] Could not load the note:', err);
        body.replaceChildren(stateBox('wifi_off', ['Could not load this note. Please try again.']));
      });
  }

  function openPage() {
    if (!overlay) build();
    var ch = state.overview.chapter;
    $('examPrepTitle').textContent = ch.title;
    $('examPrepSub').textContent = ch.boardLabel;
    state.lang = defaultLang();
    state.mode = 'revision_notes';
    overlay.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    drawTabs();
    load();
    state.openId = newOpenId();
    state.visibleMs = 0;
    state.visibleSince = document.hidden ? null : Date.now();
    send('opened');
    state.beat = setInterval(function () { if (!document.hidden) reportTime(false); }, 30000);
  }

  function closePage() {
    if (!overlay || overlay.hidden) return;
    exitChildMode();
    reportTime(false);
    clearInterval(state.beat);
    state.openId = null;
    overlay.hidden = true;
    document.documentElement.style.overflow = '';
  }

  function enterChildMode() {
    overlay.classList.add('ep-child');
    if (overlay.requestFullscreen) overlay.requestFullscreen().catch(function () {});
  }
  function exitChildMode() {
    if (!overlay.classList.contains('ep-child')) return;
    overlay.classList.remove('ep-child');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  }

  // ---------------------------------------------------------------- cards

  function drawCard() {
    var card = $('examPrepCard');
    if (!card) return;
    var o = state.overview;
    var headWrap = el('div', 'dc-card__head');
    var chip = el('span', 'dc-chip ' + (o && o.eligible ? 'dc-chip--violet' : 'dc-chip--muted'));
    chip.appendChild(icon('quiz'));
    var words = el('div');
    words.appendChild(el('p', 'dc-eyebrow', 'Exam prep'));
    card.replaceChildren();
    card.appendChild(headWrap);
    headWrap.appendChild(chip);
    headWrap.appendChild(words);
    if (o && o.eligible) {
      card.classList.remove('dc-card--soon');
      card.setAttribute('data-eligible', 'true');
      words.appendChild(el('h3', 'dc-title', o.chapter.title));
      card.appendChild(el('p', 'dc-text', 'Revision notes, key points, flashcards, practice questions in the exam pattern and a mind map, checked before your child sees them. Revision notes are free.' + (o.chapter.editionNote ? ' ' + o.chapter.editionNote + '.' : '')));
      var foot = el('div', 'dc-card__foot');
      var b = el('button', 'dc-btn dc-btn--blue', 'Open exam prep');
      b.type = 'button';
      b.id = 'examPrepOpen';
      b.addEventListener('click', openPage);
      foot.appendChild(b);
      card.appendChild(foot);
    } else {
      card.classList.add('dc-card--soon');
      card.setAttribute('data-eligible', 'false');
      words.appendChild(el('h3', 'dc-title', 'Chapter notes for exams'));
      var badge = el('span', 'dc-badge-soon');
      badge.appendChild(icon('schedule'));
      badge.appendChild(document.createTextNode('Coming soon'));
      headWrap.appendChild(badge);
      card.appendChild(el('p', 'dc-text', 'Exam prep starts with Class 5 maths for the Andhra Pradesh and Telangana state boards. Your child\'s class and board are coming soon.'));
    }
  }

  function drawWeek() {
    var box = $('examPrepWeekList');
    var fam = familyId();
    if (!box || !fam) return;
    fetch('/api/exam-prep/week/' + encodeURIComponent(fam), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var kids = (d.children || []).filter(function (c) { return c.opens || c.minutes || c.flashcards || c.questions; });
        if (!kids.length) { box.replaceChildren(el('p', 'dc-text', 'No exam prep yet this week.')); return; }
        var ul = el('ul', 'ep-week');
        kids.forEach(function (c) {
          var li = el('li');
          li.setAttribute('data-student', c.studentId);
          li.appendChild(el('strong', null, String(c.name || '').split(' ')[0]));
          li.appendChild(el('span', null, c.minutes + ' min · ' + c.flashcards + ' flashcards · ' + c.questions + ' questions'));
          ul.appendChild(li);
        });
        box.replaceChildren(ul);
      })
      .catch(function (err) {
        console.error('[exam prep] Could not load this week:', err);
        box.replaceChildren(el('p', 'dc-text', 'Could not load this week\'s exam prep.'));
      });
  }

  Promise.resolve(window.tutpChildReady).then(function (studentId) {
    state.studentId = studentId;
    drawWeek();
    if (!studentId) { drawCard(); return; }
    return fetch('/api/exam-prep/' + encodeURIComponent(studentId), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { state.overview = d; drawCard(); })
      .catch(function (err) { console.error('[exam prep] Could not load:', err); drawCard(); });
  });

  window.TutpExamPrep = { open: function () { if (state.overview && state.overview.eligible) openPage(); }, close: closePage, refreshWeek: drawWeek };
})();
