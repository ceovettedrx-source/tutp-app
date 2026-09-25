/* baseline-survey.js — one-time "Bonding baseline" popup on the mother /
   father / family-member dashboards, told as a 5-page storybook: homework
   days (0-7), how the parent helps, activities the family already does
   together, how often they eat together, and trip days in the last year.
   Answers go to POST /api/parent-involvement-baseline, which takes family
   and viewer from the session cookie only.

   Shown on dashboard load when this viewer has no saved answer yet (GET
   returns exists:false). Waits until the dashboard has settled and no other
   modal is open, so it never lands on top of a task in progress. Single-
   choice pages advance on their own after a tap; the multi-select page and
   the last page wait for their button. Arrow keys move the selection
   without advancing, so keyboard users can look before they commit.
   "Skip for now" writes nothing: it's suppressed for the rest of this
   browser session (sessionStorage) and asked again on a later visit.
   Collect-only — nothing here affects the Bonding Score.

   Once answered, the same GET also drives a small icon strip under the
   score on the Bonding Report card (#bondingScoreValue's row): homework
   days, meals, activities (icons only) and trip days. Icon-first so it
   reads without reading; each item carries its full wording for screen
   readers. Nothing is shown before the survey is answered. */
(function () {
  var SKIP_KEY = 'tutp_baseline_skipped';
  var FIRST_DELAY_MS = 1500;
  var RETRY_MS = 2000;
  var ADVANCE_MS = 450;
  var IMG_DIR = '/images/bonding-survey/';

  // Sunbeam colours for 0-7, red through violet; ink is the number colour
  // once that ray is filled (dark on the light yellows/greens, white else).
  var RAYS = [
    { c: '#e4572e', ink: '#ffffff' }, { c: '#ef7d32', ink: '#ffffff' },
    { c: '#f4a63a', ink: '#181c20' }, { c: '#e9c46a', ink: '#181c20' },
    { c: '#8ab17d', ink: '#181c20' }, { c: '#2a9d8f', ink: '#ffffff' },
    { c: '#3d7ec9', ink: '#ffffff' }, { c: '#7b61c4', ink: '#ffffff' }
  ];

  // kind: 'sunbeam' | 'single' | 'multi'. auto: advance after a tap.
  var STEPS = [
    {
      key: 'homework_days', kind: 'sunbeam', auto: true,
      img: 'step1-study-table', alt: 'A parent and child at a study table, working through homework together',
      q: 'In a typical week, how many days do you sit with your child for homework?'
    },
    {
      key: 'support_style', kind: 'single', auto: true, stacked: true,
      img: 'step2-helping-hand', alt: 'A parent’s hand guiding a child’s hand as they write',
      q: 'When you help, what do you usually do?',
      options: [
        { value: 'explains_until_understood', label: 'Explain until they understand' },
        { value: 'guides_questions', label: 'Ask guiding questions, let them try' },
        { value: 'checks_only', label: 'Mostly just check it’s done' },
        { value: 'sits_through', label: 'I sit through the whole thing with them' }
      ]
    },
    {
      key: 'activities', kind: 'multi',
      img: 'step4-together-activities', alt: 'Storybook vignettes of a family cooking, playing and reading together at home',
      q: 'Which of these do you already do together?',
      hint: 'Pick as many as you like.',
      options: [
        { value: 'meals', label: 'Meals together' },
        { value: 'game_night', label: 'Game night' },
        { value: 'story_time', label: 'Story time' },
        { value: 'outdoor', label: 'Outdoor time' },
        { value: 'chores', label: 'Chores together' },
        { value: 'celebrations', label: 'Celebrations' }
      ]
    },
    {
      key: 'meal_frequency', kind: 'single', auto: true,
      img: 'step3-dinner-table', alt: 'A family sharing dinner around the table',
      q: 'How often does your family eat meals together?',
      options: [
        { value: 'every_day', label: 'Every day' },
        { value: 'most_days', label: 'Most days' },
        { value: 'occasionally', label: 'Occasionally' },
        { value: 'rarely', label: 'Rarely' }
      ]
    },
    {
      key: 'trip_days_bucket', kind: 'single',
      img: 'step5-trip', alt: 'A joyful family setting off on a trip together',
      q: 'In the last year, how many days did you spend on a trip or vacation with your child?',
      options: [
        { value: 'none', label: '0 days' },
        { value: '1_5', label: '1–5 days' },
        { value: '6_15', label: '6–15 days' },
        { value: '16_30', label: '16–30 days' },
        { value: '30_plus', label: '30+ days' }
      ]
    }
  ];

  // Icons for the Bonding Report strip, keyed by the stored answer values.
  var STRIP_ACTIVITY_ICONS = {
    meals: '🍲', game_night: '🎲', story_time: '📖', outdoor: '🌳', chores: '🧹', celebrations: '🎉'
  };
  var STRIP_TRIP_LABELS = {
    none: '0 days/year', '1_5': '1–5 days/year', '6_15': '6–15 days/year',
    '16_30': '16–30 days/year', '30_plus': '30+ days/year'
  };

  var answer = { homework_days: null, support_style: null, activities: [], meal_frequency: null, trip_days_bucket: null };
  var stepIdx = 0;
  var overlay = null, card = null, body = null, dots = [];
  var lastFocus = null;
  var advanceTimer = null;

  function skippedThisSession() {
    try { return sessionStorage.getItem(SKIP_KEY) === '1'; } catch (e) { return false; }
  }
  function rememberSkip() {
    try { sessionStorage.setItem(SKIP_KEY, '1'); } catch (e) {}
  }

  // Any of the dashboard's own modals (…Modal ids, the attach chooser) that
  // is currently visible counts as "the parent is mid-task".
  function otherModalOpen() {
    var els = document.querySelectorAll('[id$="Modal"], #searchAttachChooser');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.classList.contains('hidden') && getComputedStyle(el).display !== 'none') return true;
    }
    return false;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function button(cls, text) {
    var b = el('button', cls, text);
    b.type = 'button';
    return b;
  }

  function answered(step) {
    var v = answer[step.key];
    return step.kind === 'multi' ? true : v !== null;
  }

  function markRadios(group, value) {
    var all = group.querySelectorAll('[role="radio"]');
    var anyOn = false;
    for (var i = 0; i < all.length; i++) {
      var on = all[i].getAttribute('data-value') === String(value);
      if (on) anyOn = true;
      all[i].setAttribute('aria-checked', on ? 'true' : 'false');
      all[i].tabIndex = on ? 0 : -1;
    }
    if (!anyOn && all.length) all[0].tabIndex = 0;
  }

  // Arrow keys move within a radiogroup (roving tabindex), per WAI-ARIA.
  // They select but never auto-advance; Enter/Space (a click) does.
  function wireArrowKeys(group, onSelect) {
    group.addEventListener('keydown', function (e) {
      var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!(e.key in keys)) return;
      var all = Array.prototype.slice.call(group.querySelectorAll('[role="radio"]'));
      var idx = all.indexOf(document.activeElement);
      if (idx < 0) return;
      e.preventDefault();
      var next = all[(idx + keys[e.key] + all.length) % all.length];
      next.focus();
      onSelect(next.getAttribute('data-value'));
    });
  }

  function close() {
    if (!overlay) return;
    clearTimeout(advanceTimer);
    document.removeEventListener('keydown', onDocKey, true);
    overlay.remove();
    overlay = card = body = null;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function skip() { rememberSkip(); close(); }

  function onDocKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); skip(); return; }
    if (e.key !== 'Tab' || !overlay) return;
    // Keep focus inside the dialog.
    var focusables = card.querySelectorAll('button:not([disabled]):not([tabindex="-1"])');
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || !card.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function render() {
    lastFocus = document.activeElement;
    overlay = el('div', 'pib-overlay');
    overlay.addEventListener('click', function (e) { if (e.target === overlay) skip(); });

    card = el('div', 'pib-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'pibTitle');

    var top = el('div', 'pib-top');
    var dotRow = el('div', 'pib-dots');
    dotRow.setAttribute('aria-hidden', 'true');
    dots = STEPS.map(function (s, i) {
      var d = el('span', 'pib-dot pib-s' + (i + 1));
      dotRow.appendChild(d);
      return d;
    });
    top.appendChild(dotRow);
    var closeBtn = button('pib-close');
    closeBtn.setAttribute('aria-label', 'Skip for now');
    closeBtn.appendChild(el('span', 'material-symbols-outlined', 'close'));
    closeBtn.addEventListener('click', skip);
    top.appendChild(closeBtn);
    card.appendChild(top);

    body = el('div', 'pib-body');
    card.appendChild(body);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onDocKey, true);
    showStep(0);
  }

  function goTo(i) {
    clearTimeout(advanceTimer);
    showStep(i);
  }

  function showStep(i) {
    stepIdx = i;
    var step = STEPS[i];
    card.setAttribute('data-step', String(i + 1));
    dots.forEach(function (d, j) { d.classList.toggle('is-lit', j <= i); });
    while (body.firstChild) body.removeChild(body.firstChild);

    var pic = el('picture', 'pib-art');
    var src = el('source');
    src.type = 'image/webp';
    src.srcset = IMG_DIR + step.img + '.webp';
    pic.appendChild(src);
    var img = el('img');
    img.src = IMG_DIR + step.img + '.jpg';
    img.alt = step.alt;
    img.width = 800;
    img.height = 597;
    img.decoding = 'async';
    pic.appendChild(img);
    body.appendChild(pic);

    body.appendChild(el('p', 'pib-eyebrow', 'Your family’s story · Page ' + (i + 1) + ' of ' + STEPS.length));
    var title = el('h2', 'pib-title', step.q);
    title.id = 'pibTitle';
    title.tabIndex = -1;
    body.appendChild(title);
    if (step.hint) body.appendChild(el('p', 'pib-hint', step.hint));

    var primary = button('pib-save');
    var control;
    if (step.kind === 'sunbeam') control = buildSunbeam(step, primary);
    else if (step.kind === 'multi') control = buildMulti(step);
    else control = buildSingle(step, primary);
    body.appendChild(control);

    var err = el('p', 'pib-error');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    body.appendChild(err);

    var last = i === STEPS.length - 1;
    primary.textContent = last ? 'Save my family’s story' : (step.kind === 'multi' ? 'Continue' : 'Next');
    primary.disabled = !answered(step);
    primary.addEventListener('click', function () {
      if (last) submit(primary, err);
      else goTo(i + 1);
    });

    var nav = el('div', 'pib-nav');
    if (i > 0) {
      var back = button('pib-back');
      back.appendChild(el('span', 'material-symbols-outlined', 'arrow_back'));
      back.appendChild(document.createTextNode('Back'));
      back.addEventListener('click', function () { goTo(i - 1); });
      nav.appendChild(back);
    }
    nav.appendChild(primary);
    body.appendChild(nav);

    var skipBtn = button('pib-skip', 'Skip for now, I’ll come back');
    skipBtn.addEventListener('click', skip);
    body.appendChild(skipBtn);

    if (i === 0) {
      body.appendChild(el('p', 'pib-note', 'A one-time starting point — it won’t change today’s score. Your Bonding Report reflects your real, tracked routine.'));
    }

    card.scrollTop = 0;
    title.focus();
  }

  // Pick an answer on a single-choice page; a tap (not an arrow key) on an
  // auto page moves on after a beat so the parent sees their choice land.
  function choose(step, value, primary, advance) {
    answer[step.key] = step.key === 'homework_days' ? Number(value) : value;
    primary.disabled = false;
    if (advance && step.auto) {
      var from = stepIdx;
      clearTimeout(advanceTimer);
      advanceTimer = setTimeout(function () {
        if (overlay && stepIdx === from) showStep(from + 1);
      }, ADVANCE_MS);
    }
  }

  // Eight rays (0-7) on a half-circle around a "sun" that shows the pick.
  function buildSunbeam(step, primary) {
    var wrap = el('div', 'pib-sun');
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-labelledby', 'pibTitle');
    var core = el('div', 'pib-sun-core');
    core.setAttribute('aria-hidden', 'true');
    var coreNum = el('span', 'pib-sun-num', answer.homework_days === null ? '?' : String(answer.homework_days));
    core.appendChild(coreNum);
    core.appendChild(el('span', 'pib-sun-label', 'days a week'));
    wrap.appendChild(core);

    function select(v, advance) {
      markRadios(wrap, v);
      coreNum.textContent = v;
      choose(step, v, primary, advance);
    }
    for (var n = 0; n <= 7; n++) {
      (function (n) {
        var angle = Math.PI - (Math.PI * n) / 7;
        var b = button('pib-ray', String(n));
        b.setAttribute('role', 'radio');
        b.setAttribute('data-value', String(n));
        b.setAttribute('aria-label', n + (n === 1 ? ' day' : ' days') + ' a week');
        b.style.left = (50 + 42 * Math.cos(angle)) + '%';
        b.style.top = (82.5 - 68.75 * Math.sin(angle)) + '%';
        b.style.setProperty('--ray', RAYS[n].c);
        b.style.setProperty('--ray-ink', RAYS[n].ink);
        b.addEventListener('click', function () { select(String(n), true); });
        wrap.appendChild(b);
      })(n);
    }
    markRadios(wrap, answer.homework_days);
    wireArrowKeys(wrap, function (v) { select(v, false); });
    return wrap;
  }

  function buildSingle(step, primary) {
    var group = el('div', 'pib-chips' + (step.stacked ? ' pib-chips--stacked' : ''));
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', 'pibTitle');
    function select(v, advance) {
      markRadios(group, v);
      choose(step, v, primary, advance);
    }
    step.options.forEach(function (o) {
      var b = button('pib-chip', o.label);
      b.setAttribute('role', 'radio');
      b.setAttribute('data-value', o.value);
      b.addEventListener('click', function () { select(o.value, true); });
      group.appendChild(b);
    });
    markRadios(group, answer[step.key]);
    wireArrowKeys(group, function (v) { select(v, false); });
    return group;
  }

  function buildMulti(step) {
    var group = el('div', 'pib-chips');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', 'pibTitle');
    step.options.forEach(function (o) {
      var b = button('pib-chip');
      b.setAttribute('role', 'checkbox');
      var on = answer.activities.indexOf(o.value) >= 0;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.appendChild(el('span', 'material-symbols-outlined pib-tick', 'check'));
      b.appendChild(document.createTextNode(o.label));
      b.addEventListener('click', function () {
        var idx = answer.activities.indexOf(o.value);
        if (idx >= 0) answer.activities.splice(idx, 1);
        else answer.activities.push(o.value);
        b.setAttribute('aria-checked', idx >= 0 ? 'false' : 'true');
      });
      group.appendChild(b);
    });
    return group;
  }

  function submit(save, err) {
    save.disabled = true;
    save.textContent = 'Saving…';
    err.hidden = true;
    fetch('/api/parent-involvement-baseline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(answer)
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      renderStrip(answer);
      showThanks();
    }).catch(function (e) {
      console.error('[baseline] Could not save:', e);
      err.textContent = 'Couldn’t save that just now. Please try again, or skip for now.';
      err.hidden = false;
      save.textContent = 'Save my family’s story';
      save.disabled = false;
    });
  }

  function showThanks() {
    card.setAttribute('data-step', 'done');
    while (body.firstChild) body.removeChild(body.firstChild);
    var box = el('div', 'pib-thanks');
    box.appendChild(el('span', 'material-symbols-outlined', 'auto_stories'));
    var t = el('h2', 'pib-title', 'Your family’s story is saved');
    t.id = 'pibTitle';
    box.appendChild(t);
    box.appendChild(el('p', 'pib-hint', 'This is your starting page. From here, your Bonding Report follows your real routine.'));
    var done = button('pib-save', 'Continue');
    done.addEventListener('click', close);
    box.appendChild(done);
    body.appendChild(box);
    done.focus();
  }

  function showWhenClear() {
    if (overlay || skippedThisSession()) return;
    if (otherModalOpen()) { setTimeout(showWhenClear, RETRY_MS); return; }
    render();
  }

  function optionLabel(key, value) {
    for (var i = 0; i < STEPS.length; i++) {
      if (STEPS[i].key !== key) continue;
      for (var j = 0; j < STEPS[i].options.length; j++) {
        if (STEPS[i].options[j].value === value) return STEPS[i].options[j].label;
      }
    }
    return null;
  }

  function stripItem(icons, text, full) {
    var li = el('li', 'pib-strip-item');
    li.title = full;
    var ic = el('span', 'pib-strip-icon', icons);
    ic.setAttribute('aria-hidden', 'true');
    li.appendChild(ic);
    if (text) {
      var t = el('span', null, text);
      t.setAttribute('aria-hidden', 'true');
      li.appendChild(t);
    }
    li.appendChild(el('span', 'pib-sr', full));
    return li;
  }

  // Answers as a compact icon strip in the Bonding Report card, right under
  // the score row. Replaces any earlier strip (e.g. just after saving).
  function renderStrip(b) {
    var scoreEl = document.getElementById('bondingScoreValue');
    if (!b || !scoreEl || !scoreEl.parentElement) return;
    var old = document.getElementById('pibStrip');
    if (old) old.remove();

    var ul = el('ul', 'pib-strip');
    ul.id = 'pibStrip';
    ul.setAttribute('aria-label', 'Your family’s starting point');

    var days = Number(b.homework_days);
    if (days >= 0 && days <= 7) {
      var dayText = days + (days === 1 ? ' day' : ' days') + '/week';
      ul.appendChild(stripItem('📚', dayText, 'Homework together ' + dayText.replace('/', ' a ')));
    }
    var meal = optionLabel('meal_frequency', b.meal_frequency);
    if (meal) ul.appendChild(stripItem('🍽️', meal, 'Meals together: ' + meal.toLowerCase()));
    var acts = (b.activities || []).filter(function (a) { return STRIP_ACTIVITY_ICONS[a]; });
    if (acts.length) {
      ul.appendChild(stripItem(
        acts.map(function (a) { return STRIP_ACTIVITY_ICONS[a]; }).join(''), null,
        'Together: ' + acts.map(function (a) { return optionLabel('activities', a); }).join(', ')
      ));
    }
    var trip = STRIP_TRIP_LABELS[b.trip_days_bucket];
    if (trip) ul.appendChild(stripItem('✈️', trip, 'Trips together: ' + trip.replace('/', ' a ')));

    if (ul.children.length) scoreEl.parentElement.insertAdjacentElement('afterend', ul);
  }

  function start() {
    fetch('/api/parent-involvement-baseline', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        // Not logged in or viewer not resolvable: stay silent.
        if (!data) return;
        if (data.exists) { renderStrip(data.baseline); return; }
        if (skippedThisSession()) return;
        setTimeout(showWhenClear, FIRST_DELAY_MS);
      })
      .catch(function () {});
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
