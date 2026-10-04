# Play Console: Data safety form answers

Derived from `code-audit.md` (2026-10-04). Google's form is filled by the account owner; these are the answers the code supports. **Legal should confirm the "shared" column**: Google does not count a transfer to a service provider that processes data on the developer's behalf as "sharing", and every recipient below is such a provider, so "Shared" is No throughout. If legal reads it differently (for example Google Analytics), change those rows to Yes. The TWA shows tutp.online, so what the website collects counts for the app.

## Top-level questions

| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by the app encrypted in transit? | Yes (HTTPS everywhere; Cloud Run terminates TLS) |
| Do you provide a way for users to request that their data is deleted? | Yes. Web link: `https://tutp.online/delete-account/` (email process, handled by hand). Play also asks for an in-app path for apps with accounts: none exists yet (founder list). |
| Independent security review | No |
| Families policy | Depends on the target-audience decision in `target-audience.md` |

## Data types (Collected = Yes; Shared = No; "Processed ephemerally" only where stated)

| Play category | Data type | Collected | Optional? | Purposes | Notes |
|---|---|---|---|---|---|
| Personal info | Name | Yes | Required | App functionality, Account management | parents, children, family members, teachers |
| Personal info | Email address | Yes | Required for mother, optional others | App functionality, Account management, Developer communications | homework alerts, support |
| Personal info | User IDs | Yes | Required | App functionality, Account management | family id, student id, session cookie |
| Personal info | Address | Yes | Optional | App functionality | child's full address (optional), district, mandal, village |
| Personal info | Phone number | Yes | Required | App functionality, Account management, Fraud prevention | OTP sign-in via Firebase |
| Personal info | Other info | Yes | Optional | App functionality | date of birth, education, class, school, board, hobbies, favourite subject/game |
| Financial info | Purchase history | Yes | Required to buy | App functionality, Account management | plan, amount, Razorpay ids; card/UPI details are entered on Razorpay and never reach Tut-P, so "User payment info" is No |
| Photos and videos | Photos | Yes | Optional | App functionality | child/parent photos, homework photos |
| Files and docs | Files and docs | Yes | Optional | App functionality | homework PDFs; teacher ID-card photo |
| Messages | (none) | No | | | no chat or inbox. Feedback free text is under App activity. |
| App activity | App interactions | Yes | Required | App functionality, Analytics | feature used, session length, quiz results |
| App activity | In-app search history | Yes | Required | App functionality, Analytics | search-bar choices; typed phrase kept 30 days after name scrubbing |
| App activity | Other user-generated content | Yes | Optional | App functionality | typed homework text, answer feedback text |
| App info and performance | Diagnostics | Yes | Required | App functionality | server request logs, model-call latency/cost per request |
| Device or other IDs | Device or other IDs | Yes | Required | Fraud prevention, Analytics | reCAPTCHA (Firebase sign-in); Google Analytics client id on the home page |
| Location | Approximate location | Yes | Required | Analytics | Google Analytics derives it from IP on the home page; family district/state is under Personal info |
| Location | Precise location | No | | | not requested |
| Contacts, Calendar, Health, Web browsing, Audio | | No | | | |

## Per-type "ephemeral processing"
Homework text, photos and PDFs sent to the AI provider are processed to produce the answer. In `/api/homework` the code does not save them, but files attached through the upload button on the website and at registration are stored. Do **not** tick "processed ephemerally" for Photos and Files and docs.

## Security practices section
- Data encrypted in transit: Yes.
- Users can request deletion: Yes (web page above).
- Committed to follow the Play Families Policy: only if the founder picks the Families option.
- Data is deleted when the user asks: Yes (by hand).

## Cross-check list before submitting
1. Keep this table equal to `privacy` page; if either changes, change both.
2. Re-run `code-audit.md` section 3 (public upload bucket). If the bucket is made private, the wording "opened by a web link" on the privacy page changes too.
3. Google compares the declaration with SDKs found in the bundle: the TWA bundle has no analytics SDK of its own (Bubblewrap adds the Android Browser Helper only).
