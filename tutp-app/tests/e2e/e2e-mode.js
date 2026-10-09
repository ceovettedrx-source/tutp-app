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
const MODEL_ROUTE = /\/api\/(homework|homework-notes|visual-tutor|explain-please|el\/teachback|el\/lesson\/[a-z-]+)(\?|$)/;

export function e2eMode(spec) {
  const mode = ['replay', 'record', 'live', 'reindex'].includes(process.env.E2E_MODE) ? process.env.E2E_MODE : 'replay';
  const state = { spec, mode, usd: 0, calls: 0, saved: 0, pending: [], fixture: '', index: {} };
  const INDEX = path.join(RECORDINGS, '_index.json');

  // Photos are re-encoded by the browser, so their bytes differ per platform.
  // The fixture file name(s) go to the server as X-E2E-Fixture, which keys the
  // recording on the name instead (server/model-replay.js, recordings/_index.json).
  const names = (files) => (Array.isArray(files) ? files : [files]).map((f) => (typeof f === 'string' ? path.basename(f) : f && f.name)).filter(Boolean).join(',');
  function watchPage(p) {
    const orig = p.setInputFiles.bind(p);
    p.setInputFiles = (sel, files, opts) => { state.fixture = names(files); return orig(sel, files, opts); };
  }
  const withFixture = (headers) => (state.fixture ? { ...headers, 'x-e2e-fixture': state.fixture } : headers);

  async function onResponse(resp) {
    // el/lesson is a GET (its translation call is the model call); the rest are POSTs.
    if (!MODEL_ROUTE.test(resp.url()) || (resp.request().method() !== 'POST' && !/\/api\/el\/lesson\//.test(resp.url()))) return;
    state.calls++;
    state.usd += Number(resp.headers()['x-model-usd'] || 0);
    if (mode !== 'record' && mode !== 'reindex') return;
    const body = await resp.json().catch(() => null);
    for (const rec of (body && body._recordings) || []) {
      if (/^[0-9a-f]{32}$/.test(rec.key) && /^fx[0-9a-f]{30}$/.test(rec.fixtureKey || '')) state.index[rec.fixtureKey] = rec.key;
      if (mode === 'reindex') continue;
      if (!/^[0-9a-f]{32}$/.test(rec.key) || rec.status !== 200) continue;
      const file = path.join(RECORDINGS, `${rec.key}${rec.attempt > 1 ? '.' + rec.attempt : ''}.json`);
      fs.mkdirSync(RECORDINGS, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ status: rec.status, data: rec.data }) + '\n');
      state.saved++;
    }
  }

  return {
    mode,
    // For specs that send a photo without setInputFiles (visual-tutor).
    useFixture(files) { state.fixture = names(files); },
    // opts (Answer/Explain v2, server/e2e-overrides.js; honoured by a preview
    // with E2E_REPLAY=1 only): { v2: true } turns v2 on for this browser,
    // { image: 'mock' } uses the mock image provider, { keySuffix } gives the
    // run its own cache rows. Without opts nothing changes.
    async attach(ctx, opts) {
      ctx.pages().forEach(watchPage);
      ctx.on('page', watchPage);
      if (opts && (opts.v2 || opts.image || opts.keySuffix)) {
        await ctx.route(/\/api\//, (route) => {
          const url = route.request().url();
          const headers = { ...route.request().headers() };
          if (MODEL_ROUTE.test(url)) Object.assign(headers, withFixture({ 'x-e2e-mode': mode }));
          if (opts.v2) headers['x-e2e-answer-v2'] = '1';
          if (opts.image) headers['x-e2e-image'] = opts.image;
          if (opts.keySuffix) headers['x-e2e-key-suffix'] = opts.keySuffix;
          route.continue({ headers });
        });
      } else {
        await ctx.route(MODEL_ROUTE, (route) => route.continue({ headers: withFixture({ ...route.request().headers(), 'x-e2e-mode': mode }) }));
      }
      ctx.on('response', (r) => { state.pending.push(onResponse(r).catch(() => {})); });
    },
    async finish() {
      await Promise.all(state.pending);
      if (Object.keys(state.index).length) {
        let all = {};
        try { all = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch {}
        Object.assign(all, state.index);
        const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => (a < b ? -1 : 1)));
        fs.writeFileSync(INDEX, JSON.stringify(sorted, null, 1) + '\n');
      }
      const usd = Math.round(state.usd * 10000) / 10000;
      console.log(`[e2e:${spec}] mode ${mode}; model calls ${state.calls}; model spend $${usd.toFixed(4)}${mode === 'record' ? `; recordings saved ${state.saved}` : ''}`);
      fs.mkdirSync(path.join(HERE, 'output'), { recursive: true });
      fs.writeFileSync(path.join(HERE, 'output', `spend-${spec}.json`), JSON.stringify({ spec, mode, calls: state.calls, usd }) + '\n');
    },
  };
}
