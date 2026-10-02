// Exam prep mind map (round 4): drawn by the server from an approved
// "key points" note, with no model call. The chapter name sits in the
// middle and each key point is a branch around it (at most 8), its heading
// on top and the start of its text below. Text is XML-escaped; the SVG
// scales to its container (viewBox, no fixed size).

const W = 900, H = 640, CX = W / 2, CY = H / 2;
const BOX_W = 200, BOX_H = 92;
const COLORS = ['#005bbf', '#8a4b00', '#006e2c', '#6b3fa0', '#b3261e', '#00696f', '#7a5900', '#3f51b5'];

export function escapeXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// Greedy word wrap to `width` characters, at most `lines` lines; the last
// line ends in "…" when text was cut.
export function wrap(text, width, lines) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '', i = 0;
  for (; i < words.length; i++) {
    const w = words[i].slice(0, width);
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else {
      out.push(cur);
      cur = w;
      if (out.length === lines) { cur = ''; break; }
    }
  }
  if (cur) out.push(cur);
  const cut = i < words.length || words.some((w) => w.length > width);
  if (cut && out.length) out[out.length - 1] = out[out.length - 1].slice(0, width - 1) + '…';
  return out;
}

function textLines(lines, x, y, size, weight, fill) {
  return lines.map((l, i) =>
    `<text x="${x}" y="${y + i * (size + 4)}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(l)}</text>`
  ).join('');
}

// title: the chapter name; points: [{ heading, text }] from key_points.
export function mindMapSvg({ title, points }) {
  const branches = (Array.isArray(points) ? points : []).filter((p) => p && (p.heading || p.text)).slice(0, 8);
  const n = Math.max(branches.length, 1);
  const rx = 320, ry = 220;
  let edges = '', nodes = '';
  branches.forEach((p, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = CX + rx * Math.cos(a), y = CY + ry * Math.sin(a);
    const color = COLORS[i % COLORS.length];
    edges += `<line x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="3" stroke-opacity="0.55"/>`;
    const bx = (x - BOX_W / 2).toFixed(1), by = (y - BOX_H / 2).toFixed(1);
    nodes += `<g><rect x="${bx}" y="${by}" width="${BOX_W}" height="${BOX_H}" rx="14" fill="#ffffff" stroke="${color}" stroke-width="2.5"/>`
      + textLines(wrap(p.heading, 24, 2), x, y - 22, 15, 700, color)
      + textLines(wrap(p.text, 30, 2), x, y + 14, 12, 400, '#333333')
      + '</g>';
  });
  const center = `<ellipse cx="${CX}" cy="${CY}" rx="120" ry="58" fill="#005bbf"/>`
    + textLines(wrap(title, 22, 2), CX, CY - 4, 17, 700, '#ffffff');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(title)}" font-family="system-ui, 'Noto Sans Telugu', sans-serif">`
    + `<rect width="${W}" height="${H}" fill="#f7f9fc" rx="18"/>${edges}${center}${nodes}</svg>`;
}
