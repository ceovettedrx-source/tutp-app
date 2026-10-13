// The child's bar-model builder (TUT-43 spec section 2, step 2). Plain DOM, no library.
//   const b = createBuilder(host, { kind, bars, unit, maxUnits, labelOptions, t });
//   b.getBuilt()  -> { bars: [{ segments: [{ units, shaded?, label? }] }] }
//   b.destroy()
// Every size can be set with taps only (the − / + steppers and "Split into N parts"),
// so a phone never needs a precise drag; the drag handles are a shortcut on top.
// Every control is at least 44 x 44 px. Arrow keys move a focused handle.
const MIN_PARTS = 2, MAX_PARTS = 4, MAX_SPLIT = 12;

export function createBuilder(host, { kind, bars: names, unit, maxUnits = 20, labelOptions = [], t }) {
  const state = {
    bars: names.map(() => ({ segments: [] })),
  };
  if (kind === 'parts') state.bars[0].segments = [{ units: 2, label: '' }, { units: 2, label: '' }];
  if (kind === 'lengths') state.bars.forEach((b) => { b.segments = [{ units: 3, label: '' }]; });
  if (kind === 'fraction') state.bars[0].segments = [{ units: 1, shaded: false }];
  if (kind === 'units') state.bars.forEach((b) => { b.segments = [{ units: 1 }]; });

  const root = document.createElement('div');
  root.className = 'sgb';
  host.replaceChildren(root);
  const gridUnits = kind === 'units' ? MAX_SPLIT : maxUnits;

  const used = (bar) => bar.segments.reduce((s, g) => s + g.units, 0);
  const btn = (text, label, onClick, cls = 'sgb-btn') => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = text;
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  };
  const labelSelect = (value, onChange, aria) => {
    const s = document.createElement('select');
    s.className = 'sgb-select';
    s.setAttribute('aria-label', aria);
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = t('build.label');
    s.appendChild(blank);
    for (const o of labelOptions) {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      s.appendChild(opt);
    }
    s.value = value || '';
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };

  function render() {
    root.replaceChildren();
    if (kind !== 'fraction' && kind !== 'units') {
      const note = document.createElement('p');
      note.className = 'sgb-note';
      note.textContent = '1 □ = ' + unit;
      root.appendChild(note);
    }
    state.bars.forEach((bar, bi) => {
      const row = document.createElement('div');
      row.className = 'sgb-row';
      const name = document.createElement('div');
      name.className = 'sgb-name';
      name.textContent = names[bi] || '';
      row.appendChild(name);

      const track = document.createElement('div');
      track.className = 'sgb-track';
      track.style.setProperty('--cells', String(gridUnits));
      let offset = 0;
      bar.segments.forEach((seg, si) => {
        const el = document.createElement(kind === 'fraction' ? 'button' : 'div');
        el.className = 'sgb-seg' + (seg.shaded ? ' is-shaded' : '');
        const width = kind === 'fraction' ? 100 / bar.segments.length : (seg.units / gridUnits) * 100;
        el.style.left = (kind === 'fraction' ? si * width : (offset / gridUnits) * 100) + '%';
        el.style.width = width + '%';
        if (kind === 'fraction') {
          el.type = 'button';
          el.setAttribute('aria-pressed', seg.shaded ? 'true' : 'false');
          el.setAttribute('aria-label', t('build.shade_hint') + ' ' + (si + 1));
          el.addEventListener('click', () => { seg.shaded = !seg.shaded; render(); });
        } else if (seg.label) {
          el.textContent = seg.label;
        }
        track.appendChild(el);
        if (kind === 'parts' || kind === 'lengths') track.appendChild(handle(bar, seg, si, offset + seg.units));
        offset += seg.units;
      });
      row.appendChild(track);
      root.appendChild(row);

      // controls under the bar (tap-only path)
      const ctr = document.createElement('div');
      ctr.className = 'sgb-controls';
      if (kind === 'parts' || kind === 'lengths') {
        bar.segments.forEach((seg, si) => {
          const g = document.createElement('div');
          g.className = 'sgb-group';
          const cap = document.createElement('span');
          cap.className = 'sgb-cap';
          cap.textContent = kind === 'lengths' ? t('build.length_of').replace('{name}', names[bi] || '') : t('build.size_of_part').replace('{i}', String(si + 1));
          g.appendChild(cap);
          g.appendChild(btn('−', t('build.shorter') + ' ' + cap.textContent, () => { if (seg.units > 1) { seg.units--; render(); } }));
          const v = document.createElement('span');
          v.className = 'sgb-val'; v.textContent = String(seg.units);
          v.setAttribute('aria-live', 'polite');
          g.appendChild(v);
          g.appendChild(btn('+', t('build.longer') + ' ' + cap.textContent, () => { if (used(bar) < maxUnits) { seg.units++; render(); } }));
          g.appendChild(labelSelect(seg.label, (val) => { seg.label = val; render(); }, t('build.label') + ' ' + cap.textContent));
          ctr.appendChild(g);
        });
        if (kind === 'parts') {
          const g = document.createElement('div');
          g.className = 'sgb-group';
          g.appendChild(btn(t('build.add_part'), null, () => { if (bar.segments.length < MAX_PARTS && used(bar) < maxUnits) { bar.segments.push({ units: 1, label: '' }); render(); } }, 'sgb-btn sgb-wide'));
          g.appendChild(btn(t('build.remove_part'), null, () => { if (bar.segments.length > MIN_PARTS) { bar.segments.pop(); render(); } }, 'sgb-btn sgb-wide'));
          ctr.appendChild(g);
        }
      } else if (kind === 'fraction') {
        const g = document.createElement('div');
        g.className = 'sgb-group';
        const cap = document.createElement('span');
        cap.className = 'sgb-cap'; cap.textContent = t('build.split');
        g.appendChild(cap);
        const setN = (n) => { bar.segments = Array.from({ length: n }, (_, j) => ({ units: 1, shaded: !!(bar.segments[j] && bar.segments[j].shaded) })); render(); };
        g.appendChild(btn('−', t('build.split') + ' −', () => { if (bar.segments.length > 1) setN(bar.segments.length - 1); }));
        const v = document.createElement('span');
        v.className = 'sgb-val'; v.textContent = String(bar.segments.length);
        g.appendChild(v);
        g.appendChild(btn('+', t('build.split') + ' +', () => { if (bar.segments.length < MAX_SPLIT) setN(bar.segments.length + 1); }));
        const hint = document.createElement('span');
        hint.className = 'sgb-cap'; hint.textContent = t('build.shade_hint');
        g.appendChild(hint);
        ctr.appendChild(g);
      } else {
        const g = document.createElement('div');
        g.className = 'sgb-group';
        const cap = document.createElement('span');
        cap.className = 'sgb-cap'; cap.textContent = (names[bi] || '') + ': ' + t('build.units');
        g.appendChild(cap);
        const setN = (n) => { bar.segments = Array.from({ length: n }, () => ({ units: 1 })); render(); };
        g.appendChild(btn('−', cap.textContent + ' −', () => { if (bar.segments.length > 1) setN(bar.segments.length - 1); }));
        const v = document.createElement('span');
        v.className = 'sgb-val'; v.textContent = String(bar.segments.length);
        g.appendChild(v);
        g.appendChild(btn('+', cap.textContent + ' +', () => { if (bar.segments.length < MAX_SPLIT) setN(bar.segments.length + 1); }));
        ctr.appendChild(g);
      }
      root.appendChild(ctr);
    });
  }

  // Drag handle on a segment's right edge; snaps to whole grid units.
  function handle(bar, seg, si, endUnits) {
    const h = document.createElement('div');
    h.className = 'sgb-handle';
    h.tabIndex = 0;
    h.setAttribute('role', 'slider');
    h.setAttribute('aria-label', t('build.handle'));
    h.setAttribute('aria-valuemin', '1');
    h.setAttribute('aria-valuemax', String(maxUnits));
    h.setAttribute('aria-valuenow', String(seg.units));
    h.style.left = (endUnits / gridUnits) * 100 + '%';
    const others = () => used(bar) - seg.units;
    const setUnits = (u) => { const v = Math.max(1, Math.min(maxUnits - others(), u)); if (v !== seg.units) { seg.units = v; render(); focusHandle(bar, si); } };
    h.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setUnits(seg.units + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setUnits(seg.units - 1); }
    });
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const track = h.parentElement;
      const rect = track.getBoundingClientRect();
      const cell = rect.width / gridUnits;
      const start = (endUnits - seg.units) * cell;
      h.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const u = Math.round((ev.clientX - rect.left - start) / cell);
        const v = Math.max(1, Math.min(maxUnits - others(), u));
        if (v !== seg.units) {
          seg.units = v;
          // move live without a full re-render, so the pointer capture holds
          const segEl = track.querySelectorAll('.sgb-seg')[si];
          if (segEl) segEl.style.width = (v / gridUnits) * 100 + '%';
          h.style.left = ((start / cell + v) / gridUnits) * 100 + '%';
        }
      };
      const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); render(); };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
    return h;
  }
  function focusHandle(bar, si) {
    const bi = state.bars.indexOf(bar);
    const rows = root.querySelectorAll('.sgb-row');
    const hs = rows[bi] ? rows[bi].querySelectorAll('.sgb-handle') : [];
    if (hs[si]) hs[si].focus();
  }

  render();
  return {
    getBuilt() {
      return {
        bars: state.bars.map((b) => ({
          segments: b.segments.map((g) => ({
            units: g.units,
            ...(g.shaded ? { shaded: true } : {}),
            ...(g.label ? { label: g.label } : {}),
          })),
        })),
      };
    },
    destroy() { host.replaceChildren(); },
  };
}
