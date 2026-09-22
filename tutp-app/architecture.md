# Tut-P — Architecture

_Last generated: 2026-09-22. Source: overview.md, CLAUDE.md, package.json,
repo folder listing, TUTP-4-FEATURES-ARCHITECTURE-EXECUTION-PLAN.md._

---

## 1. High-Level Architecture

```
                     ┌─────────────────────────┐
                     │        Browser           │
                     │ (Parent / Teacher /      │
                     │  Child, plain HTML+JS)   │
                     └────────────┬─────────────┘
                                  │ HTTPS
                                  ▼
                     ┌─────────────────────────┐
                     │  Cloud Run: tutp-demo     │
                     │  Node.js / Express        │
                     │  server.js + server/*     │
                     └───┬─────────┬─────────┬──┘
                         │         │         │
         ┌───────────────┘         │         └───────────────┐
         ▼                         ▼                         ▼
┌─────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ Supabase          │      │ Anthropic Claude   │      │ Firebase Phone    │
│ (PostgreSQL,       │      │ API                │      │ Auth (OTP login)   │
│ Mumbai region)     │      │ (AI generation:    │      │                    │
│ - families/students│      │  homework, quiz,   │      │                    │
│ - bonding scores    │      │  stories, feedback │      │                    │
│ - payments          │      │  classification)   │      │                    │
│ - usage/feedback    │      └──────────────────┘      └──────────────────┘
│   events             │
│ - teacher materials  │
│ - game engine tables │
└─────────────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ Razorpay           │      │ Resend + Gmail     │      │ Google Cloud       │
│ (payments — full    │      │ fallback            │      │ Secret Manager     │
│ integration,        │      │ (transactional      │      │ (all secrets:      │
│ one-time only)       │      │  email)             │      │  API keys, tokens) │
└─────────────────┘      └──────────────────┘      └──────────────────┘
```

**Request flow (typical: parent submits homework):**
1. Parent-facing HTML page (e.g. `public/app/mother/index.html`) builds
   the prompt **client-side** and calls `/api/homework`.
2. `server.js` / relevant route handles auth (session cookie +
   Firebase-admin JWT verification), then calls the Anthropic Claude
   API with the pedagogy-grounded prompt.
3. Response (explanation + optional quiz) is stored/logged
   (usage_events) and returned to the browser.
4. Feedback events (if any) route through the Claude-based
   auto-classify/auto-resolve/escalate pipeline.

> **Important routing note:** the parent-facing Homework Help/Quiz
> modal builds its prompt in the client-side HTML/JS files
> (mother/father/family-member/index.html), **not** in
> `buildTeacherSystemPrompt` in `server.js`. Any Homework Help bug
> investigation must start client-side.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| **Compute** | Google Cloud Run (service: `tutp-demo`, project: `project-66860e46-da22-4178-a59`, region: `us-central1`) |
| **Backend runtime** | Node.js (>=18), Express 4.x |
| **Database** | Supabase (PostgreSQL, Mumbai region, project `ymsogwqqerconsayzymy`) — single production instance, no separate test environment |
| **Auth** | Firebase Phone Auth (OTP login, project `tut-p-98978`), session cookie + firebase-admin JWT verification on backend routes |
| **AI** | Anthropic Claude API |
| **Payments** | Razorpay (live keys, international payments enabled; full integration, one-time payments) |
| **Email** | Resend (primary, `tutp.online` domain verified) + Gmail fallback (nodemailer) |
| **Secrets** | Google Cloud Secret Manager — `anthropic-api-key`, `razorpay-key-id`, `razorpay-key-secret`, `razorpay-webhook-secret`, `supabase-service-role-key`, `admin-token`, `cron-token`, `gmail-app-password`, `resend-api-key` |
| **Frontend** | Plain HTML + Tailwind CSS (compiled via `tailwindcss` CLI from `styles/tailwind.css` → `public/css/tailwind.css`, replacing the earlier per-page CDN setup), Group A design system |
| **Fonts** | Plus Jakarta Sans (headline/display), Inter (body/label) |
| **Auth libs** | `firebase-admin`, `jsonwebtoken`, `bcrypt`, `cookie-parser` |
| **Other deps** | `@dicebear` (avatars), `compression`, `express-rate-limit`, `dotenv` |
| **Version control** | GitHub — `ceovettedrx-source/tutp-app` |
| **Dev tooling** | Claude Code (`claude` CLI) in Google Cloud Shell, account `ceo_vettedrx` (not `info_vettedrx`) |
| **Containerization** | Docker (`Dockerfile`, `.dockerignore`) |
| **Analytics/tracking** | In-house (`tracking/events.js`, `tracking/tracking.js`, `tracking/feedback-pipeline.js`) — no third-party analytics vendor |

---

## 3. Folder Structure

```
tutp-app/
├── server.js                       # Express entrypoint
├── server/
│   ├── routes/
│   │   └── teacher/
│   │       └── create-material.js
│   ├── services/
│   │   ├── knowledgeGraph.js
│   │   ├── lessonMaterialGenerator.js
│   │   ├── lessonRenderer.js
│   │   ├── lessonVerifier.js
│   │   ├── barModelSvgGenerator.js
│   │   ├── triangleSvgGenerator.js
│   │   ├── supabaseRetryFetch.js
│   │   └── illustration/
│   │       ├── characters.js
│   │       └── problemParser.js
│   ├── references/
│   │   ├── pedagogy-nep-ncf.md       # Panchpadi/NEP pedagogy grounding
│   │   └── maths.md
│   ├── knowledge-graph-data/
│   └── scripts/
├── public/
│   ├── index.html                    # Homepage / mode chooser
│   ├── app/
│   │   ├── mother/  father/  family/  family-member/   # parent dashboards
│   │   ├── child/                                       # child view
│   │   ├── teacher/  teacher-register/  register-teacher/
│   │   ├── register/  login/
│   ├── teacher-dashboard/
│   │   └── create-material.html
│   ├── demo/                          # no-login teaser route (legitimate, not the whole product)
│   ├── css/  js/  images/  shared/
│   ├── manifest.json, robots.txt, sitemap.xml, llms.txt
├── supabase/
│   └── migrations/                    # 001…021, run manually via SQL Editor
├── styles/
│   └── tailwind.css
├── tracking/
│   ├── events.js
│   ├── tracking.js
│   └── feedback-pipeline.js
├── .telemetry/
│   ├── tracking-plan.yaml
│   └── delta.md
├── test-data/
├── tailwind.config.cjs
├── postcss.config.cjs
├── package.json
├── Dockerfile
├── deploy.sh
├── CLAUDE.md
├── FEATURE-SPECS.md
├── PRODUCT-RESEARCH-AND-ROADMAP.md
└── TUTP-4-FEATURES-ARCHITECTURE-EXECUTION-PLAN.md
```

**Notes:**
- Only Vet and Claude (across sessions) have ever written code in this
  repo — any unfamiliar-looking committed file is prior Claude/Vet
  work needing context, never third-party/untrusted code.
- Database migrations (`supabase/migrations/001`…`021`) are run
  **manually** via the Supabase SQL Editor — this is the standing
  pattern, not automated.
- `tutp-demo`'s Cloud Run traffic is pinned to a **named revision**,
  not "latest" — `deploy.sh` succeeding does not mean the new revision
  is serving traffic. Always verify with
  `gcloud run services describe tutp-demo --region=us-central1 --format="value(status.traffic)"`
  after every deploy.
