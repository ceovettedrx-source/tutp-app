/*
 * tutp-pointer.js — Tut-P visual tutor overlay ("point and explain").
 * Framework-free: works in the existing plain HTML + Tailwind pages.
 *
 * Two anchor kinds:
 *   element -> a DOM node tagged during snapshot (data-tutp-ref="e7")
 *   image   -> a box on a homework photo, normalized 0..1000 against the image
 * Both are re-resolved every animation frame, so drawings stay glued to
 * their target while the parent scrolls, zooms, or rotates the phone.
 *
 * Public API (window.TutPointer):
 *   snapshotUI(root?)            -> [{ref, role, text, rect}]  (for mode "ui")
 *   prepareImage(imgEl, maxEdge) -> {base64, mediaType, width, height} (mode "image")
 *   play(instructions, ctx)      -> Promise, draws steps in sequence
 *   clear()
 */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const TONES = {
    info:    { stroke: '#005bbf', fill: 'rgba(0,91,191,0.10)' },
    mistake: { stroke: '#d93025', fill: 'rgba(217,48,37,0.10)' },
    correct: { stroke: '#188038', fill: 'rgba(24,128,56,0.10)' },
  };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let svg = null;
  let live = [];          // [{step, nodes, ctx}]
  let rafId = null;
  let refCounter = 0;

  // ---------- overlay root ----------
  function ensureOverlay() {
    if (svg) return svg;
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    Object.assign(svg.style, {
      position: 'fixed', inset: '0', width: '100vw', height: '100vh',
      pointerEvents: 'none',          // never blocks taps on the real UI
      zIndex: '2147483000', overflow: 'visible',
    });
    svg.innerHTML =
      '<defs>' +
      Object.entries(TONES).map(([k, t]) =>
        `<marker id="tutp-head-${k}" viewBox="0 0 10 10" refX="8" refY="5"
           markerWidth="7" markerHeight="7" orient="auto-start-reverse">
           <path d="M0,0 L10,5 L0,10 z" fill="${t.stroke}"/></marker>`).join('') +
      '</defs>';
    document.body.appendChild(svg);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') clear(); });
    return svg;
  }

  // ---------- UI snapshot (mode "ui") ----------
  const SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], ' +
                   'label, h1, h2, h3, [data-tutp-label]';

  function snapshotUI(root = document.body) {
    const out = [];
    const vw = window.innerWidth, vh = window.innerHeight;
    root.querySelectorAll(SELECTOR).forEach((el) => {
      if (el.closest('[data-tutp-private]')) return;     // child data never leaves the device
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return;

      if (!el.dataset.tutpRef) el.dataset.tutpRef = 'e' + (++refCounter);
      out.push({
        ref: el.dataset.tutpRef,
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        // Labels only — never input values (could be names/phone numbers).
        text: (el.dataset.tutpLabel || el.getAttribute('aria-label') ||
               el.getAttribute('placeholder') || el.innerText || '')
               .replace(/\s+/g, ' ').trim().slice(0, 80),
        rect: [r.left, r.top, r.width, r.height].map(Math.round),
      });
    });
    return out.slice(0, 120);   // cap prompt size
  }

  // ---------- image prep (mode "image") ----------
  // Downscale before upload: cheaper tokens, and vision models point more
  // accurately on images that are not resized again server-side.
  function prepareImage(imgEl, maxEdge = 1280) {
    const w0 = imgEl.naturalWidth, h0 = imgEl.naturalHeight;
    const s = Math.min(1, maxEdge / Math.max(w0, h0));
    const w = Math.round(w0 * s), h = Math.round(h0 * s);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(imgEl, 0, 0, w, h);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', width: w, height: h };
  }

  // ---------- anchor resolution ----------
  // Rendered content box of an <img>, honoring object-fit: contain/cover.
  function imageContentRect(img) {
    const r = img.getBoundingClientRect();
    const fit = getComputedStyle(img).objectFit;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih || (fit !== 'contain' && fit !== 'cover')) return r;
    const scale = fit === 'contain' ? Math.min(r.width / iw, r.height / ih)
                                    : Math.max(r.width / iw, r.height / ih);
    const w = iw * scale, h = ih * scale;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  }

  // Returns a viewport rect {x, y, w, h} or null if the target is gone.
  function resolve(target, ctx) {
    if (!target) return null;
    if (target.kind === 'element') {
      const el = document.querySelector(`[data-tutp-ref="${CSS.escape(target.ref)}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    if (target.kind === 'image' && ctx && ctx.imageEl) {
      const r = imageContentRect(ctx.imageEl);
      const [x1, y1, x2, y2] = target.box;                 // 0..1000
      return {
        x: r.left + (x1 / 1000) * r.width,
        y: r.top + (y1 / 1000) * r.height,
        w: ((x2 - x1) / 1000) * r.width,
        h: ((y2 - y1) / 1000) * r.height,
      };
    }
    return null;
  }

  // ---------- shape builders ----------
  function el(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function buildNodes(step) {
    const tone = TONES[step.tone] || TONES.info;
    const g = el('g', { class: 'tutp-step', opacity: '0' });
    const nodes = { g };

    if (step.type === 'box' || step.type === 'highlight') {
      nodes.rect = el('rect', {
        rx: step.type === 'highlight' ? 4 : 10,
        fill: step.type === 'highlight' ? tone.fill.replace('0.10', '0.28') : tone.fill,
        stroke: step.type === 'highlight' ? 'none' : tone.stroke,
        'stroke-width': 3,
      });
      g.appendChild(nodes.rect);
    }
    if (step.type === 'underline') {
      nodes.line = el('path', { fill: 'none', stroke: tone.stroke, 'stroke-width': 4, 'stroke-linecap': 'round' });
      g.appendChild(nodes.line);
    }
    if (step.type === 'arrow' || step.type === 'point') {
      nodes.line = el('path', {
        fill: 'none', stroke: tone.stroke, 'stroke-width': 4, 'stroke-linecap': 'round',
        'marker-end': `url(#tutp-head-${step.tone in TONES ? step.tone : 'info'})`,
      });
      g.appendChild(nodes.line);
    }
    if (step.label) {
      nodes.labelBg = el('rect', { rx: 8, fill: tone.stroke });
      nodes.label = el('text', {
        fill: '#fff', 'font-size': 15, 'font-weight': 600,
        'font-family': '"Plus Jakarta Sans", "Noto Sans Telugu", "Noto Sans Devanagari", system-ui, sans-serif',
      });
      nodes.label.textContent = step.label;
      g.append(nodes.labelBg, nodes.label);
    }
    return nodes;
  }

  // Curved arrow: starts just above the target (slightly to the side) so it
  // never covers it, and lands on the middle of the facing edge — ending on a
  // corner made it look like it pointed at the neighbouring button.
  function arrowPath(to, from) {
    const tx = to.x + to.w / 2, ty = to.y + to.h / 2;
    const fx = from ? from.x + from.w / 2 : (tx > window.innerWidth / 2 ? tx - 40 : tx + 40);
    // No room above (target near the top) -> start below instead.
    const fy = from ? from.y + from.h / 2
                    : (to.y - 100 >= 24 ? to.y - 100 : to.y + to.h + 100);
    const dx = fx - tx, dy = fy - ty;
    // Compare offsets relative to the target's size, so a wide button is
    // approached from above/below unless the start is far off to the side.
    let ex, ey;
    if (Math.abs(dy) * to.w > Math.abs(dx) * to.h) {
      ex = tx; ey = dy < 0 ? to.y - 6 : to.y + to.h + 6;
    } else {
      ex = dx < 0 ? to.x - 6 : to.x + to.w + 6; ey = ty;
    }
    const cx = (fx + ex) / 2 + (fy - ey) * 0.25, cy = (fy + ey) / 2 - (fx - ex) * 0.25;
    return { d: `M${fx},${fy} Q${cx},${cy} ${ex},${ey}`, start: { x: fx, y: fy } };
  }

  // ---------- label avoidance (local only) ----------
  // Rects of anything visible the label shouldn't cover. Unlike snapshotUI()
  // this includes plain text and [data-tutp-private] content, assigns no refs,
  // and only ever returns geometry — it is never sent to the server.
  const OBSTACLE_SELECTOR = 'p, span, div, label, a, h1, h2, h3, h4, h5, h6, li, td, th, ' +
                            'button, [role="button"], input, select, textarea, img';
  const TEXT_ONLY = new Set(['P', 'SPAN', 'DIV']);

  function hasDirectText(node) {
    for (const c of node.childNodes) {
      if (c.nodeType === Node.TEXT_NODE && c.nodeValue.trim()) return true;
    }
    return false;
  }

  function obstacleRects() {
    const out = [];
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const node of document.body.querySelectorAll(OBSTACLE_SELECTOR)) {
      if (TEXT_ONLY.has(node.tagName) && !hasDirectText(node)) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      out.push([r.left, r.top, r.width, r.height]);
      if (out.length >= 500) break;
    }
    return out;
  }

  // layout() runs every frame, so re-collect at most every 250ms.
  let obstacles = [], obstaclesAt = 0;
  function uiObstacles() {
    const now = performance.now();
    if (now - obstaclesAt > 250) {
      obstacles = obstacleRects();
      obstaclesAt = now;
    }
    return obstacles;
  }

  function layout(item) {
    const { step, nodes, ctx } = item;
    const r = resolve(step.target, ctx);
    if (!r) { nodes.g.setAttribute('display', 'none'); return; }
    nodes.g.removeAttribute('display');
    const pad = 6;
    let labelAt = { x: r.x, y: r.y - 12 };

    if (nodes.rect) {
      Object.entries({ x: r.x - pad, y: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2 })
        .forEach(([k, v]) => nodes.rect.setAttribute(k, v));
    }
    if (step.type === 'underline') {
      const y = r.y + r.h + 4;
      nodes.line.setAttribute('d', `M${r.x},${y} Q${r.x + r.w / 2},${y + 5} ${r.x + r.w},${y}`);
      labelAt = { x: r.x, y: y + 28 };
    }
    if (step.type === 'arrow' || step.type === 'point') {
      const from = step.from ? resolve(step.from, ctx) : null;
      const a = arrowPath(r, from);
      nodes.line.setAttribute('d', a.d);
      labelAt = { x: a.start.x - 10, y: a.start.y - 12 };
    }
    if (nodes.label) {
      const bb = nodes.label.getBBox();
      const x = Math.min(Math.max(8, labelAt.x), window.innerWidth - bb.width - 20);
      let y = Math.min(Math.max(28, labelAt.y), window.innerHeight - 12);
      // Box spans [y - bb.height + 2, y + 12]. Push it up above any UI element
      // it overlaps; give up at the top of the viewport rather than go off-screen.
      // Skip anything that fully contains the target (the homework photo in
      // image mode, or a wrapping container) — dodging it would push the label
      // clear of the whole photo, far from the box it describes.
      const bw = bb.width + 20;
      const rects = uiObstacles().filter(([rx, ry, rw, rh]) =>
        !(rx <= r.x && ry <= r.y && rx + rw >= r.x + r.w && ry + rh >= r.y + r.h));
      for (let i = 0; i < 20; i++) {
        const top = y - bb.height + 2, bottom = y + 12;
        const hit = rects.find(([rx, ry, rw, rh]) =>
          x < rx + rw && x + bw > rx && top < ry + rh && bottom > ry);
        if (!hit) break;
        const next = hit[1] - 16;
        if (next < 28) break;
        y = next;
      }
      nodes.label.setAttribute('x', x + 10);
      nodes.label.setAttribute('y', y);
      Object.entries({ x, y: y - bb.height + 2, width: bw, height: bb.height + 10 })
        .forEach(([k, v]) => nodes.labelBg.setAttribute(k, v));
      // The label may have moved to dodge UI; restart the arrow from its
      // bottom-center so the two stay connected. An explicit step.from wins.
      if ((step.type === 'arrow' || step.type === 'point') && !step.from) {
        const a = arrowPath(r, { x: x + bw / 2, y: y + 12, w: 0, h: 0 });
        nodes.line.setAttribute('d', a.d);
      }
    }
  }

  function tick() {
    live.forEach(layout);
    rafId = live.length ? requestAnimationFrame(tick) : null;
  }

  function animateIn(nodes) {
    nodes.g.style.transition = reduceMotion ? 'none' : 'opacity 220ms ease-out';
    nodes.g.setAttribute('opacity', '1');
    if (nodes.line && !reduceMotion) {
      const len = nodes.line.getTotalLength();
      nodes.line.style.strokeDasharray = len;
      nodes.line.style.strokeDashoffset = len;
      nodes.line.getBoundingClientRect();              // force reflow
      nodes.line.style.transition = 'stroke-dashoffset 450ms ease-out';
      nodes.line.style.strokeDashoffset = '0';
    }
  }

  // Scroll the first target into view so the parent actually sees it.
  function scrollIntoViewIfNeeded(step, ctx) {
    const r = resolve(step.target, ctx);
    if (!r) return;
    if (r.y < 60 || r.y + r.h > window.innerHeight - 40) {
      window.scrollBy({ top: r.y - window.innerHeight / 3, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }

  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  // ---------- public ----------
  async function play(instructions, ctx = {}) {
    clear();
    ensureOverlay();
    const steps = (instructions && instructions.steps) || [];
    if (steps[0]) { scrollIntoViewIfNeeded(steps[0], ctx); await wait(reduceMotion ? 0 : 350); }

    for (const step of steps) {
      const nodes = buildNodes(step);
      svg.appendChild(nodes.g);
      const item = { step, nodes, ctx };
      live.push(item);
      layout(item);
      if (!rafId) rafId = requestAnimationFrame(tick);
      animateIn(nodes);
      if (typeof ctx.onStep === 'function') ctx.onStep(step);   // e.g. speak step.say via TTS
      await wait(reduceMotion ? 300 : Math.max(900, step.hold_ms || 1400));
    }
    if (ctx.autoClearMs) setTimeout(clear, ctx.autoClearMs);
  }

  function clear() {
    live = [];
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (svg) svg.querySelectorAll('.tutp-step').forEach((n) => n.remove());
  }

  window.TutPointer = { snapshotUI, prepareImage, play, clear };
})();
