# Tut-P pricing tiers: spec for the tier-gating task

Status: **spec only, not built.** Founder decision, recorded 2026-09-26.

Build order: this comes after (1) the AI-route security fix, (2) the billing stopgap (30-day `paid_until`) and (3) the cost-reduction task (model routing and caching).

## Tiers

All tiers are per child. Paid tiers are monthly. Daily limits reset at IST midnight.

| Tier | Price | Homework Help | Quiz | Storytelling | Experiential | Play-Based | Extras |
|---|---|---|---|---|---|---|---|
| Free | ₹0 | 5, lifetime | 5 other sessions in total, lifetime, shared across Quiz, Storytelling, Experiential and Play-Based (existing cap) | ← same | ← same | ← same | – |
| Pro | ₹500/month | 6/day | 2/day | 1/day | Locked (upgrade prompt) | Locked (upgrade prompt) | – |
| UltraPro | ₹1,500/month | 10/day | 5/day | 3/day | 3/day | 2/day | Online Exam joins when built |
| Max | ₹2,500/month | 15/day | 8/day¹ | 5/day¹ | 5/day¹ | 3/day² | Singapore Math (bar-model "Formal"), illustrated notes, 2 free tutor contacts/month |
| Annual Pro | ₹5,000/year | Same as Pro | Same as Pro | Same as Pro | Same as Pro | Same as Pro | – |

¹ Max limits are 1.5× UltraPro, rounded up.
² Play-Based is counted per family, not per child. See resolved question 1.

- **Max is not sold** until its extra features ship. Show it as **"Coming soon · Notify me"**.
- **Annual Pro** gives a 365-day `paid_until`, computed by the same helper as monthly payments.
- **The paid fair-use cap (15/day, theft protection) is replaced** by these per-mode limits once gating ships.

## Economics target

- Per-session cost must reach **about ₹1.5** (through caching and model routing) before these limits are profitable in the worst case.
- **Tier gating ships only after** the cost-reduction task reports real per-session costs from token logging (`ai.call` events).
- Adjust the limits if real costs differ.

Worst case at ₹1.5 per session, with every daily limit used for 30 days (reference only, not a target):

| Tier | Sessions/day at the cap | API cost/month | Price |
|---|---|---|---|
| Pro | 9 | ₹405 | ₹500 |
| UltraPro | 23 | ₹1,035 | ₹1,500 |
| Max | 36 | ₹1,620 | ₹2,500 (plus 2 tutor contacts, i.e. ₹200 of forgone fees) |

These figures ignore GST and the Razorpay fee (about 2% plus GST on the fee).

## UX

- **Remaining usage:** the dashboard shows it per child, e.g. "Today: 4 of 6 homework left".
- **Hitting a limit:** a friendly message plus a one-tap upgrade to the next tier. Never a dead end.
- **Locked modes:** stay visible with a lock icon and the tier name that unlocks them (a visible upgrade path), not hidden.

## Resolved questions (founder decisions, 2026-09-26)

1. **Play-Based limit.** Counted per family per day, using the highest tier among the family's children.
2. **Free → Pro.** A child's unused lifetime free "other" sessions (up to 5) stay usable for Pro-locked modes (Experiential, Play-Based). Once they're used up, the mode shows the lock and "Unlock with UltraPro". Principle: **upgrading never removes access.**
3. **Max fractional limits: round up.** Quiz 8/day, Storytelling 5/day, Experiential 5/day.
4. **Mid-period upgrade.** The new tier starts immediately. The pro-rata value of the old period's remaining days is deducted from the new price.
5. **Downgrade.** Takes effect at the end of the current period, with no refund.
6. **Annual Pro refund.** Full refund within 7 days of payment, none after. **The refund policy page must state this.** No such page exists yet; it needs creating before Annual Pro is sold.
7. **Mixed tiers in a family.** Each child renews independently. The dashboard also offers one "Renew all" checkout for the total.
