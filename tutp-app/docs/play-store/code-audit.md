# What Tut-P really collects (code audit)

Audit date 2026-10-04, repo at origin/main 2b002ee. Read from the code and the SQL migrations only; nothing here was checked against the live database or the Supabase dashboard. Items marked **VERIFY** need the founder to look at a dashboard. This file is the only source for the Data safety answers and for the DRAFT policy pages.

## 1. People and the data we hold

| Who | Data (where it is saved) | Source |
|---|---|---|
| Mother / father (required: mother) | name, date of birth, education, phone, email, photo (optional) in `family_registrations.data` (one JSON record); phone also in `family_members` | `public/app/register/index.html` payload |
| Other family members | name, relationship, phone; a bcrypt-hashed password when one is set (`family_members`) | migrations 002, 019 |
| Child (1 or more) | name, date of birth, class, curriculum, school name, mandal, village, full address (optional), photo (optional), favourite subject, favourite game, hobbies, plan; `students` row: name, school, class, section, roll number; `student_progress` scores per subject | register payload, migration 001 |
| Location of family | country, state, district, mandal, area | register payload |
| Teachers | name, phone, subjects, school, class sections, approval flag; ID-card photo URL, verification events | migrations 004, 016; `register-teacher` |
| Tutors (directory) | name, photo URL, subjects, area, bio, phone (never sent to the browser) | migration 020 |
| Payments | plan, amount, Razorpay order id and payment id, status, per child | migration 012 |
| Tutor contact requests | family, tutor, Razorpay ids, status, refund deadline | migration 020 |
| Referrals / marketing | referral code in `localStorage` (`tutp_ref`) saved with the registration, `utm_source/medium/campaign` saved with the registration, referral link opens | register payload, migration 009 |

## 2. What a learning session sends and stores

- **Homework Help, Storytelling, Notes, Quiz, Question paper, Lesson material** (`/api/homework`, `/api/story`, chips, visual tutor, teacher routes): the typed text, photo(s) or PDF the parent attaches are sent to **Anthropic (Claude)** to produce the answer. Models are listed in `server/models.js` (claude-haiku-4-5, claude-sonnet-5). In `/api/homework` we found no code that writes the question text or photo to our database, and the child's name is not put in the request (the `childName` field in the landing-page demo route is scrubbed and used only inside that route; **VERIFY** by reading `server/prompts/homework-prompts.js` once more before legal sign-off).
- **Usage events** (`usage_events`): event name, family id, student id, JSON properties: session started/completed (feature, language, duration), model call (cost/latency), feedback submitted (**includes the free-text a parent types** in `freeText`), image reports, demo calls (language, has_attachment). Test families are excluded from metrics.
- **Search-chip events** (`search_chip_events`): kind, chip, intent, language, class band, board, date, a salted hash of the family id, and, only for "other" searches, a scrubbed phrase that is cleared after 30 days (`server/chips/log.js`).
- **Feedback pipeline** (`tracking/feedback-pipeline.js`): feedback text is classified by a Claude model; unresolved feedback is emailed to the founder.
- **Answer reuse**: the code has a knowledge-graph / cache layer for common questions (`docs/answer-cache-knowledge-graph-spec.md`). **VERIFY** whether answers for one family are ever shown to another before the policy says "reused".
- **Image library**: stories use pictures made offline with Claude and Gemini (`scripts/imglib`). No family data goes to Gemini; it is a build-time tool run by the founder.

## 3. Files and photos

- `POST /api/upload` accepts a base64 file up to 8 MB and stores it in the Supabase Storage bucket **`family-uploads`**, returning `getPublicUrl(...)`. Callers: registration (child photo, parent photos, subject workbook photos), the landing page homework attachment, the teacher page, the tutor admin form.
- **The route has no sign-in check** (it is used before registration) and the URL it returns is a public URL. File names are random (timestamp + random suffix), so a URL cannot be guessed, but anyone who has the URL can open the file, and anyone can upload to the bucket. **VERIFY** the bucket is public in the Supabase dashboard (the code assumes it is). See "Findings for the founder" below.

## 4. Sign-in, cookies and browser storage

- Sign-in is by **phone one-time password through Firebase Authentication** (project `tut-p-98978`, reCAPTCHA is part of it; Google receives the phone number and the device/browser signals reCAPTCHA uses). We do not store passwords for parents (family members and teachers may have a bcrypt hash).
- Cookies set by our server: `tutp_session` (signed login token, httpOnly, secure, SameSite lax, 30 days sliding), `tutp_logged_out` (time of last logout, httpOnly), `tutp_demo` (landing-page demo limit, 2 days, httpOnly), `tutp_admin` (founder only).
- `sessionStorage`: family id, student id, roles, last dashboard, UTM values, pending attachment, a few one-time flags. `localStorage`: `tutp_ui_lang`, `tutp_last_student_*`, `tutp_ref`.
- No advertising cookies. **Google Analytics 4** (`G-02PZ2EFZVY`, via Google Tag Manager) is loaded only on the landing page `public/index.html` (not in `/app/*` pages): it sets Google's own analytics cookies and sees page views, device and approximate location of landing-page visitors.
- The pages load fonts and icons from Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`), so Google sees the visitor's IP address for those requests.

## 5. Service providers (data processors)

| Provider | What it receives | Where in code |
|---|---|---|
| Anthropic (Claude) | homework / story / notes content (text, photos, PDFs), feedback text | `server/anthropic.js`, `server/models.js` |
| Supabase | the whole database and the `family-uploads` bucket | `server.js` |
| Google Cloud (Cloud Run, Secret Manager) | hosting, logs (request logs include URLs and IP addresses) | deploy |
| Google Firebase Authentication + reCAPTCHA | phone number, OTP | `public/app/shared/phone-auth.js` |
| Razorpay | name/phone/email for the order, payment details (entered on Razorpay's own checkout, never in our code) | `server.js` payment routes, `public/js/billing.js` |
| Resend (fallback Gmail SMTP) | parent email address and the email text (homework alerts include the child's first name and the homework title; support emails) | `server.js` mailer |
| Google Analytics / Tag Manager | landing-page visits | `public/index.html` |
| Google Fonts | IP address of the visitor | all pages |

## 6. Deleting data

- **There is no self-service "delete my account" in the app or API.** The only delete found is removing a family member (`DELETE` on `family_members`, line ~3012 of `server.js`, mother/father only). Tables reference `family_registrations` with `on delete cascade`, so deleting the family row in Supabase removes children, members, payments, usage events and progress, but this is done by hand by the founder today. Payment records may need to be kept for tax law.
- Consequence: the `/delete-account/` page describes an email request handled by hand, with a stated response time that the founder must be able to meet (draft says 30 days).

## 7. Findings for the founder (not fixed by this round)

1. `POST /api/upload` is unauthenticated and writes to a public bucket (abuse and storage-cost risk; child photos are one unguessable link from public). Needs a decision: require a session, or a signed upload for registration. Not a Play blocker, but Data safety "data is encrypted in transit / stored securely" claims should be reviewed with this in mind.
2. The existing drafts in `docs/legal/` say "We do **not** collect a child's photo" and "We do not send your child's name to the AI provider". The code does collect an optional child photo and a child's address and date of birth. The new pages follow the code; the old drafts should be retired or corrected.
3. No in-app account deletion (Play requires an in-app path **and** a web path for apps that let users create accounts: the web page exists after this round, an in-app link does not; see the founder list).
4. ADMIN_TOKEN in URL query strings (already in CLAUDE.md backlog) shows up in Cloud Run request logs.
5. Payments in the Android app: the Pro plans are digital subscriptions paid through Razorpay on the web. Google Play's Payments policy generally requires Google Play Billing for digital goods sold inside an app distributed on Play. This is a policy and revenue decision for the founder (see `target-audience.md` and the founder list); nothing was changed in code.
