// Experiential Learning v2: Guided Discovery, the video list and the revisit
// card. Loaded by the four dashboard pages after homework-modal.js, like
// story-modal.js. It adds to the existing Experiential Learning modal and
// leaves the notes flow alone: a topic with no pilot lesson goes through the
// page's own handler exactly as before.
//
// Steps: Predict (the guess locks) -> Do / Play -> Notice -> Hint ladder
// (the answer shows after a right pick or 3 hints) -> Name it -> Videos ->
// Teach-back. Everything the server sends is put on the page as text
// (textContent), never as HTML.
(function () {
  'use strict';
  var modal = document.getElementById('experientialModal');
  var form = document.getElementById('experientialModalForm');
  var results = document.getElementById('experientialModalResults');
  var submitBtn = document.getElementById('experientialModalSubmitBtn');
  var langSel = document.getElementById('experientialModalLang');
  var topicBox = document.getElementById('experientialModalText');
  if (!modal || !form || !results || !submitBtn) return;

  var STEPS = ['Predict', 'Try', 'Notice', 'Explain', 'Name it', 'Videos', 'Teach back'];
  var SPEECH = { English: 'en-IN', Hindi: 'hi-IN', Telugu: 'te-IN', Tamil: 'ta-IN', Marathi: 'mr-IN', Spanish: 'es-ES', French: 'fr-FR', German: 'de-DE', Arabic: 'ar-SA' };
  var BOARD_KEY = 'tutp_el_board';
  var S = null;   // the running lesson: { token, studentId, lesson, step, ... }
  var token = 0;

  function h(tag, props) {
    var el = document.createElement(tag);
    for (var k in (props || {})) {
      if (k === 'class') el.className = props[k];
      else if (k === 'text') el.textContent = props[k];
      else if (k === 'on') { for (var ev in props.on) el.addEventListener(ev, props.on[ev]); }
      else if (props[k] !== false && props[k] != null) el.setAttribute(k, props[k]);
    }
    (function add(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c == null || c === false) continue;
        if (Array.isArray(c)) { add(c); continue; }
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    })(Array.prototype.slice.call(arguments, 2));
    return el;
  }
  function btn(label, onClick, cls) { return h('button', { type: 'button', class: 'el-btn ' + (cls || ''), text: label, on: { click: onClick } }); }

  async function api(path, opts) {
    var r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    var body = null;
    try { body = await r.json(); } catch (e) { /* 204 or empty */ }
    if (!r.ok) { var err = new Error((body && (body.message || body.error)) || 'Something went wrong'); err.status = r.status; err.body = body; throw err; }
    return body;
  }
  function lang() { return (langSel && langSel.value) || 'English'; }
  function board() { try { return localStorage.getItem(BOARD_KEY) || 'cbse-ncert'; } catch (e) { return 'cbse-ncert'; } }
  function track(name, extra) {
    if (!S) return;
    api('/api/el/event', { method: 'POST', body: JSON.stringify(Object.assign({ name: name, studentId: S.studentId, conceptId: S.lesson.id }, extra || {})) }).catch(function () { /* tracking never blocks the child */ });
  }

  // ---------------- the picker inside the form ----------------
  var pick = h('div', { id: 'elPick', class: 'el-pick' });
  form.insertBefore(pick, form.firstChild);
  var boardSel = h('select', { id: 'elBoard', class: 'el-board', 'aria-label': 'Board', on: { change: function () { try { localStorage.setItem(BOARD_KEY, boardSel.value); } catch (e) { /* private mode */ } } } },
    h('option', { value: 'cbse-ncert', text: 'CBSE / NCERT' }), h('option', { value: 'telangana', text: 'Telangana State Board' }));
  boardSel.value = board();
  var chipRow = h('div', { id: 'elChips', class: 'el-chips', role: 'group', 'aria-label': 'Guided discovery lessons' });
  pick.appendChild(h('div', { class: 'el-pick-head' },
    h('div', null, h('div', { class: 'el-pick-title', text: 'Guided discovery' }), h('div', { class: 'el-pick-sub', text: 'Guess first, try it at home, then find the idea. Science, Class 6 to 10.' })), boardSel));
  pick.appendChild(chipRow);
  var pickErr = h('div', { class: 'el-err hidden', id: 'elPickErr', role: 'alert' });
  pick.appendChild(pickErr);

  api('/api/el/concepts').then(function (d) {
    (d.concepts || []).forEach(function (c) {
      chipRow.appendChild(h('button', { type: 'button', class: 'el-chip', 'data-concept': c.id, text: c.title, on: { click: function () { start(c.id); } } }));
    });
    if (!(d.concepts || []).length) pick.classList.add('hidden');
  }).catch(function () { pick.classList.add('hidden'); });

  // Submit: a typed topic that matches a pilot lesson starts it; everything
  // else goes on to the page's own notes handler.
  submitBtn.addEventListener('click', function (ev) {
    if (submitBtn.dataset.elPass === '1') { delete submitBtn.dataset.elPass; return; }
    var text = (topicBox && topicBox.value || '').trim();
    var hasAttach = !!document.querySelector('#experientialModalThumb:not(.hidden), #experientialModalPdfLabel:not(.hidden)');
    if (!text || hasAttach) return;      // photo/PDF or nothing typed: notes flow, unchanged
    ev.stopImmediatePropagation(); ev.preventDefault();
    api('/api/el/match?text=' + encodeURIComponent(text)).then(function (m) {
      if (m && m.conceptId) { start(m.conceptId); return; }
      submitBtn.dataset.elPass = '1'; submitBtn.click();
    }).catch(function () { submitBtn.dataset.elPass = '1'; submitBtn.click(); });
  }, true);

  // ---------------- the lesson ----------------
  var body = h('div', { id: 'elGuidedBody', class: 'el-body hidden' });
  var hook = document.getElementById('experientialModalHookBlock');
  results.insertBefore(body, hook || results.children[1] || null);

  function showError(msg) { pickErr.textContent = msg; pickErr.classList.remove('hidden'); }

  async function start(conceptId) {
    pickErr.classList.add('hidden');
    var my = ++token;
    var studentId;
    try { studentId = await window.tutpChildReady; } catch (e) { studentId = null; }
    if (!studentId) { showError('Please choose a child first.'); return; }
    chipRow.querySelectorAll('.el-chip').forEach(function (c) { c.disabled = true; });
    try {
      var q = '?studentId=' + encodeURIComponent(studentId) + '&language=' + encodeURIComponent(lang()) + '&board=' + encodeURIComponent(boardSel.value);
      var lesson = await api('/api/el/lesson/' + encodeURIComponent(conceptId) + q);
      if (my !== token) return;
      S = { studentId: studentId, lesson: lesson, step: 0, picked: null, hints: 0, solved: false, simOpened: {}, videos: null, tbDone: false };
      form.classList.add('hidden');
      results.classList.remove('hidden');
      results.classList.add('el-guided-on');
      body.classList.remove('hidden');
      render();
    } catch (err) {
      if (err.status === 402 && typeof window.showFreeLimitModal === 'function') window.showFreeLimitModal(err.message, (err.body && err.body.bucket) || 'other_features');
      else showError(err.status === 401 ? 'Your session has ended. Please sign in again.' : (err.message || "Couldn't open this lesson. Please try again."));
    } finally {
      chipRow.querySelectorAll('.el-chip').forEach(function (c) { c.disabled = false; });
    }
  }

  function stepper() {
    var ol = h('ol', { class: 'el-steps', 'aria-label': 'Progress' });
    STEPS.forEach(function (name, i) { ol.appendChild(h('li', { class: i === S.step ? 'on' : (i < S.step ? 'done' : ''), 'aria-current': i === S.step ? 'step' : false, text: name })); });
    return ol;
  }
  function next() { S.step++; render(); body.scrollIntoView && body.scrollIntoView({ block: 'start' }); }

  function render() {
    body.replaceChildren();
    var L = S.lesson;
    var chapter = L.mapping && L.mapping.chapter ? ('NCERT Class ' + L.mapping.grade + ', ' + L.mapping.chapter) : ('Class ' + L.grade);
    body.appendChild(h('div', { class: 'el-head' }, h('h4', { class: 'el-title', text: L.title }), h('div', { class: 'el-chapter', text: chapter })));
    body.appendChild(stepper());
    var fn = [stepPredict, stepTry, stepNotice, stepExplain, stepName, stepVideos, stepTeach][S.step];
    body.appendChild(fn());
  }

  function optionButtons(onPick, opts) {
    var L = S.lesson, wrap = h('div', { class: 'el-opts' });
    L.predict.options.forEach(function (o, i) {
      var b = h('button', { type: 'button', class: 'el-opt', 'data-i': String(i), text: o.text, on: { click: function () { onPick(i, b, wrap); } } });
      if (opts && opts.disabled && opts.disabled.indexOf(i) >= 0) { b.disabled = true; b.classList.add('wrong'); }
      wrap.appendChild(b);
    });
    return wrap;
  }

  // 1. Predict: the guess locks; correctness is not shown yet.
  function stepPredict() {
    var L = S.lesson, box = h('section', { class: 'el-step' });
    box.appendChild(h('p', { class: 'el-q', text: L.predict.question }));
    box.appendChild(h('p', { class: 'el-hint-line', text: 'Guess first. Your guess locks once you tap.' }));
    box.appendChild(optionButtons(function (i, b, wrap) {
      if (S.picked !== null) return;
      S.picked = i;
      wrap.querySelectorAll('.el-opt').forEach(function (x) { x.disabled = true; });
      b.classList.add('locked');
      if (i === L.predict.correctIndex) track('predict_correct', { correct: true });
      box.appendChild(h('p', { class: 'el-locked', role: 'status', text: 'Locked in. Now let us find out.' }));
      box.appendChild(btn('Next: try it', next, 'primary'));
    }));
    return box;
  }

  // 2. Do / Play
  function stepTry() {
    var L = S.lesson, box = h('section', { class: 'el-step' });
    if (L.experiment) {
      var pc = L.parentCard;
      box.appendChild(h('div', { class: 'el-card el-parent' },
        h('div', { class: 'el-card-title', text: 'Parent: your role' }), h('p', { text: pc.role }),
        h('div', { class: 'el-mini', text: 'Ask:' }), h('ul', null, pc.say.map(function (t) { return h('li', { text: t }); })),
        h('div', { class: 'el-mini', text: 'Please avoid:' }), h('ul', null, pc.avoid.map(function (t) { return h('li', { text: t }); }))));
      var x = L.experiment;
      var steps = h('ol', { class: 'el-ol' });
      x.steps.forEach(function (t, i) {
        var adult = x.adultSteps.indexOf(i) >= 0;
        steps.appendChild(h('li', { class: adult ? 'adult' : '' }, adult ? h('span', { class: 'el-adult', text: 'Adult does this step' }) : null, h('span', { text: t })));
      });
      box.appendChild(h('div', { class: 'el-card' }, h('div', { class: 'el-card-title', text: x.title }),
        h('div', { class: 'el-mini', text: 'You need' }), h('p', { class: 'el-items', text: x.items.join(', ') }),
        h('div', { class: 'el-mini', text: 'Steps' }), steps, x.note ? h('p', { class: 'el-note', text: x.note }) : null));
    }
    if (L.simUrls && L.simUrls.length) {
      var sims = h('div', { class: 'el-sims' });
      L.simUrls.forEach(function (url, i) {
        var slug = L.sim.slugs[i], holder = h('div', { class: 'el-sim' });
        holder.appendChild(btn(L.experiment ? 'Or play with the simulation' : 'Play with the simulation', function () {
          if (holder.querySelector('iframe')) return;
          holder.replaceChildren(
            h('iframe', { src: url, title: 'PhET simulation: ' + slug.replace(/-/g, ' '), class: 'el-iframe', loading: 'lazy', allowfullscreen: '', referrerpolicy: 'no-referrer' }),
            h('p', { class: 'el-attr', text: L.attribution }));
          if (!S.simOpened[slug]) { S.simOpened[slug] = true; track('sim_opened', { sim: slug }); }
        }));
        sims.appendChild(holder);
      });
      box.appendChild(sims);
    }
    box.appendChild(btn(L.experiment ? 'We did it' : 'I played with it', next, 'primary'));
    return box;
  }

  // 3. Notice
  function stepNotice() {
    var L = S.lesson, box = h('section', { class: 'el-step' });
    box.appendChild(h('p', { class: 'el-q', text: L.notice.question }));
    box.appendChild(h('textarea', { class: 'el-text', rows: '3', placeholder: 'Say or write what you saw (optional)', 'aria-label': 'What you noticed' }));
    box.appendChild(btn('Next', next, 'primary'));
    return box;
  }

  // 4. Hint ladder: the answer shows after a right pick or 3 hints.
  function stepExplain() {
    var L = S.lesson, box = h('section', { class: 'el-step' }), hintBox = h('div', { class: 'el-hints', 'aria-live': 'polite' }), wrongs = [];
    box.appendChild(h('p', { class: 'el-q', text: 'Now that you have seen it, which one really happens?' }));
    box.appendChild(h('p', { class: 'el-q-sub', text: L.predict.question }));
    function leave() { track('hints_used', { hints: S.hints }); next(); }
    function showHints() {
      hintBox.replaceChildren();
      L.hints.slice(0, S.hints).forEach(function (hh) { hintBox.appendChild(h('div', { class: 'el-hint' }, h('b', { text: 'Hint ' + hh.level + ': ' }), h('span', { text: hh.text }))); });
    }
    var opts = optionButtons(function (i, b) {
      if (i === L.predict.correctIndex) { S.solved = true; b.classList.add('right'); leave(); return; }
      wrongs.push(i); b.disabled = true; b.classList.add('wrong');
      if (S.hints < 3) S.hints++;
      showHints();
      if (S.hints >= 3) {
        var again = box.querySelector('.el-show');
        if (!again) box.appendChild(btn('Show me the answer', leave, 'el-show'));
      }
    });
    box.appendChild(opts);
    box.appendChild(hintBox);
    return box;
  }

  // 5. Name it
  function stepName() {
    var L = S.lesson, box = h('section', { class: 'el-step' });
    box.appendChild(h('div', { class: 'el-card el-reveal' },
      h('div', { class: 'el-card-title', text: 'What is going on' }), h('p', { text: L.predict.why }), h('p', { text: L.reveal.explanation }),
      h('p', { class: 'el-term' }, h('span', { text: 'The science word: ' }), h('b', { text: L.reveal.term }), h('span', { text: ' - ' + L.reveal.termMeaning }))));
    box.appendChild(btn('Next', next, 'primary'));
    return box;
  }

  // 6. Videos: an empty or failed list skips the step; no notice is shown.
  function stepVideos() {
    var box = h('section', { class: 'el-step' }), slot = h('div', { class: 'el-videos' });
    box.appendChild(slot);
    var my = token;
    if (S.videos) paintVideos(slot, S.videos); else {
      slot.appendChild(h('p', { class: 'el-loading', text: 'Finding videos...' }));
      api('/api/el/videos?concept=' + encodeURIComponent(S.lesson.id) + '&language=' + encodeURIComponent(lang())).then(function (d) { return d.videos || []; }, function () { return []; }).then(function (v) {
        if (my !== token || !S) return;
        S.videos = v;
        if (!v.length && S.step === 5) { next(); return; }      // nothing to show: go on, say nothing
        paintVideos(slot, v);
      });
    }
    box.appendChild(btn('Next: teach it back', next, 'primary'));
    return box;
  }
  window.TutpVideos = { paint: paintVideos };    // also used by the notes flow below

  var SLOT_LABEL = { user: 'In your language', english: 'In English', best: 'Best in the world' };
  function embed(id, seg, start) {
    var q = ['rel=0', 'playsinline=1'];
    var s = start != null ? start : (seg ? seg.start : null);
    if (s != null) q.push('start=' + Math.floor(s));
    if (seg && start == null) q.push('end=' + Math.floor(seg.end));
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?' + q.join('&');
  }
  function paintVideos(slot, videos) {
    slot.replaceChildren();
    if (!videos.length) return;
    slot.appendChild(h('div', { class: 'el-card-title', text: 'Videos' }));
    videos.forEach(function (v) {
      var card = h('div', { class: 'el-video', 'data-video': v.id });
      var frame = h('iframe', { class: 'el-iframe el-yt', title: v.title, src: embed(v.id, v.segment), loading: 'lazy', allow: 'encrypted-media; picture-in-picture', allowfullscreen: '', referrerpolicy: 'strict-origin-when-cross-origin' });
      var mode = v.segment ? 'key' : 'full';
      var keyBtn, fullBtn;
      function setMode(m, start) {
        mode = m;
        frame.src = m === 'key' ? embed(v.id, v.segment) : embed(v.id, null, start || 0);
        if (keyBtn) { keyBtn.setAttribute('aria-pressed', m === 'key' ? 'true' : 'false'); fullBtn.setAttribute('aria-pressed', m === 'full' ? 'true' : 'false'); }
      }
      card.appendChild(h('div', { class: 'el-slot', text: SLOT_LABEL[v.slot] || '' }));
      card.appendChild(frame);
      if (v.segment) {
        keyBtn = h('button', { type: 'button', class: 'el-seg', 'data-mode': 'key', 'aria-pressed': 'true', text: 'Key part', on: { click: function () { setMode('key'); } } });
        fullBtn = h('button', { type: 'button', class: 'el-seg', 'data-mode': 'full', 'aria-pressed': 'false', text: 'Watch full video', on: { click: function () { setMode('full', 0); } } });
        card.appendChild(h('div', { class: 'el-segs' }, keyBtn, fullBtn));
        if (v.moments && v.moments.length) {
          card.appendChild(h('div', { class: 'el-moments' }, v.moments.slice(0, 3).map(function (m) {
            return h('button', { type: 'button', class: 'el-moment', 'data-t': String(m.t), text: m.label, on: { click: function () { setMode('full', m.t); } } });
          })));
        }
      }
      // YouTube's own title link stays visible; nothing is laid over the player.
      card.appendChild(h('div', { class: 'el-yt-link' }, h('a', { href: 'https://www.youtube.com/watch?v=' + encodeURIComponent(v.id), target: '_blank', rel: 'noopener noreferrer', text: v.title }), h('span', { text: ' on YouTube' })));
      slot.appendChild(card);
    });
  }

  // 7. Teach-back
  function stepTeach() {
    var L = S.lesson, box = h('section', { class: 'el-step' });
    box.appendChild(h('p', { class: 'el-q', text: L.teachBack.prompt }));
    var ta = h('textarea', { class: 'el-text', id: 'elTeachText', rows: '4', placeholder: 'Type here, or tap the microphone and speak', 'aria-label': 'Explain in your own words' });
    var out = h('div', { class: 'el-reply', 'aria-live': 'polite' });
    var err = h('div', { class: 'el-err hidden', role: 'alert' });
    var send = btn('Send', async function () {
      var text = ta.value.trim();
      if (text.length < 3) { err.textContent = 'Please say or write a few words first.'; err.classList.remove('hidden'); return; }
      err.classList.add('hidden'); send.disabled = true; send.textContent = 'Thinking...';
      try {
        var r = await api('/api/el/teachback', { method: 'POST', body: JSON.stringify({ studentId: S.studentId, conceptId: L.id, text: text, language: lang() }) });
        out.replaceChildren(h('div', { class: 'el-card' }, h('div', { class: 'el-card-title', text: 'Tut-P asks' }), h('p', { class: 'el-follow', text: r.question })));
        if (!S.tbDone) { S.tbDone = true; track('teach_back_done', { language: lang() }); }
      } catch (e2) {
        err.textContent = e2.status === 429 ? 'Too many tries. Please wait a few minutes.' : "Couldn't make a question right now. You can still finish.";
        err.classList.remove('hidden');
        if (!S.tbDone) { S.tbDone = true; track('teach_back_done', { language: lang() }); }
      } finally { send.disabled = false; send.textContent = 'Send again'; }
    }, 'primary');
    var row = h('div', { class: 'el-row' }, send);
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      var rec = null, mic = btn('Speak', function () {
        if (rec) { rec.stop(); return; }
        rec = new SR(); rec.lang = SPEECH[lang()] || 'en-IN'; rec.interimResults = false;
        rec.onresult = function (e) { ta.value = (ta.value ? ta.value + ' ' : '') + e.results[0][0].transcript; };
        rec.onend = function () { rec = null; mic.textContent = 'Speak'; mic.setAttribute('aria-pressed', 'false'); };
        rec.onerror = function () { rec = null; mic.textContent = 'Speak'; };
        mic.textContent = 'Stop'; mic.setAttribute('aria-pressed', 'true');
        try { rec.start(); } catch (e3) { rec = null; mic.textContent = 'Speak'; }
      }, 'el-mic');
      mic.setAttribute('aria-pressed', 'false');
      row.insertBefore(mic, send);
    }
    box.appendChild(ta); box.appendChild(row); box.appendChild(err); box.appendChild(out);
    return box;
  }

  // ---------------- notes flow: videos by the typed topic ----------------
  var vids = document.getElementById('experientialModalVideos');
  function notesVideos() {
    if (!vids) return;
    vids.replaceChildren();
    var topic = (topicBox && topicBox.value || '').trim();
    if (!topic || topic.length > 80 || S && results.classList.contains('el-guided-on')) return;
    var my = ++token;
    api('/api/videos?topic=' + encodeURIComponent(topic) + '&language=' + encodeURIComponent(lang())).then(function (d) {
      if (my !== token) return;
      paintVideos(vids, d.videos || []);
    }, function () { /* nothing is shown on a failure */ });
  }

  // ---------------- reset / show-hide sync with the page ----------------
  // The observer watches the class attribute it also edits, so it acts only
  // when the hidden state really changed (setting a class always queues a
  // record, even with the same value, which would loop forever).
  var wasHidden = results.classList.contains('hidden');
  new MutationObserver(function () {
    var hiddenNow = results.classList.contains('hidden');
    if (hiddenNow === wasHidden) return;
    wasHidden = hiddenNow;
    if (hiddenNow) {
      results.classList.remove('el-guided-on'); body.classList.add('hidden'); body.replaceChildren(); S = null; token++;
      if (vids) vids.replaceChildren();
    } else if (!results.classList.contains('el-guided-on')) notesVideos();
  }).observe(results, { attributes: true, attributeFilter: ['class'] });

  // ---------------- revisit card on the parent dashboards ----------------
  (async function revisits() {
    var main = document.querySelector('main');
    if (!main || /\/app\/child\//.test(location.pathname)) return;
    try {
      var studentId = await window.tutpChildReady;
      if (!studentId) return;
      var d = await api('/api/el/revisits?studentId=' + encodeURIComponent(studentId));
      var list = (d && d.revisits) || [];
      if (!list.length) return;
      var card = h('section', { id: 'elRevisitCard', class: 'el-revisit', 'aria-label': 'Revisit questions' },
        h('div', { class: 'el-card-title', text: 'Quick revisit' }), h('p', { class: 'el-mini', text: 'A few days ago your child explored these. Ask one question at the dinner table.' }));
      list.slice(0, 3).forEach(function (r) {
        var ans = h('p', { class: 'el-ans hidden', text: 'Answer: ' + r.answer });
        card.appendChild(h('div', { class: 'el-rev-item', 'data-concept': r.conceptId, 'data-day': String(r.day) },
          h('div', { class: 'el-rev-topic', text: r.title + ' (day ' + r.day + ')' }), h('p', { class: 'el-q', text: r.question }), ans,
          h('div', { class: 'el-row' },
            btn('Show answer', function (e) { ans.classList.toggle('hidden'); e.target.textContent = ans.classList.contains('hidden') ? 'Show answer' : 'Hide answer'; }),
            btn('We did this', function () {
              fetch('/api/el/event', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'revisit_done', studentId: studentId, conceptId: r.conceptId, day: r.day }) }).catch(function () {});
              card.querySelector('[data-concept="' + r.conceptId + '"][data-day="' + r.day + '"]').remove();
              if (!card.querySelector('.el-rev-item')) card.remove();
            }))));
      });
      main.insertBefore(card, main.firstChild);
    } catch (e) { /* a revisit card is optional */ }
  })();
})();
