/* TUT-66 Watch & Learn: "Watch & Learn" card under lesson results (Answer, Explain, Notes, Story).
   window.TutpWatchLearn.mount(host, { studentId, lesson, subject, language })
   - Asks /api/watch-learn once. No videos, any error, no lesson title: nothing is added (no empty box).
   - Thumbnail + title + channel. The YouTube player (youtube-nocookie) is created only on a tap.
   - Free families get 1 video; the others are blurred placeholders with "Unlock with Pro"
     (the plan chooser of billing.js). No id of a locked video ever reaches the page.
   - "Not right for this lesson" hides that video for that lesson for everyone (server row).
   Text only through textContent; thumbnails only from YouTube's image host or this site. */
(function () {
  'use strict';
  var CSS = '/css/watch-learn.css';
  var PLACEHOLDER = '/images/video-placeholder.svg';
  var cssAdded = false;

  function addCss() {
    if (cssAdded) return;
    cssAdded = true;
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = CSS;
    document.head.appendChild(l);
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function safeThumb(u) {
    return /^https:\/\/i[0-9]?\.ytimg\.com\//.test(String(u || '')) || /^\/images\//.test(String(u || '')) ? u : PLACEHOLDER;
  }
  function icon() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', '#005bbf');
    s.setAttribute('stroke-width', '1.5'); s.setAttribute('aria-hidden', 'true');
    var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', '3'); r.setAttribute('y', '5'); r.setAttribute('width', '18'); r.setAttribute('height', '14'); r.setAttribute('rx', '3');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M10 9.5 L15 12 L10 14.5 Z'); p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(r); s.appendChild(p);
    return s;
  }
  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {})).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  function videoItem(v, ctx, onGone) {
    var li = el('li', 'wl-item');
    li.setAttribute('data-video', v.id);
    var play = el('button', 'wl-play');
    play.type = 'button';
    play.setAttribute('aria-label', 'Play: ' + v.title);
    var thumb = el('span', 'wl-thumb');
    var img = el('img');
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = safeThumb(v.thumb);
    img.onerror = function () { img.onerror = null; img.src = PLACEHOLDER; };
    thumb.appendChild(img); thumb.appendChild(el('span', 'wl-ring'));
    var meta = el('span', 'wl-meta');
    meta.appendChild(el('span', 'wl-vtitle', v.title));
    meta.appendChild(el('span', 'wl-channel', v.channel));
    play.appendChild(thumb); play.appendChild(meta);
    play.addEventListener('click', function () {
      // The player exists only after this tap.
      var f = el('iframe', 'wl-frame');
      f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(v.id) + '?rel=0&playsinline=1&autoplay=1';
      f.title = v.title;
      f.allow = 'encrypted-media; picture-in-picture; autoplay';
      f.setAttribute('allowfullscreen', '');
      f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      li.replaceChild(f, play);
    });
    li.appendChild(play);
    var rep = el('button', 'wl-report', 'Not right for this lesson');
    rep.type = 'button';
    rep.addEventListener('click', function () {
      rep.disabled = true;
      api('/api/watch-learn/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: ctx.studentId, lesson: ctx.lesson, subject: ctx.subject, language: ctx.language, videoId: v.id }),
      }).then(function () {
        li.replaceChildren(el('div', 'wl-done', 'Thank you. This video will not be shown for this lesson.'));
        li.setAttribute('data-reported', '1');
        if (onGone) onGone();
      }, function () { rep.disabled = false; });
    });
    li.appendChild(rep);
    return li;
  }

  function lockedItem(ctx) {
    var li = el('li', 'wl-item wl-locked');
    li.setAttribute('data-locked', '1');
    var thumb = el('span', 'wl-thumb');
    var img = el('img'); img.alt = ''; img.src = PLACEHOLDER; thumb.appendChild(img);
    var meta = el('span', 'wl-meta');
    meta.appendChild(el('span', 'wl-vtitle', 'More videos on this lesson'));
    meta.appendChild(el('span', 'wl-channel', 'Pro'));
    li.appendChild(thumb); li.appendChild(meta);
    var b = el('button', 'wl-unlock');
    b.type = 'button';
    b.appendChild(el('span', null, 'Unlock with Pro'));
    b.addEventListener('click', function () {
      if (window.TutpBilling && window.TutpBilling.choosePlan) window.TutpBilling.choosePlan(ctx.studentId);
      else if (window.alert) window.alert('Pro is bought from a parent\'s dashboard.');
    });
    li.appendChild(b);
    return li;
  }

  function mount(host, opts) {
    try {
      var ctx = {
        studentId: (opts && opts.studentId) || '', lesson: String((opts && opts.lesson) || '').trim(),
        subject: String((opts && opts.subject) || '').trim(), language: (opts && opts.language) || 'English',
      };
      if (!host || !ctx.studentId || ctx.lesson.length < 3) return Promise.resolve(false);
      var old = host.querySelector('.wl-root');
      if (old) old.remove();
      var qs = 'studentId=' + encodeURIComponent(ctx.studentId) + '&lesson=' + encodeURIComponent(ctx.lesson) +
        '&subject=' + encodeURIComponent(ctx.subject) + '&language=' + encodeURIComponent(ctx.language);
      return api('/api/watch-learn?' + qs).then(function (d) {
        var videos = (d && d.videos) || [];
        if (!videos.length) return false;
        addCss();
        var root = el('section', 'wl-root');
        root.setAttribute('aria-label', 'Watch & Learn');
        var h = el('h3', 'wl-title'); h.appendChild(icon()); h.appendChild(el('span', null, 'Watch & Learn'));
        root.appendChild(h);
        var list = el('ul', 'wl-list');
        var left = videos.length;
        function gone() { left -= 1; if (left <= 0 && !list.querySelector('[data-locked]')) root.remove(); }
        videos.forEach(function (v) { list.appendChild(videoItem(v, ctx, gone)); });
        for (var i = 0; i < Math.min(Number(d.locked) || 0, 4); i++) list.appendChild(lockedItem(ctx));
        root.appendChild(list);
        host.appendChild(root);
        return true;
      }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  window.TutpWatchLearn = { mount: mount };
})();
