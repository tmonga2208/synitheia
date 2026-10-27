# Expenses: a month you are eased into — design

**Date:** 2026-10-26 · **Status:** described and agreed in conversation ("fine for now"); this document awaits approval before planning.

## Why

After v0.2.2 the user said the app's information is "too on the nose, there is no easing in", and of the Expenses screen in particular: "too clunky, everywhere is text". Their screenshot of September shows why: a heading, the month, its total, a bills card, then every one of 82 payments as a carded row with a grey dot, the payee, "Other" underneath, an amount with ".00", and an arrow. Nothing says what the month was like before the list starts, and every row repeats the same scaffolding.

`design.md` already asks for this: "only show the most relevant information at any given time", "soft transitions", "generous whitespace". `AGENTS.md` asks for progressive disclosure: simple first, detail on purpose.

What the data says matters for the design: September is ₹85,786 over 82 payments, and **93% of it is "Other"**. Most money goes to people and small shops the statement parser cannot categorise. A category breakdown would be one grey slice; the month's real shape is **when** (rent on the 4th, quiet weeks after) and **to whom** (rent, then a few people, then Zepto).

## What the user chose

From three sketches (a quiet summary, small story cards, and the month as a calendar) the user picked the calendar and the summary together: "month with top, then has all". The agreed sketch, top to bottom: the month and its total, the calendar, "Mostly to", every payment. Sketch files (not committed): `.superpowers/brainstorm/*/content/expenses-combined.html`.

## The screen, top to bottom

1. **Top bar:** back arrow and the round **+**. The "YOUR SPENDING / Expenses" heading is removed; the total is the headline.
2. **Month:** `‹  September 2026  ›`, next disabled at the current month (as today).
3. **Total:** one large number in whole rupees ("₹85,786"), and under it one quiet line comparing it with the previous month (rules below). No line when the previous month has nothing.
4. **Calendar:** seven columns, Monday first, weekday initials above, one rounded square per day with its date small inside. A day's square is filled with sage, stronger where more went out. Days with nothing are plain; days still to come in the current month are dimmer still. Tapping a day that has payments moves the list down to that day and gives its group a brief soft highlight. Tapping an empty or future day does nothing.
5. **Mostly to:** the month's six biggest payees by amount, biggest first, as round avatars (the payee's first letter) with the first word of the name and a short amount ("₹42k", "₹5.4k", "₹798"). Scrolls sideways if needed.
6. **Bills & subscriptions** and, when someone owes the user, **Owed**: the existing rows, made compact, placed after "Mostly to".
7. **Every payment:** grouped by day, newest first. A day header ("Sat 19" left, the day's total right, both quiet). Each payment: avatar (first letter; tinted with its category colour unless the category is Other), the payee (or the category name when there is no payee), the note small underneath only if there is one, the amount on the right with paise only when there are some. No arrow, no category caption, no card per day. Tapping a payment opens it, as today. Pull to refresh, loading, empty and error states stay as they are, reworded only where they carry the removed heading.

## Comparison line

`r = this month ÷ previous month`. For a finished month compare whole months; for the current month compare with the previous month up to the same day ("this time in September").

| r | Line |
|---|------|
| < 0.5 | less than half of {prev} |
| 0.5–0.9 | less than {prev} |
| 0.9–1.1 | about the same as {prev} |
| 1.1–2 | more than {prev} |
| ≥ 2 | over twice {prev} |

For the current month, `{prev}` reads "this time in {Month}", counting the previous month up to the same day of the month, or to its last day when it is shorter (the 31st compares with all of a 30-day month). Nothing is shown when the previous month total is zero.

**An empty month** shows the month, "₹0" without a comparison line, the calendar with plain squares, and today's empty state ("Nothing logged in {Month}" with "+ Add an expense") in place of "Mostly to" and the list.

## Easing in

On opening a month: the total counts up from zero (about 1.1 s, easing out); the calendar squares fade and settle in a wave (about 20 ms apart); "Mostly to" and the first eight payments rise in after (about 70 ms apart). Taps work at once; nothing waits on an animation. It plays when the screen opens and each time the user moves to another month, and never on a refresh, a pull-to-refresh, or data arriving from the network after the cached copy was shown. With the system's Reduce Motion on, everything appears in its final state (Reanimated's `useReducedMotion`, as `Skeleton.tsx` already does). Reanimated 4 is installed; no new native modules.

## Data

The list is fetched 200 at a time, so the calendar and "Mostly to" must not be worked out from it. `GET /v1/expenses/totals?from&to` already returns the month's net total; it gains:

- `byDay`: net spent per local date in the range;
- `topPayees`: up to six `{ name, totalMinor, count, categoryName }`, by net amount, keyed by payee (or category name when there is no payee).

The comparison uses the same endpoint for the previous month (its `byDay` gives "this time in" for the current month). Both are cached offline like everything else.

## Two parser fixes (upi-lens-api)

Seen in September's real rows:

- A payee that is only digits is an account number: use the narration's note when it is a real word ("UPI/DR/…/10311434/sbin/…/Rent" → "Rent"), else "Bank transfer". The banks' filler notes do not count: "NO REMARKS" and its truncations ("NO R", "NO REMA"), "UPI", "Pay", "Paym", "Payment", "Sent u…".
- An ACH/NACH debit ("DEBIT ACHDr YESB INDIAN CLEARIN") is "Auto-debit".

Existing expenses with these names are renamed once afterwards, the same way as the 2026-10-26 repair (backup first, through the app's update function).

## Goals

- The screen opens on one number and a picture of the month; the list is there, lower down, for anyone who wants it.
- Less text on every row.
- Numbers that agree: the total, the calendar and "Mostly to" all come from the server's net totals.

## Non-goals

- A category chart or breakdown (93% "Other").
- Tapping a payee to filter, search, budgets.
- Loading beyond the first 200 payments in a month; when the month has more, a quiet line under the list says "Showing the latest 200".
- Other screens.

## Anti-goals

- Anything that adds text instead of replacing it.
- Motion that makes the user wait or replays on every refresh.
- A calendar or payee figure that disagrees with the total.

## Constraints

Expo SDK 54, React Native 0.81, Reanimated 4, no new native modules; dark and light themes through the existing tokens; every tappable thing at least 44 pt (seven squares across a 390 pt screen with 22 pt margins and 6 pt gaps are about 44 pt); screen-reader labels for the total, each day ("Saturday 19 September, ₹4,794, 4 payments") and each payee; pure helpers and the API change covered by tests.

## Calls made in writing this up (check these)

- The current month compares with the previous month up to the same day, not with the whole previous month.
- Square strength is on a log scale relative to the month's biggest day, so one rent day does not wash out the rest.
- Avatars are letters only (no house or repeat glyphs), tinted by category colour.
- Short amounts: "k" below a lakh ("₹5.4k"), "L" from a lakh ("₹1.9L").
- The total is shown in whole rupees; payments keep paise when they have them.
- Bills & subscriptions and Owed sit after "Mostly to" as compact rows.
- An empty month shows "₹0", plain squares and the existing empty state.
- The easing replays on opening and on changing month, never on a refresh.
- The renaming of existing expenses is a script for the user to run, as the auto-mode check stops me writing to production data.

## Left to the builder

Exact sizes, spacing and colour strengths within the theme tokens; animation curves within the timings above; how the list scrolls to a day.
