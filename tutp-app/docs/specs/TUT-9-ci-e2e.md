# TUT-9: run the e2e suite in GitHub Actions

Status: built 2026-10-13 (founder: "build without waiting").

## Why

The full suite on the laptop runs out of memory (two runs killed, TUT-47/TUT-46) and
blocks the machine for an hour. A GitHub-hosted Ubuntu runner has 7 GB and nothing else on it.

## What

- `.github/workflows/e2e.yml`, trigger `workflow_dispatch` only.
  - input `base_url` (required): a no-traffic tag URL, `https://<tag>---tutp-demo-vs4743puka-uc.a.run.app`.
  - input `runs` (default 2): full-suite runs back to back.
  - input `replay_enabled` (required, must be `true`): the dispatcher states the revision behind the tag has `E2E_REPLAY=1`.
- Ubuntu runner, Node 22 (the Dockerfile's `node:22-alpine`), `npm ci`, Playwright Chrome (`npx playwright install --with-deps chrome`).
- Per run: `node tests/e2e/run.js <base_url> --replay-only --headless` with `E2E_TEST_TIMEOUT_S=180`. Then once: `partners.spec.js` with `ADMIN_TOKEN`.
- `ADMIN_TOKEN` is a GitHub Actions secret (set from Secret Manager `admin-token`, piped, never printed).
- Logs uploaded as artifacts (`e2e-run-N.log`, `partners.log`); the RESULT table of each run goes to the job summary.
- The job fails unless every spec is PASS or KNOWN in every run and partners.spec.js passes.
- Never `--live`, `--record-all`, `--live-smoke`: not an input, not in the workflow, and a step fails the job if they appear in it.

## What can go wrong -> test

| What can go wrong | How it is caught / tested |
|---|---|
| Someone points CI at production or a revision without `E2E_REPLAY` (test families would make paid, live model calls) | `replay_enabled` must be `true`; `base_url` must match the `---tutp-demo-` tag-host pattern (not `tutp.online`); run once on a replay tag and read the spend table (all `$0.0000`). Note: tag `release1` sits on the live revision 00456-rov, which has no `E2E_REPLAY`: do not use it. |
| A paid flag slips in | step "no paid flags" greps the workflow file for `--live`, `--record-all`, `--live-smoke`; job fails. |
| ADMIN_TOKEN leaks in logs | secret masked by Actions; passed only through `env:`; never echoed; partners log is uploaded, so the step prints nothing but the spec's own lines (the spec never prints the token). |
| ADMIN_TOKEN secret missing | step "secrets present" fails fast with a message, without printing the value. |
| A run passes but a spec is silently skipped | the gate reads the RESULT table and requires every spec row to start with PASS or KNOWN, and the row count to equal the spec count; run.js exits 1 on FAIL. |
| Connection blips on the runner (the laptop rule: rerun a spec once) | not automated: CI fails and shows the spec; rerun the workflow. Revisit if flaky. |
| Two runs overlap (shared test families, one session at a time rule) | `concurrency: group: e2e` with `cancel-in-progress: false`. |
| Job hangs | `timeout-minutes: 120`; run.js has its own 180 s per-test stall kill. |
| Chrome missing on the runner | Playwright `chrome` channel install step; the first spec fails loudly if absent. |
| Fork/PR runs get the secret | trigger is `workflow_dispatch` only; no `pull_request`. |

## Files touched

- `.github/workflows/e2e.yml` (new)
- `tutp-app/docs/specs/TUT-9-ci-e2e.md` (this file)
- `tutp-app/CLAUDE.md` (rule: e2e runs in CI; laptop e2e only for one spec while debugging)
