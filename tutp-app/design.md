# Tut-P — Design System

_Last generated: 2026-09-22. Source: tailwind.config.cjs (Group A
design system tokens), ways-of-working.md, TUTP-4-FEATURES-ARCHITECTURE-
EXECUTION-PLAN.md. Verify against tailwind.config.cjs before relying on
exact hex values — this is a snapshot._

---

## 1. Design Principles

- **Genuinely distinctive, not templated.** Avoid generic rounded-card
  SaaS-kit defaults. On first sight of any feature, a user should
  think "this is really useful" — content and presentation both.
- **Revenue features feel like support, not upsells.** ~75–80% of the
  site's features are revenue features; they must read as genuine,
  hopeful support to families, never "built because it had to be."
- **Explicit over implicit.** No silent defaults for the 6-mode
  chooser — the active mode is always visible before and after
  submission.
- **Benefit-first, plain language** for all website/marketing/pitch
  copy — no jargon. Example voice: *"The homework app that grades you,
  not just your child."* (This copywriting principle applies to
  marketing copy only, not child-facing content, which follows
  pedagogy/Panchpadi standards instead.)
- **Warm, human, photo-led** over decorative/abstract — the Find a
  Tutor tile's real-photo, benefit-first treatment is the reference
  standard for humanizing remaining dashboard cards (This Week's Goal,
  10-minute Math Session, Upcoming Live Session, etc.).
- **Correct, grounded content over generic filler** — no fabricated
  data or reviews; content that claims pedagogy grounding must
  genuinely map to a cited principle.
- Built on **Material Design 3-style token naming** (surface / on-surface
  / primary / secondary / tertiary / error, with -container and -fixed
  variants) rather than a bespoke ad hoc palette.

---

## 2. Color Palette

Design system: **Group A** (from `tailwind.config.cjs`, ported from
`public/shared/tailwind-tokens.js`).

### Primary / brand
| Token | Hex | Use |
|---|---|---|
| `primary` | `#005bbf` | Brand blue — buttons, links, key actions |
| `on-primary` | `#ffffff` | Text/icons on primary |
| `primary-container` | `#1a73e8` | Secondary-emphasis brand surfaces |
| `on-primary-container` | `#ffffff` | Text on primary-container |
| `primary-fixed` | `#d8e2ff` | Fixed-tone brand surface |
| `primary-fixed-dim` | `#adc7ff` | Fixed-tone dim variant |
| `on-primary-fixed` | `#001a41` | Text on primary-fixed |
| `on-primary-fixed-variant` | `#004493` | Secondary text on primary-fixed |
| `inverse-primary` | `#adc7ff` | Primary on inverse surfaces |
| `surface-tint` | `#005bc0` | Elevation tint |

### Secondary (amber/gold — accent)
| Token | Hex |
|---|---|
| `secondary` | `#805600` |
| `on-secondary` | `#ffffff` |
| `secondary-container` | `#fdaf0a` |
| `on-secondary-container` | `#694600` |
| `secondary-fixed` | `#ffddb0` |
| `secondary-fixed-dim` | `#ffba45` |
| `on-secondary-fixed` | `#281800` |
| `on-secondary-fixed-variant` | `#614000` |

### Tertiary (green — positive/success accent)
| Token | Hex |
|---|---|
| `tertiary` | `#006d2c` |
| `on-tertiary` | `#ffffff` |
| `tertiary-container` | `#008939` |
| `on-tertiary-container` | `#ffffff` |
| `tertiary-fixed` | `#89fa9b` |
| `tertiary-fixed-dim` | `#6ddd81` |
| `on-tertiary-fixed` | `#002108` |
| `on-tertiary-fixed-variant` | `#005320` |
| `success` | `#006d35` (deliberate extension, kept distinct from `secondary`) |

### Error
| Token | Hex |
|---|---|
| `error` | `#ba1a1a` |
| `on-error` | `#ffffff` |
| `error-container` | `#ffdad6` |
| `on-error-container` | `#93000a` |

### Surfaces / neutrals
| Token | Hex |
|---|---|
| `background` / `surface` / `surface-bright` | `#f7f9ff` |
| `on-background` / `on-surface` | `#181c20` |
| `surface-dim` | `#d7dae0` |
| `surface-variant` | `#dfe3e8` |
| `on-surface-variant` | `#414754` |
| `surface-container-lowest` | `#ffffff` |
| `surface-container-low` | `#f1f4fa` |
| `surface-container` | `#ebeef4` |
| `surface-container-high` | `#e5e8ee` |
| `surface-container-highest` | `#dfe3e8` |
| `inverse-surface` | `#2d3135` |
| `inverse-on-surface` | `#eef1f7` |
| `outline` | `#727785` |
| `outline-variant` | `#c1c6d6` |

---

## 3. Typography

**Font families:**
- **Plus Jakarta Sans** — display, headline (`display-lg`,
  `headline-lg`, `headline-lg-mobile`, `headline-md`, `headline`,
  `display`, `display-lg-mobile`)
- **Inter** — body and label text (`body-md`, `body-lg`, `label-lg`,
  `label-md`, `caption`, `body`, `label`)

**Type scale:**
| Style | Size / line-height | Weight | Letter-spacing |
|---|---|---|---|
| `display-lg` | 48px / 56px | 700 | -0.02em |
| `display-lg-mobile` | 32px / 40px | 700 | -0.01em |
| `headline-lg` | 32px / 40px | 700 | -0.01em |
| `headline-lg-mobile` | 28px / 36px | 700 | — |
| `headline-md` | 24px / 32px | 600 | — |
| `body-lg` | 18px / 28px | 400 | — |
| `body-md` | 16px / 24px | 400 | — |
| `label-lg` | 16px / 20px | 600 | 0.01em |
| `label-md` | 14px / 18px | 600 | 0.02em |
| `caption` | 14px / 20px | 500 | — |

---

## 4. Layout Tokens

**Border radius:** `DEFAULT` 1rem · `lg` 2rem · `xl` 3rem · `full` 9999px

**Spacing scale:** `xs` 4px · `base` 8px · `sm` 12px · `md` 24px ·
`lg` 40px · `xl` 64px · `margin-mobile` 20px · `margin-desktop` 120px ·
`gutter` 16px

**Dark mode:** class-based (`darkMode: 'class'`) — supported at the
token level, not confirmed as fully wired through every page.

---

## 5. UI Components

Current component inventory (from live pages, not a formal component
library yet):

- **6-option mode chooser chip row** — top-of-page pill row (3 chips
  currently: Storytelling, Experiential Learning, Play-Based Learning)
  and a separate attach-icon popup (6 chips) — these two surfaces are
  **not yet unified** (known backlog item).
- **Homework/Quiz modal** — shared component for Homework Help and
  Quiz, differentiated by a mode flag (title, placeholder text, button
  label, result ordering).
- **Parent dashboard cards** — This Week's Goal, 10-minute Math
  Session, Upcoming Live Session, Find a Tutor (reference-quality —
  real photo, warm tone, benefit-first) — the rest are pending the
  same humanization treatment.
- **Bonding/Progress components** — Parent Bonding Score card, Student
  Progress Card, Teacher Dashboard (see
  `bonding-and-teacher-dashboard.md` for settled spec).
- **Play-Based Learning game UI** — turn-based multiplayer quiz
  interface, countdown timer (pending correction to decision-window
  only), Player-of-the-Day badge (planned).
- **Founder/Admin dashboard** (`/admin`) — 6 sections: KPI strip,
  Signups+UTM, Engagement/DAU, Parent Feedback, Revenue, Failed
  Payments.
- **Illustration/bar-model SVG components**
  (`barModelSvgGenerator.js`, `triangleSvgGenerator.js`,
  `illustration/characters.js`) — used for the visual homework-help /
  math-illustration feature line.

**Component design rule:** don't build a new visual treatment from a
generic template — every revenue-facing or parent-facing component
should look and feel like a deliberate, researched piece of support,
not a default UI-kit card.
