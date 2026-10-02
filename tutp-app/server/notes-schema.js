// "Notes please" structured notes (notes-design-v2): validate and clamp what
// the model returned before it reaches the page. Pure functions, no I/O.
// The page renders every field with textContent, so stripping tags here is
// defence in depth, not the only guard.

export const NOTES_LIMITS_CHARS = {
  title: 80, keyIdea: 240, step: 170, problem: 220, answer: 90, term: 40, meaning: 150,
  mistake: 170, remember: 170, q: 170, a: 130, tell: 320,
};
const MAX = { method: 5, exampleSteps: 5, terms: 4, mistakes: 3, quick: 2 };

// One model string -> clean single-line text, or ''. Removes tags, LaTeX
// markers and control characters, then clamps at a word boundary.
export function cleanText(v, max) {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return '';
  let s = v
    .replace(/<[^>]*>/g, ' ')
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
    .replace(/\\times/g, '×').replace(/\\div/g, '÷').replace(/\\cdot/g, '·')
    .replace(/\\[()[\]]/g, '').replace(/\$+/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:]+$/, '') + '…';
}

const list = (v, max, each) => (Array.isArray(v) ? v : []).map(each).filter(Boolean).slice(0, max);

// The parsed model object -> the structure the page renders, or null when
// there is no usable structure (a key idea or a method is the minimum).
// Empty sections are left out, never padded.
export function normalizeNotes(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const L = NOTES_LIMITS_CHARS;
  const out = { version: 2 };
  const title = cleanText(o.title, L.title);
  const keyIdea = cleanText(o.key_idea, L.keyIdea);
  const method = list(o.method, MAX.method, (s) => cleanText(s, L.step));
  if (!keyIdea && !method.length) return null;
  if (title) out.title = title;
  if (keyIdea) out.key_idea = keyIdea;
  if (method.length) out.method = method;

  const ex = o.worked_example && typeof o.worked_example === 'object' ? o.worked_example : null;
  if (ex) {
    const problem = cleanText(ex.problem, L.problem);
    const steps = list(ex.steps, MAX.exampleSteps, (s) => cleanText(s, L.step));
    const answer = cleanText(ex.answer, L.answer);
    if (problem && (steps.length || answer)) out.worked_example = { problem, steps, answer };
  }
  const terms = list(o.key_terms, MAX.terms, (t) => {
    const term = t && cleanText(t.term, L.term);
    const meaning = t && cleanText(t.meaning, L.meaning);
    return term && meaning ? { term, meaning } : null;
  });
  if (terms.length) out.key_terms = terms;
  const mistakes = list(o.common_mistakes, MAX.mistakes, (s) => cleanText(s, L.mistake));
  if (mistakes.length) out.common_mistakes = mistakes;
  const remember = cleanText(o.remember, L.remember);
  if (remember) out.remember = remember;
  const quick = list(o.quick_check, MAX.quick, (p) => {
    const q = p && cleanText(p.q, L.q);
    const a = p && cleanText(p.a, L.a);
    return q && a ? { q, a } : null;
  });
  if (quick.length) out.quick_check = quick;
  const tell = cleanText(o.tell_your_child, L.tell);
  if (tell) out.tell_your_child = tell;
  return out;
}

// Fallback when the JSON has no usable structure: every readable string in it
// (the old "notes" array first), so the page can show the plain rendering.
export function plainNotes(o) {
  if (!o || typeof o !== 'object') return null;
  const strings = [];
  const walk = (v, depth) => {
    if (strings.length >= 10 || depth > 3) return;
    if (typeof v === 'string') { const s = cleanText(v, 300); if (s) strings.push(s); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(Array.isArray(o.notes) ? o.notes : o, 0);
  if (!strings.length) return null;
  return { plain: strings, subject: cleanText(o.subject || o.title, 60) };
}
