# TUT-42 Parent dashboard redesign: one shared layout for mother, father, family member

Status: approved by Vet 2026-10-14 (D1 order as written, D2 bottom bar yes, D3 Live Session stays as "Coming soon"; D4 illustrations until photos arrive; D5 stash not needed). Built on branch tut-42-dashboard. Linear: TUT-42. Folds in TUT-56 (bonding card) and TUT-61 (Singapore Maths card for classes 7+).

## 1. What is wrong today (measured on main, 2026-10-14)

- `public/app/mother/index.html` and `public/app/father/index.html` are 2,023 lines each and differ in 28 lines (the role word and one roster line). `family-member/index.html` is 2,087 lines: the same page plus a viewer gate and `data-feature` attributes. Every change is made three times; TUT-43 had to edit the same card in three files, and TUT-56 is still unmerged because it touched the same lines.
- On a 390 px phone the page is a desktop page shrunk: the most used action (Homework Help) is below the welcome block and bonding card, and nine cards of equal weight follow with no order of importance.
- Some cards lead nowhere real for many children: "Upcoming Live Session" (no live sessions exist yet), "Online Exam / Test" (coming soon modal), Singapore Maths for classes 7 to 12 (TUT-61).

## 2. Approach

1. **One template, three generated pages.** `public/app/shared/dashboard/template.html` holds the page once, with role tokens (`{{role}}`, `{{Role}}`, `{{canPay}}`, member-only blocks between `<!-- member:start -->` / `<!-- member:end -->`). `scripts/build-dashboards.mjs` writes `public/app/{mother,father,family-member}/index.html`. A unit test regenerates them and fails if the committed files differ (same pattern as migration 033). No server change, the pages stay static, content hashing is unchanged.
2. **Behaviour moves out of the page** into shared modules the template includes, the way `homework-modal.js`, `story-modal.js`, `singapore-maths/card.js` and TUT-56's `bonding-card.js` already work. The page keeps markup only.
3. **Phone first.** Designed at 390 x 844 as the PWA home screen; the desktop layout is the phone layout in two columns, not a separate design.
4. **The Sept 26 mockup stash is reference only** (visual direction), rebuilt on current main.

## 3. Item map: every current item and its new place

Nothing is removed. An e2e assertion exists for every row (section 5).

| # | Current item (id / heading) | New place on the phone, top to bottom |
|---|---|---|
| 1 | Header avatar `#headerAvatarInitial`, family list `#sidebarFamilyList` | Top bar; family list in a menu sheet |
| 2 | Viewer gate `#viewerGate` (family member only) | Unchanged, before everything |
| 3 | Welcome + child chips `#childChipsRow` | Top: "Hi <name>" and the child switcher as one row |
| 4 | Homework Help hero, search + attach `#searchAttachMenu`, chooser `#searchAttachChooser`, homework modal | First card: the main action, full width |
| 5 | Homework list `#homeworkList`, pending banner `#homeworkPendingBanner` | Right under Homework Help ("Today's homework") |
| 6 | Bonding card `#bondingReportSection` + full report (TUT-56 component) | Third: score or empty state, one line, "View full report" |
| 7 | Singapore Maths card `#sgmathCard` + progress | Fourth ("Daily practice"); for classes 7 to 12 the card is hidden (TUT-61) |
| 8 | This Week's Goal `#weeklyGoalRing` | Fifth, compact ring next to the bonding card on desktop |
| 9 | Explore Subjects `#exploreSubjectsSection`: Play-Based Learning, Experiential Learning, Story, Online Exam (coming soon) | "Learn together" row of tiles; Exam tile shows "Soon" |
| 10 | Family Library | Tile in "Learn together" |
| 11 | Continue Learning | Under "Learn together", only when there is something to continue |
| 12 | Tutor near you (partners) | Near the bottom, one line card |
| 13 | Upcoming Live Session | Shown only when a session exists; otherwise not drawn (decision D3) |
| 14 | Billing `#billingStatus` + plan chooser | Plan line in the menu sheet and on locked cards |
| 15 | Feedback dock, WhatsApp share | Unchanged (shared modules) |
| 16 | Modals: full report, exam coming soon, play, experiential, homework | Unchanged ids; opened from their new places |

Family member: every block keeps its `data-feature` (`bonding_report`, `homework`, `activities`), so the parents' visibility choices still hide the same things.

## 4. Decisions for Vet (answer before build)

- **D1 Order.** The order in section 3 puts daily use first (homework, then bonding, then practice). Approve or reorder.
- **D2 Bottom bar.** A fixed bottom bar on the phone: Home, Homework, Practice, Family. Yes or no. (No means one long scroll as today.)
- **D3 Live Session card.** Hide it until live sessions exist, or keep it with "Coming soon". Today it promises something that is not there.
- **D4 Human photos.** The Linear issue asks for real photos on This Week's Goal, Singapore Maths and Live Session. Send the reference photos, or approve illustrations in the Singapore Maths badge style.
- **D5 Sept 26 mockup.** Claude Code exports the stash as screenshots for reference; say which parts you still want.

## 5. What can go wrong, and the test for each

| Risk | Test |
|---|---|
| A newer feature is silently dropped (happened before: "+", mic, method chips) | e2e `dashboard-items.spec.js`: every id in section 3 is present on mother, father and family member |
| The three generated pages drift from the template (someone edits a generated file) | unit test regenerates and compares byte for byte |
| Family privacy: a member sees what the parents hid, or opens another member's view | e2e: member with `activities` hidden sees no Singapore Maths, Library, Explore; server progress API 403 (exists) |
| Bonding card "Could not load" returns | e2e (TUT-56 h to k) runs on all three pages |
| Phone layout breaks or scrolls sideways | e2e at 390 x 844: no horizontal scroll, every button at least 44 px |
| Old cached page on parents' phones after release | content-hashed asset check on the preview (exists in inventory spec) |
| Role words wrong (father page says mother) | unit test on generated pages: role tokens only, no stray "mother" in father page outside the roster |
| Release built from a branch, not main | deploy from main only, verify with `gcloud run revisions list` (CLAUDE.md) |

## 6. Build notes

- `templates/dashboard.html` + `scripts/build-dashboards.mjs`; tokens `{{self}}`/`{{other}}` (parent pages), `{{role}}`, `{{canPay}}`, `{{feat:NAME}}`, blocks `@@if parent / @@else / @@end`. `tests/unit/dashboards.test.js` fails when a page differs from the template.
- Fake controls removed: the search box's mic and arrow (they showed "Opens in the live app" alerts) and Enter now open Homework Help; the demo live session ("Ms. Sarah, Today 3 PM, Join Classroom") is a "Coming soon" card linking to tutors.
- The bottom bar's old "Moments" and "Reports" tabs pointed to `#` and are gone; Log out moved to the header on every role.
- Header icon buttons are 44 px.
- Not changed (backlog): the desktop header's "Search Tut-P courses" box is still not wired.

## 7. Done when

Vet approves D1 to D5, build, unit + full e2e on a no-traffic preview, Vet phone check on 390 px, traffic (no payments in this change, so no payment hard stop). TUT-56 merges into this release, not separately.
