# Target audience and Google's Families policy: recommendation, not a decision

The founder decides. This lays out the two realistic options and what each costs. Policy details change: have the account owner re-read the current Families policy text in Play Console before choosing.

## The facts that drive the choice
- The account holder, the payer and the person who gives consent are the parent. The registration page has a parent/guardian confirmation box. Children get a profile and a Child View inside the family's signed-in account; there is no separate child sign-up.
- The app collects a child's name, date of birth, school, optional address and optional photo (`code-audit.md`).
- Third parties inside the app: Firebase Authentication with reCAPTCHA, Razorpay checkout, Google Fonts; Google Analytics only on the home page. No advertising SDK.
- India's DPDP Act, 2023 has its own rules for children's data (verifiable parental consent, no tracking or behavioural monitoring of children, no targeted ads). That is a legal question regardless of the Play choice, and it is why the consent wording is left as a placeholder.

## Option A: audience 18 and over (parents)
- **How**: in Play Console "Target audience" choose only "18 and over". Listing, icon and screenshots speak to parents. The app is described as a tool a parent uses with their child.
- **For**: no Families-policy program obligations; fits how the product is actually used and paid for; fastest to a closed test and to production; fewer reviews of third-party components.
- **Against**: Play can still decide an app "appeals to children" (Child View, games, cartoon-style art) and ask for Families compliance; so keep the screenshots and graphic adult-facing, no children's faces. No "Teacher approved" badge, no placement in the Kids/Families surfaces. The Data safety form must still be honest about children's data.
- **Risk if wrong**: rejection or a policy warning late in review, which costs days. Mitigation: answer review questions as "parent-operated" and show the registration consent.

## Option B: include children (for example 6-12, with parents)
- **How**: choose child age bands, enter the Families program, follow its extra rules.
- **For**: "Designed for Families" visibility and the optional teacher-approved review; strong fit for an education product.
- **Against**: stricter limits on data collection and on third-party SDKs and web content, parental gate expectations around purchases and external links, and every web page the TWA can show (including Google Analytics on the home page and Firebase/reCAPTCHA sign-in) has to be checked for compliance. The code audit found nothing blocking, but nothing here has been verified against the current certified-SDK list. Longer review, more rework before the closed test, and legal review of DPDP child rules first.

## Recommendation
Start with **Option A** for the closed test and first production release: it matches the real flow (a parent registers, consents and pays), and it keeps the closed-test clock (20 testers, 14 days) off the critical path of a Families review. Revisit Option B after (1) legal has written the DPDP consent wording, (2) the unauthenticated public upload route is fixed, and (3) the founder decides whether the Teacher-approved badge is worth the work. Whichever is picked, the privacy page, Data safety form and Play Console target audience must say the same thing.

## Related decision that is not about age: Play Billing
Plans are digital subscriptions paid through Razorpay on the website. Google's Payments policy generally requires Google Play Billing for digital goods sold inside an app distributed on Play, with exceptions that depend on the account's region and program. Options: (1) accept the policy and add Play Billing through a TWA (Digital Goods API) with Google's service fee; (2) hide plan purchase inside the app and let users buy on the website (check that Play's rules for the account's country allow the wording); (3) apply for any alternative-billing program offered to the account. Closed testing can proceed with purchases hidden; production cannot be decided without this. Nothing was changed in code.
