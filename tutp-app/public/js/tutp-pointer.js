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
      // Fallback when no arrow route is clear: a ring around the target.
      nodes.ring = el('rect', { rx: 12, fill: 'none', stroke: tone.stroke, 'stroke-width': 3, display: 'none' });
      Object.assign(nodes.ring.style, { transformBox: 'fill-box', transformOrigin: 'center' });
      g.appendChild(nodes.ring);
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
    return { d: `M${fx},${fy} Q${cx},${cy} ${ex},${ey}`, start: { x: fx, y: fy }, end: { x: ex, y: ey } };
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

  // ---------- candidate label placement ----------
  const GAP = 40;
  const LINE_WEIGHT = 12;   // penalty per px of arrow crossing an obstacle
  // [dx, dy]: -1 = left/above, 0 = centered, 1 = right/below. Order matters:
  // the first overlap-free candidate wins.
  const CANDIDATES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

  function candidateBox(r, [dx, dy], w, h) {
    const x = dx < 0 ? r.x - GAP - w : dx > 0 ? r.x + r.w + GAP : r.x + r.w / 2 - w / 2;
    const y = dy < 0 ? r.y - GAP - h : dy > 0 ? r.y + r.h + GAP : r.y + r.h / 2 - h / 2;
    return {
      x: Math.min(Math.max(8, x), window.innerWidth - w - 8),
      y: Math.min(Math.max(8, y), window.innerHeight - h - 8),
      w, h,
    };
  }

  function overlapArea(b, [rx, ry, rw, rh]) {
    const w = Math.min(b.x + b.w, rx + rw) - Math.max(b.x, rx);
    const h = Math.min(b.y + b.h, ry + rh) - Math.max(b.y, ry);
    return w > 0 && h > 0 ? w * h : 0;
  }

  // Length of segment p->q inside a rect (Liang-Barsky clip).
  function segmentInside(p, q, [rx, ry, rw, rh]) {
    const dx = q.x - p.x, dy = q.y - p.y;
    let t0 = 0, t1 = 1;
    for (const [pk, qk] of [[-dx, p.x - rx], [dx, rx + rw - p.x], [-dy, p.y - ry], [dy, ry + rh - p.y]]) {
      if (pk === 0) { if (qk < 0) return 0; continue; }
      const t = qk / pk;
      if (pk < 0) { if (t > t1) return 0; if (t > t0) t0 = t; }
      else { if (t < t0) return 0; if (t < t1) t1 = t; }
    }
    return (t1 - t0) * Math.hypot(dx, dy);
  }

  // Midpoint of the label edge closest to the target's center.
  function nearestEdgePoint(b, r) {
    const tx = r.x + r.w / 2, ty = r.y + r.h / 2;
    const d = (p) => Math.hypot(p.x - tx, p.y - ty);
    return [
      { x: b.x + b.w / 2, y: b.y }, { x: b.x + b.w / 2, y: b.y + b.h },
      { x: b.x, y: b.y + b.h / 2 }, { x: b.x + b.w, y: b.y + b.h / 2 },
    ].reduce((a, p) => (d(p) < d(a) ? p : a));
  }

  // Scores all candidates; returns {i, box, start, overlap}. `prev` (the last
  // pick) is kept while it stays clear so the label doesn't hop while scrolling.
  function placeLabel(r, w, h, withArrow, prev) {
    // Skip anything that fully contains the target (the homework photo, a
    // wrapping container) — dodging it would push the label far from the
    // target — and anything inside the target, which the padded target covers.
    const around = ([x, y, ow, oh]) => x <= r.x && y <= r.y && x + ow >= r.x + r.w && y + oh >= r.y + r.h;
    const inside = ([x, y, ow, oh]) => x >= r.x - 1 && y >= r.y - 1 && x + ow <= r.x + r.w + 1 && y + oh <= r.y + r.h + 1;
    const rects = uiObstacles().filter((o) => !around(o) && !inside(o));
    const labelRects = rects.concat([[r.x - 6, r.y - 6, r.w + 12, r.h + 12]]);
    const tx = r.x + r.w / 2, ty = r.y + r.h / 2;

    const scored = CANDIDATES.map((c, i) => {
      const box = candidateBox(r, c, w, h);
      let overlap = labelRects.reduce((s, o) => s + overlapArea(box, o), 0);
      let start = null;
      if (withArrow) {
        start = nearestEdgePoint(box, r);
        const end = arrowPath(r, { x: start.x, y: start.y, w: 0, h: 0 }).end;
        overlap += LINE_WEIGHT * rects.reduce((s, o) => s + segmentInside(start, end, o), 0);
      }
      const dist = Math.hypot(box.x + w / 2 - tx, box.y + h / 2 - ty);
      return { i, box, start, overlap, score: overlap + dist };
    });
    const clear = (s) => s.overlap < 1;
    if (prev != null && clear(scored[prev])) return scored[prev];
    return scored.find(clear) || scored.reduce((a, b) => (b.score < a.score ? b : a));
  }

  // Ring follows the target every frame; pulses twice when it first appears.
  function setRing(nodes, r, on) {
    const ring = nodes.ring;
    const hidden = ring.getAttribute('display') === 'none';
    if (!on) { if (!hidden) ring.setAttribute('display', 'none'); return; }
    const pad = 10;
    Object.entries({ x: r.x - pad, y: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2 })
      .forEach(([k, v]) => ring.setAttribute(k, v));
    if (!hidden) return;
    ring.removeAttribute('display');
    if (!reduceMotion && ring.animate) {
      ring.animate([
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(1.15)', opacity: 0.3 },
        { transform: 'scale(1)', opacity: 1 },
      ], { duration: 700, iterations: 2, easing: 'ease-in-out' });
    }
  }

  function layout(item) {
    const { step, nodes, ctx } = item;
    const r = resolve(step.target, ctx);
    if (!r) { nodes.g.setAttribute('display', 'none'); return; }
    nodes.g.removeAttribute('display');
    const pad = 6;

    if (nodes.rect) {
      Object.entries({ x: r.x - pad, y: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2 })
        .forEach(([k, v]) => nodes.rect.setAttribute(k, v));
    }
    if (step.type === 'underline') {
      const y = r.y + r.h + 4;
      nodes.line.setAttribute('d', `M${r.x},${y} Q${r.x + r.w / 2},${y + 5} ${r.x + r.w},${y}`);
    }
    const isArrow = step.type === 'arrow' || step.type === 'point';
    if (isArrow) {
      const from = step.from ? resolve(step.from, ctx) : null;
      nodes.line.setAttribute('d', arrowPath(r, from).d);
    }
    if (nodes.label) {
      const bb = nodes.label.getBBox();
      const bw = bb.width + 20, bh = bb.height + 10;
      // An explicit step.from owns the arrow; otherwise it runs label -> target.
      const autoArrow = isArrow && !step.from;
      const pick = placeLabel(r, bw, bh, autoArrow, item.pick);
      item.pick = pick.i;
      const { x, y } = pick.box;
      nodes.label.setAttribute('x', x + 10);
      nodes.label.setAttribute('y', y + bb.height - 2);   // text baseline
      Object.entries({ x, y, width: bw, height: bh })
        .forEach(([k, v]) => nodes.labelBg.setAttribute(k, v));
      if (autoArrow) {
        // No clear route: skip the arrow rather than cross other UI.
        const blocked = pick.overlap >= 1;
        if (blocked) {
          nodes.line.setAttribute('display', 'none');
        } else {
          nodes.line.removeAttribute('display');
          nodes.line.setAttribute('d', arrowPath(r, { x: pick.start.x, y: pick.start.y, w: 0, h: 0 }).d);
        }
        setRing(nodes, r, blocked);
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
    if (nodes.line && !reduceMotion && nodes.line.getAttribute('display') !== 'none') {
      const len = nodes.line.getTotalLength();
      // The path changes as the label moves; drop the dash once drawn so a
      // longer path later isn't clipped at the original length.
      nodes.line.addEventListener('transitionend', () => {
        nodes.line.style.strokeDasharray = '';
        nodes.line.style.strokeDashoffset = '';
      }, { once: true });
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
