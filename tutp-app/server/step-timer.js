// Per-step timing for a request: mark() after each step, then log summary()
// and send header() as Server-Timing, so a slow request shows which step it
// was (2026-09-28: a photo request whose two model calls each ran into
// max_tokens looked like one 70 s wait from the outside).
export function stepTimer(now = () => performance.now()) {
  const start = now();
  let last = start;
  const steps = [];
  return {
    mark(name) {
      const t = now();
      steps.push([name, Math.round(t - last)]);
      last = t;
    },
    total: () => Math.round(now() - start),
    // "auth 40 | model1 7020 | boxes 1 = 7061 ms"
    summary() {
      return `${steps.map(([n, ms]) => `${n} ${ms}`).join(' | ')} = ${this.total()} ms`;
    },
    // "auth;dur=40, model1;dur=7020, total;dur=7061"
    header() {
      return [...steps, ['total', this.total()]].map(([n, ms]) => `${n};dur=${ms}`).join(', ');
    },
  };
}
