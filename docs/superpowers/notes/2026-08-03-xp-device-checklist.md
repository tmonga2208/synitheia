# XP — device checklist and follow-ups

Branch: `feature/xp`. Spec: `docs/superpowers/specs/2026-08-02-xp-design.md`.

There is no React Native component test infrastructure and this branch did not add one,
so everything below is a device-pass item rather than a test.

## Device pass

- [ ] **Today chip moves on the first habit.** Before this branch `user.xp` was always 0,
      so the chip read "Start Collecting" forever. Complete one habit; the chip should
      flip and show 5. Awards land via the `['today']` invalidation the mutations already
      do — no new wiring.
- [ ] **Profile chip is no longer stale.** This is the one that was actually broken. It
      reads `user.xp` from the zustand auth store, which was populated only at app start,
      so a user could earn 50 XP and still read "Start collecting XP" until they
      force-quit. Earn XP, then open Profile *without* relaunching.
- [ ] **Profile refresh does not sign you out offline.** Put the device in airplane mode
      and focus Profile. You must stay signed in with the last known XP still showing.
      `refreshUser()` exists precisely because `hydrate()` clears the Keychain and drops
      to `anon` on *any* throw, a network blip included — a focus effect on `hydrate`
      would have signed people out for opening a tab.
- [ ] **The day bonus.** Complete every habit scheduled today; the total should move by
      5 per habit plus 10 once.
- [ ] **Nothing scolds.** Spend a month over budget and confirm there is no message, no
      deduction, and no notice of any kind. An over-budget month simply earns nothing.

## Deploy

- **The `XpAward` unique index is load-bearing** — it is the only thing preventing a
  double-award, and a double-award has no user-visible symptom. `index.ts` now awaits
  `XpAwardModel.init()` before `listen()`, so a failed build is a loud boot failure
  rather than a collection that silently stops enforcing. If the process exits at boot
  with an 11000, the collection already holds duplicates: dedupe it, then redeploy.
- Production index building for the *other* collections is still nobody's job. That
  predates this branch and is unchanged, but it is worth its own fix.

## Known and deliberate

- **Existing users are not backfilled.** A user with a month of history opens the app and
  still sees 0 XP, then watches it start moving. Backfilling from `HabitLog` would be
  reading history rather than inventing it and is defensible, but it is a migration with
  its own failure modes. Recorded as a follow-up rather than pretended away.
- **Calories earn nothing.** The award would have to mean "within a range" rather than
  "reached a number", and that is a judgement about food this app is otherwise careful
  not to make. Water has an unambiguous direction; calories do not.
- **XP is never revoked.** Uncheck a habit and it stays. You did it; the record says so.

## Repair tool

`apps/api/src/scripts/recompute-xp.ts` sums the ledger per user and sets `user.xp` from
it. `user.xp` is a cache; the ledger is the truth. Run it if the two ever disagree —
a grant that throws mid-batch leaves rows committed with no increment, and nothing
retries. Safe to run twice: it no-ops where the total already agrees.
