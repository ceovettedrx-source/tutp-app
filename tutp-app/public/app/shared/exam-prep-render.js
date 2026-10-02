/* exam-prep-render.js — draws one exam prep note (round 4). Used by the
   parent dashboards' chapter page (exam-prep.js) and by the founder's
   review page (/admin/exam-prep), so the preview there is exactly what
   parents see. Text goes in through textContent only; the mind map SVG is
   built and escaped by the server (server/mind-map-svg.js).

   TutpExamPrepRender.render(container, mode, note, hooks)
     note: { content } or { svg } (mind map)
     hooks.onFlashcard(), hooks.onQuestion(): called when the child answers. */
(function () {
  var TAGS = { logical_reasoning: 'Logical reasoning', understanding: 'Understanding', application: 'Application', skill_based: 'Skill based' };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function list(items) {
    var ul = el('ul');
    (items || []).forEach(function (t) { ul.appendChild(el('li', null, t)); });
    return ul;
  }

  function revision(c) {
    var f = document.createDocumentFragment();
    if (c.title) f.appendChild(el('h3', null, c.title));
    if (c.intro) f.appendChild(el('p', null, c.intro));
    (c.sections || []).forEach(function (s) {
      f.appendChild(el('h3', null, s.heading));
      f.appendChild(list(s.points));
      if (s.example) f.appendChild(el('div', 'ep-example', s.example));
    });
    if (c.remember && c.remember.length) {
      var r = el('div', 'ep-remember');
      r.appendChild(el('strong', null, '★'));
      r.appendChild(list(c.remember));
      f.appendChild(r);
    }
    return f;
  }

  function keyPoints(c) {
    var f = document.createDocumentFragment();
    var grid = el('div', 'ep-kp');
    (c.points || []).forEach(function (p) {
      var item = el('div', 'ep-kp__item');
      item.appendChild(el('strong', null, p.heading));
      item.appendChild(el('span', null, p.text));
      grid.appendChild(item);
    });
    f.appendChild(grid);
    if (c.formulas && c.formulas.length) {
      f.appendChild(el('h3', null, 'Formula sheet'));
      c.formulas.forEach(function (x) {
        var row = el('div', 'ep-formula');
        row.appendChild(el('div', null, x.label));
        row.appendChild(el('code', null, x.rule));
        if (x.example) row.appendChild(el('div', 'ep-expl', x.example));
        f.appendChild(row);
      });
    }
    return f;
  }

  function flashcards(c, hooks) {
    var cards = c.cards || [];
    var i = 0, back = false;
    var wrap = el('div');
    var card = el('button', 'ep-card');
    card.type = 'button';
    var hint = el('p', 'ep-expl', 'Tap the card to see the answer.');
    var nav = el('div', 'ep-card-nav');
    var count = el('span', 'ep-count');
    var knew = el('button', 'dc-btn dc-btn--blue', 'I knew it');
    var notYet = el('button', 'dc-btn dc-btn--outline', 'Not yet');
    knew.type = notYet.type = 'button';
    function show() {
      var x = cards[i] || {};
      card.textContent = back ? x.back : x.front;
      card.classList.toggle('ep-card--back', back);
      count.textContent = (i + 1) + ' / ' + cards.length;
      knew.disabled = notYet.disabled = !back;
    }
    function next() {
      if (hooks && hooks.onFlashcard) hooks.onFlashcard();
      i = (i + 1) % cards.length;
      back = false;
      show();
    }
    card.addEventListener('click', function () { back = !back; show(); });
    knew.addEventListener('click', next);
    notYet.addEventListener('click', next);
    nav.appendChild(count);
    var btns = el('span');
    btns.style.display = 'inline-flex';
    btns.style.gap = '8px';
    btns.appendChild(notYet);
    btns.appendChild(knew);
    nav.appendChild(btns);
    wrap.appendChild(card);
    wrap.appendChild(hint);
    wrap.appendChild(nav);
    show();
    return wrap;
  }

  function practice(c, hooks) {
    var f = document.createDocumentFragment();
    (c.questions || []).forEach(function (q, n) {
      var box = el('div', 'ep-q');
      if (TAGS[q.tag]) box.appendChild(el('span', 'ep-q__tag', TAGS[q.tag]));
      box.appendChild(el('div', null, (n + 1) + '. ' + q.question));
      var expl = el('div', 'ep-expl');
      var done = false;
      function reveal() {
        if (done) return;
        done = true;
        expl.textContent = q.answer + (q.explanation ? ' — ' + q.explanation : '');
        if (hooks && hooks.onQuestion) hooks.onQuestion();
      }
      if (q.type === 'mcq' && q.options) {
        var opts = el('div', 'ep-opts');
        q.options.forEach(function (o, k) {
          var b = el('button', 'ep-opt', '(' + 'ABCD'[k] + ') ' + o);
          b.type = 'button';
          b.addEventListener('click', function () {
            if (done) return;
            b.classList.add(o === q.answer ? 'ep-opt--right' : 'ep-opt--wrong');
            Array.prototype.forEach.call(opts.children, function (x, j) { if (q.options[j] === q.answer) x.classList.add('ep-opt--right'); });
            reveal();
          });
          opts.appendChild(b);
        });
        box.appendChild(opts);
      } else {
        var show = el('button', 'dc-link', 'Show the answer');
        show.type = 'button';
        show.addEventListener('click', function () { show.remove(); reveal(); });
        box.appendChild(show);
      }
      box.appendChild(expl);
      f.appendChild(box);
    });
    return f;
  }

  function render(container, mode, note, hooks) {
    container.replaceChildren();
    if (mode === 'mind_map') {
      var m = el('div', 'ep-map');
      m.innerHTML = note.svg || '';
      container.appendChild(m);
      return;
    }
    var c = note.content || {};
    if (mode === 'revision_notes') container.appendChild(revision(c));
    else if (mode === 'key_points') container.appendChild(keyPoints(c));
    else if (mode === 'flashcards') container.appendChild(flashcards(c, hooks));
    else if (mode === 'practice_questions') container.appendChild(practice(c, hooks));
  }

  window.TutpExamPrepRender = { render: render, el: el };
})();
