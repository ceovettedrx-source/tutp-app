// A phrase that may be stored (only for the "other" intent): at most 6 words,
// with emails, links, numbers, phone numbers and names removed. Returns the
// scrubbed phrase, or null when nothing useful is left.
//   names  extra names to remove (the child's, from the students row)
const MAX_WORDS = 6;
const MAX_WORD_LEN = 24;

export function scrubPhrase(text, names = []) {
  let s = String(text || '').normalize('NFKC');
  s = s.replace(/\S+@\S+/g, ' ').replace(/(?:https?:\/\/|www\.)\S+/gi, ' ');
  const nameSet = new Set(names.flatMap((n) => String(n || '').toLowerCase().split(/\s+/)).filter((n) => n.length > 1));
  const words = s.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  const kept = [];
  words.forEach((w, i) => {
    if (/\p{N}/u.test(w)) return;                            // numbers, phones, ids
    if (nameSet.has(w.toLowerCase())) return;                // the child's name
    if (i > 0 && /^\p{Lu}\p{Ll}+$/u.test(w)) return;          // a capitalised word mid-sentence: likely a name
    if (w.length > MAX_WORD_LEN) return;
    kept.push(w.toLowerCase());
  });
  return kept.length ? kept.slice(0, MAX_WORDS).join(' ') : null;
}
