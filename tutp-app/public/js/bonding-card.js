/* bonding-card.js — the Bonding Report card and its full report, one shared
   component for the mother, father and family-member dashboards (TUT-56,
   docs/specs/TUT-56-bonding-card.md).

   The card holds only: icon + title, the score or the empty state, one line,
   "View Full Report". Everything else — why a score is N/A, how many more
   sessions are needed, the 14-day homework completion and the baseline-survey
   chips — lives in the full report dialog.

   The page supplies an empty #bondingReportSection. Ids bondingScoreValue and
   bondingGapText are kept. Chips are drawn by baseline-survey.js into
   #pibStripHost when the report is open. Text: te / en / hi, picked like the
   search chips do (tutp_ui_lang, browser languages, English). */
(function () {
  var NEEDED_SESSIONS = 3;

  var MSG = {
    en: {
      title: 'Bonding Report',
      loading: 'Loading your bonding score…',
      viewFull: 'View Full Report',
      na: 'N/A',
      empty: 'Sit with your child for 3 homework sessions this week to see your score.',
      leader: 'You’re the top bonder in your family right now!',
      gap: '{n} points away from the top score.',
      loggedOut: 'Log in to see your bonding score.',
      mismatch: 'Your sign-in does not match this family. <a class="underline" href="/app/login/">Sign in again</a> to see your bonding score.',
      failed: 'The bonding score did not load. Reload the page in a minute.',
      close: 'Close',
      yourScore: 'Your score',
      whyNa: 'Your score appears after you sit with your child for 3 homework sessions in a week.',
      sessionsSoFar: 'Sessions this week: {c} of 3.',
      moreOne: '1 more session needed.',
      moreMany: '{n} more sessions needed.',
      enough: 'You have done 3 sessions this week. The score is worked out once a day, so it can take until tomorrow to appear.',
      sessionsFailed: 'This week’s sessions did not load. Reload the page in a minute.',
      hwHeading: 'Homework completion — last 14 days',
      hwLoading: 'Loading…',
      hwNone: 'Not enough homework activity in the last 14 days to show a report yet.',
      hwFailed: 'The homework report did not load. Reload the page in a minute.',
      hwFamily: 'Across the family: {d} of {a} homework items done.',
      hwChild: '{d} of {a} homework items done — {p}%',
      startHeading: 'Your family’s starting point'
    },
    te: {
      title: 'బాండింగ్ రిపోర్ట్',
      loading: 'మీ బాండింగ్ స్కోర్ లోడ్ అవుతోంది…',
      viewFull: 'పూర్తి రిపోర్ట్ చూడండి',
      na: 'N/A',
      empty: 'ఈ వారం మీ బిడ్డతో 3 హోంవర్క్ సెషన్లు కూర్చుంటే మీ స్కోర్ కనిపిస్తుంది.',
      leader: 'ప్రస్తుతం మీ కుటుంబంలో మీరే టాప్ బాండర్!',
      gap: 'టాప్ స్కోర్ కంటే {n} పాయింట్లు తక్కువ.',
      loggedOut: 'మీ బాండింగ్ స్కోర్ చూడటానికి లాగిన్ అవ్వండి.',
      mismatch: 'మీ సైన్-ఇన్ ఈ కుటుంబానికి సరిపోలడం లేదు. మీ బాండింగ్ స్కోర్ చూడటానికి <a class="underline" href="/app/login/">మళ్లీ సైన్ ఇన్ చేయండి</a>.',
      failed: 'బాండింగ్ స్కోర్ లోడ్ కాలేదు. ఒక నిమిషం తర్వాత పేజీని రీలోడ్ చేయండి.',
      close: 'మూసివేయండి',
      yourScore: 'మీ స్కోర్',
      whyNa: 'ఒక వారంలో మీ బిడ్డతో 3 హోంవర్క్ సెషన్లు కూర్చున్న తర్వాత మీ స్కోర్ కనిపిస్తుంది.',
      sessionsSoFar: 'ఈ వారం సెషన్లు: {c} / 3.',
      moreOne: 'ఇంకా 1 సెషన్ కావాలి.',
      moreMany: 'ఇంకా {n} సెషన్లు కావాలి.',
      enough: 'ఈ వారం మీరు 3 సెషన్లు పూర్తి చేశారు. స్కోర్ రోజుకు ఒకసారి లెక్కిస్తాం, కాబట్టి రేపటికి కనిపించవచ్చు.',
      sessionsFailed: 'ఈ వారం సెషన్లు లోడ్ కాలేదు. ఒక నిమిషం తర్వాత పేజీని రీలోడ్ చేయండి.',
      hwHeading: 'హోంవర్క్ పూర్తి — గత 14 రోజులు',
      hwLoading: 'లోడ్ అవుతోంది…',
      hwNone: 'రిపోర్ట్ చూపించడానికి గత 14 రోజుల్లో తగినంత హోంవర్క్ లేదు.',
      hwFailed: 'హోంవర్క్ రిపోర్ట్ లోడ్ కాలేదు. ఒక నిమిషం తర్వాత పేజీని రీలోడ్ చేయండి.',
      hwFamily: 'కుటుంబం మొత్తం: {a} హోంవర్క్ అంశాల్లో {d} పూర్తయ్యాయి.',
      hwChild: '{a} హోంవర్క్ అంశాల్లో {d} పూర్తయ్యాయి — {p}%',
      startHeading: 'మీ కుటుంబ ప్రారంభ స్థితి'
    },
    hi: {
      title: 'बॉन्डिंग रिपोर्ट',
      loading: 'आपका बॉन्डिंग स्कोर लोड हो रहा है…',
      viewFull: 'पूरी रिपोर्ट देखें',
      na: 'N/A',
      empty: 'इस हफ़्ते अपने बच्चे के साथ 3 होमवर्क सेशन में बैठें, तब आपका स्कोर दिखेगा.',
      leader: 'अभी आप अपने परिवार में सबसे आगे हैं!',
      gap: 'टॉप स्कोर से {n} पॉइंट पीछे.',
      loggedOut: 'अपना बॉन्डिंग स्कोर देखने के लिए लॉग इन करें.',
      mismatch: 'आपका साइन-इन इस परिवार से मेल नहीं खाता. अपना बॉन्डिंग स्कोर देखने के लिए <a class="underline" href="/app/login/">फिर से साइन इन करें</a>.',
      failed: 'बॉन्डिंग स्कोर लोड नहीं हुआ. एक मिनट बाद पेज रीलोड करें.',
      close: 'बंद करें',
      yourScore: 'आपका स्कोर',
      whyNa: 'एक हफ़्ते में बच्चे के साथ 3 होमवर्क सेशन में बैठने के बाद आपका स्कोर दिखता है.',
      sessionsSoFar: 'इस हफ़्ते के सेशन: 3 में से {c}.',
      moreOne: 'अभी 1 सेशन और चाहिए.',
      moreMany: 'अभी {n} सेशन और चाहिए.',
      enough: 'इस हफ़्ते आप 3 सेशन कर चुके हैं. स्कोर दिन में एक बार निकलता है, इसलिए कल तक दिख सकता है.',
      sessionsFailed: 'इस हफ़्ते के सेशन लोड नहीं हुए. एक मिनट बाद पेज रीलोड करें.',
      hwHeading: 'होमवर्क पूरा — पिछले 14 दिन',
      hwLoading: 'लोड हो रहा है…',
      hwNone: 'रिपोर्ट दिखाने के लिए पिछले 14 दिनों में पर्याप्त होमवर्क नहीं है.',
      hwFailed: 'होमवर्क रिपोर्ट लोड नहीं हुई. एक मिनट बाद पेज रीलोड करें.',
      hwFamily: 'पूरे परिवार में: {a} में से {d} होमवर्क आइटम पूरे.',
      hwChild: '{a} में से {d} होमवर्क आइटम पूरे — {p}%',
      startHeading: 'आपके परिवार की शुरुआत'
    }
  };

  function uiLang() {
    try {
      var saved = localStorage.getItem('tutp_ui_lang');
      if (saved && MSG[saved]) return saved;
    } catch (e) {}
    var prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < prefs.length; i++) {
      var base = String(prefs[i]).toLowerCase().split('-')[0];
      if (MSG[base]) return base;
    }
    return 'en';
  }
  function t(key, vars) {
    var s = (MSG[uiLang()] && MSG[uiLang()][key]) || MSG.en[key] || '';
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
    return s;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Which score row this dashboard reads: the role's own key, or the member id.
  function viewerKey() {
    var path = location.pathname;
    if (path.indexOf('/app/mother/') === 0) return 'mother';
    if (path.indexOf('/app/father/') === 0) return 'father';
    try { return sessionStorage.getItem('tutp_family_member_id') || ''; } catch (e) { return ''; }
  }
  function familyId() {
    try { return sessionStorage.getItem('tutp_family_id'); } catch (e) { return null; }
  }

  var section = null, valueEl = null, gapEl = null;
  var state = { status: 'loading', data: null };   // loading | loggedout | ok | error
  var dialog = null, lastFocus = null;

  // ---- card -------------------------------------------------------------
  function buildCard() {
    section.textContent = '';
    // TUT-42: the same card family as the other dashboard cards (seal, small label,
    // title, the value, one line, the action at the bottom). The seal stays light with
    // the bonding icon in it (bonding.spec.js checks the icon and a light chip).
    var h3 = el('h3', 'tp-card__head');
    var chip = el('span', 'tp-seal-light');
    var img = document.createElement('img');
    img.src = '/assets/icons/bonding-small.svg';
    img.alt = '';
    img.width = 22;
    img.height = 22;
    chip.appendChild(img);
    h3.appendChild(chip);
    h3.appendChild(el('span', 'tp-card__eye', 'Bonding'));
    h3.appendChild(el('span', 'bc-title tp-card__title', t('title')));
    section.appendChild(h3);

    valueEl = el('span', 'tp-card__big');
    valueEl.id = 'bondingScoreValue';
    var sk = el('span', 'inline-block w-16 h-9 bg-surface-variant rounded-lg animate-pulse align-middle');
    valueEl.appendChild(sk);
    section.appendChild(valueEl);
    gapEl = el('p', 'tp-card__text', t('loading'));
    gapEl.id = 'bondingGapText';
    section.appendChild(gapEl);

    var foot = el('div', 'tp-card__foot');
    var btn = el('button', 'tp-link');
    btn.type = 'button';
    btn.id = 'bondingViewFull';
    btn.appendChild(document.createTextNode(t('viewFull') + ' '));
    var arrow = el('span', 'material-symbols-outlined', 'arrow_forward');
    arrow.setAttribute('aria-hidden', 'true');
    btn.appendChild(arrow);
    btn.addEventListener('click', openReport);
    foot.appendChild(btn);
    section.appendChild(foot);
  }

  function paintCard() {
    if (state.status === 'loggedout') {
      valueEl.textContent = '—';
      gapEl.textContent = t('loggedOut');
    } else if (state.status === 'error') {
      valueEl.textContent = '—';
      if (state.httpStatus === 401 || state.httpStatus === 403) gapEl.innerHTML = t('mismatch');
      else gapEl.textContent = t('failed');
    } else if (state.status === 'ok') {
      var d = state.data;
      if (!d.hasData) {
        valueEl.textContent = t('na');
        gapEl.textContent = t('empty');
      } else {
        valueEl.textContent = d.score + '%';
        gapEl.textContent = d.isLeader ? t('leader') : t('gap', { n: d.leaderScore - d.score });
      }
    }
  }

  function loadScore() {
    var fid = familyId();
    if (!fid) { state = { status: 'loggedout' }; paintCard(); return; }
    fetch('/api/bonding-score/' + encodeURIComponent(fid) + '/' + encodeURIComponent(viewerKey()), { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) { var e = new Error('Request failed'); e.status = res.status; throw e; }
        return res.json();
      })
      .then(function (data) { state = { status: 'ok', data: data }; paintCard(); })
      .catch(function (err) {
        console.error('[bonding-card] Could not load bonding score:', err);
        state = { status: 'error', httpStatus: err && err.status };
        paintCard();
      });
  }

  // ---- full report ------------------------------------------------------
  function closeReport() {
    if (!dialog) return;
    document.removeEventListener('keydown', onKey);
    dialog.remove();
    dialog = null;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) { if (e.key === 'Escape') closeReport(); }

  function openReport() {
    if (dialog) return;
    lastFocus = document.activeElement;
    var overlay = el('div', 'bc-overlay');
    overlay.id = 'bondingReportDialog';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'bcReportTitle');
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeReport(); });

    var box = el('div', 'bc-box');
    var head = el('div', 'bc-head');
    var title = el('h3', 'bc-h', t('title'));
    title.id = 'bcReportTitle';
    var x = el('button', 'bc-x');
    x.type = 'button';
    x.setAttribute('aria-label', t('close'));
    var xi = el('span', 'material-symbols-outlined', 'close');
    xi.setAttribute('aria-hidden', 'true');
    x.appendChild(xi);
    x.addEventListener('click', closeReport);
    head.appendChild(title);
    head.appendChild(x);
    box.appendChild(head);

    // score / why N/A
    var scoreBox = el('div', 'bc-block bc-score');
    scoreBox.id = 'bcReportScore';
    box.appendChild(scoreBox);

    // homework completion
    var hw = el('div', 'bc-block');
    hw.appendChild(el('h4', 'bc-sub', t('hwHeading')));
    var hwBody = el('div', 'bc-hw', t('hwLoading'));
    hwBody.id = 'bcReportHomework';
    hw.appendChild(hwBody);
    box.appendChild(hw);

    // chips (drawn by baseline-survey.js once the survey is answered)
    var start = el('div', 'bc-block');
    var startHead = el('h4', 'bc-sub', t('startHeading'));
    startHead.id = 'pibStripHead';
    startHead.hidden = true;
    var host = el('div', null);
    host.id = 'pibStripHost';
    start.appendChild(startHead);
    start.appendChild(host);
    box.appendChild(start);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    dialog = overlay;
    document.addEventListener('keydown', onKey);
    x.focus();

    paintReportScore(scoreBox);
    loadReportHomework(hwBody);
    if (window.TutpBaselineStrip) window.TutpBaselineStrip.render();
  }

  function paintReportScore(box) {
    box.textContent = '';
    box.appendChild(el('h4', 'bc-sub', t('yourScore')));
    if (state.status === 'ok' && state.data.hasData) {
      box.appendChild(el('p', 'bc-big', state.data.score + '%'));
      box.appendChild(el('p', 'bc-p', state.data.isLeader ? t('leader') : t('gap', { n: state.data.leaderScore - state.data.score })));
      return;
    }
    if (state.status === 'loggedout') { box.appendChild(el('p', 'bc-p', t('loggedOut'))); return; }
    if (state.status === 'error') {
      var p = el('p', 'bc-p');
      if (state.httpStatus === 401 || state.httpStatus === 403) p.innerHTML = t('mismatch');
      else p.textContent = t('failed');
      box.appendChild(p);
      return;
    }
    if (state.status !== 'ok') { box.appendChild(el('p', 'bc-p', t('loading'))); return; }

    // N/A: why, and how many more sessions
    box.appendChild(el('p', 'bc-big', t('na')));
    box.appendChild(el('p', 'bc-p', t('whyNa')));
    var more = el('p', 'bc-p bc-more');
    more.id = 'bcReportSessions';
    box.appendChild(more);
    var fid = familyId();
    fetch('/api/weekly-sessions/' + encodeURIComponent(fid), { credentials: 'same-origin' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (d) {
        var c = Number(d.count) || 0;
        var left = Math.max(0, NEEDED_SESSIONS - c);
        if (left === 0) { more.textContent = t('enough'); return; }
        more.textContent = t('sessionsSoFar', { c: c }) + ' ' + (left === 1 ? t('moreOne') : t('moreMany', { n: left }));
      })
      .catch(function (err) {
        console.error('[bonding-card] Could not load weekly sessions:', err);
        more.textContent = t('sessionsFailed');
      });
  }

  function loadReportHomework(body) {
    fetch('/api/homework-completion/' + encodeURIComponent(familyId()), { credentials: 'same-origin' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (s) {
        body.textContent = '';
        if (!s.hasData) { body.textContent = t('hwNone'); return; }
        var fam = el('div', 'bc-card');
        fam.appendChild(el('p', 'bc-p', t('hwFamily', { d: s.totalDone, a: s.totalAssigned })));
        fam.appendChild(el('p', 'bc-big', s.percentage + '%'));
        body.appendChild(fam);
        if ((s.children || []).length > 1) {
          s.children.forEach(function (c) {
            var card = el('div', 'bc-card');
            card.appendChild(el('p', 'bc-name', c.name));
            card.appendChild(el('p', 'bc-p', t('hwChild', { d: c.done, a: c.assigned, p: c.percentage })));
            body.appendChild(card);
          });
        }
      })
      .catch(function (err) {
        console.error('[bonding-card] Could not load homework completion:', err);
        body.textContent = t('hwFailed');
      });
  }

  function init() {
    section = document.getElementById('bondingReportSection');
    if (!section) return;
    buildCard();
    loadScore();
  }

  window.TutpBondingCard = { open: openReport };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
