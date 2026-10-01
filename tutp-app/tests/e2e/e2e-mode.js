// Replay / record / live for the model-calling specs (round 2), and what the
// run spent. The mode comes from E2E_MODE (set by tests/e2e/run.js; replay
// by default) and goes to the server as X-E2E-Mode, on /api/homework and
// /api/visual-tutor only (a custom header on Firebase's requests would
// break sign-in). The server honours it only on a preview with
// E2E_REPLAY=1 and only for test families (server/model-replay.js).
//
//   const e2e = e2eMode('homework');
//   await e2e.attach(ctx);         // every browser context of the spec
//   ...
//   e2e.finish();                  // prints and writes output/spend-homework.json
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RECORDINGS = path.join(HERE, 'recordings');
const MODEL_ROUTE = /\/api\/(homework|homework-notes|visual-tutor)(\?|$)/;

export function e2eMode(spec) {
  const mode = ['replay', 'record', 'live'].includes(process.env.E2E_MODE) ? process.env.E2E_MODE : 'replay';
  const state = { spec, mode, usd: 0, calls: 0, saved: 0, pending: [] };

  async function onResponse(resp) {
    if (!MODEL_ROUTE.test(resp.url()) || resp.request().method() !== 'POST') return;
    state.calls++;
    state.usd += Number(resp.headers()['x-model-usd'] || 0);
    if (mode !== 'record') return;
    const body = await resp.json().catch(() => null);
    for (const rec of (body && body._recordings) || []) {
      if (!/^[0-9a-f]{32}$/.test(rec.key) || rec.status !== 200) continue;
      const file = path.join(RECORDINGS, `${rec.key}${rec.attempt > 1 ? '.' + rec.attempt : ''}.json`);
      fs.mkdirSync(RECORDINGS, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ status: rec.status, data: rec.data }) + '\n');
      state.saved++;
    }
  }

  return {
    mode,
    async attach(ctx) {
      await ctx.route(MODEL_ROUTE, (route) => route.continue({ headers: { ...route.request().headers(), 'x-e2e-mode': mode } }));
      ctx.on('response', (r) => { state.pending.push(onResponse(r).catch(() => {})); });
    },
    async finish() {
      await Promise.all(state.pending);
      const usd = Math.round(state.usd * 10000) / 10000;
      console.log(`[e2e:${spec}] mode ${mode}; model calls ${state.calls}; model spend $${usd.toFixed(4)}${mode === 'record' ? `; recordings saved ${state.saved}` : ''}`);
      fs.mkdirSync(path.join(HERE, 'output'), { recursive: true });
      fs.writeFileSync(path.join(HERE, 'output', `spend-${spec}.json`), JSON.stringify({ spec, mode, calls: state.calls, usd }) + '\n');
    },
  };
}
