# Marketing Site — Design Spec

Date: 2026-10-12
Status: draft, awaiting review

---

## Problem

There is nowhere to send someone who asks what Synítheia is or how to get it. The public
surface is the GitHub repository: a README written for engineers, and a Releases page where
an `.apk` and an unsigned `.ipa` sit under a paragraph of install notes. Neither shows what
the app does or what it looks like.

## Solution

One static page at a public address. It shows every feature the released app has, with the
app's screens rebuilt in HTML; says plainly what is unverified or impossible; and offers the
two downloads from the latest GitHub Release.

Success: someone on a phone or a laptop can see what the app does, see what it looks like,
and get the right file for their phone in one tap — and nothing on the page claims more than
the app has been shown to do.

---

## Decisions

Agreed in the design conversation:

| Decision | Choice |
|---|---|
| Hosting | Vercel, project `synitheia`, at `synitheia.vercel.app` if it is still free |
| App screens | Rebuilt in HTML with sample data, not screenshots |
| Order of work | After `v0.2.0` was released (done 2026-10-12), so the page links to a release that has everything it describes |
| Stack | Plain HTML, CSS and a little JavaScript. No framework, no build step, no dependencies |
| Where it lives | `apps/web` in this repository |
| Light and dark | Follows the system setting. No toggle |

Not in this version: a custom domain, analytics, a legal privacy policy or terms, store
listings, real screenshots, other languages, automatic deploys from GitHub, signing the APK
with a private key, and pointing Health Connect's policy link at the site.

---

## The page

One page, ten parts, in this order. "Mock" is an app screen or card rebuilt in HTML.

| # | Section | What it must say | Mock |
|---|---|---|---|
| 1 | Hero | The app's own opening line, "Your day, understood", and its sentence: habits, spending, meals and water tracked together; it notices patterns and asks; it never assumes. Two buttons: Android downloads the `.apk` directly, iPhone jumps to its instructions in section 9, because that file cannot be installed by tapping it | Today: date, greeting, the daily flow ring, one suggestion card, a few timeline rows |
| 2 | One timeline | One feed instead of seven trackers: expenses, habits, food, water, steps, workouts, sleep, calendar events and weather, in the order they happened. The ring is one number for the whole day | The "Your Day" card, grouped by part of the day |
| 3 | Trackers | Six cards, listed below | An expense draft read from a screenshot; a habit card with its streak |
| 4 | It asks before it assumes | The six suggestion rules, listed below. They are rules, not AI. Nothing is recorded until you confirm it | A suggestion card with its evidence, Confirm and Dismiss |
| 5 | Insights you can check | AI insights are off until you turn them on. Only totals and averages are sent, never merchants, notes or places. "Why am I seeing this?" shows the numbers the model was given. Most days produce nothing, and that is correct | An insight card with the "why" panel open |
| 6 | History | A month calendar tinted by how each day went, and a read-only view of any past day | The month grid |
| 7 | Your data | The sources table below. Two separate switches per source: collect it, and let the AI use it. Export everything as JSON. Delete one source's data. Delete the account, which erases rather than flags. Receipt images are not kept unless you choose. Signing up creates an account on a server run by the app's developer | A source card with both switches |
| 8 | What it doesn't do | It does not read SMS, does not read notifications, and has no connection to UPI, each with its reason. Instead you share the payment screenshot, paste the SMS or upload the statement, and everything read from them is a draft until you confirm it | None |
| 9 | Download | Below | None |
| 10 | Footer | Links to the source and to all releases. The page sets no cookies and has no analytics | None |

**Trackers (section 3)**

| Card | Facts |
|---|---|
| Expenses | Add, edit, delete; categories you can rename. Import from a payment screenshot, a receipt photo, pasted SMS text, a CSV or a bank-statement PDF, including password-protected ones. Split with contacts and see who owes you. Subscriptions post themselves on their due date. A monthly budget |
| Habits | Check, count, duration and step habits, daily or weekly. Streaks with a grace day. Step habits complete themselves from health data. An optional reminder per habit |
| Nutrition | Log food with calories and macros, or from a photo. Daily totals. A calorie target suggested from your body details, applied only if you choose it |
| Water | Quick-add against a daily target |
| Body | Height and weight from the health store or typed in; sex and date of birth typed in. BMI and energy estimates |
| Reminders and targets | On-device reminders, daily or on chosen weekdays. One screen for the water, calorie and budget targets |

The section also mentions XP: points for completed habits, logged water and a month kept
within budget.

**The six rules (section 4)**

| Rule | What the card says | The evidence it shows |
|---|---|---|
| Possible meal | "Looks like you had lunch around 1:04 PM" | The food expense and its time; how often you have made a similar purchase; an arrival at a known place, when location is on |
| Low water | "You've had 600 ml today" | Your own recent daily average, never a population norm |
| Unusual spending | "You've spent more than usual for a Friday" | Today's total; your average for that weekday and how many of them it rests on |
| Low activity | "A quieter day than usual" | Today's steps; your recent average |
| Habit slipping | "Reading is usually done by now" | The time you usually finish it, and from how many recent days |
| Workout matches a habit | "Mark Morning run done?" | The workout, its length, and that it came from your health data |

The section also says: a suggestion can arrive as a notification when a background sync
finds one, at most two a day and none overnight.

**Sources (section 7)**

| Source | iPhone | Android | Notes |
|---|---|---|---|
| Health and activity | Apple Health. Not available when the `.ipa` is re-signed with a free Apple ID | Health Connect. New in 0.2.0 and not yet verified on a physical phone | Read-only. Steps, active energy, workouts, sleep, resting heart rate, height, weight |
| Calendar | Yes | Yes | Read-only |
| Weather | Yes | Yes | Approximate area only, while the app is open |
| Location | Yes | Yes | Off by default, while the app is open, best-effort |
| SMS and notifications | No | No | Not available, with the reason |

Background sync is described under this table: Health and Calendar can sync while the app is
closed; the phone decides when; it has not yet been seen to wake on its own on a physical
phone; on Android it carries health data only if Health Connect's background access is
allowed, which not every phone offers.

**Download (section 9)**

Two blocks, each with a button, and one line under each button showing the version, the
release date and the file size.

- **Android.** `Synitheia.apk`, for Android 8.0 or newer. Steps: download, open the file,
  allow the browser to install apps when asked. It is not on the Play Store; install it only
  from this page or from GitHub Releases.
- **iPhone.** `Synitheia-unsigned.ipa`. It cannot be installed by tapping it. It needs a
  computer with Sideloadly or AltStore and an Apple ID. With a free Apple ID the app has to be
  re-signed every seven days and Apple Health does not work.
- **What has been checked**, as a short list: the Android build was installed, launched and
  updated from 0.1.1 on an Android 14 emulator, and has not been run on a physical phone; the
  iPhone build is produced automatically and has not been installed on a phone for this
  version.

---

## Copy rules

These bind every sentence on the page, and a test holds the first group in place.

Must be stated:
- Android health is new and not yet verified on a physical phone.
- Background sync is best-effort and not yet confirmed on a physical phone.
- The iPhone download is unsigned and needs sideloading; Apple Health does not work with a
  free Apple ID.
- The mocks show sample data. Each carries the words "Sample data".
- Signing up creates an account on a server run by the developer.
- The page is not a legal privacy policy.

Must not appear:
- User counts, ratings, testimonials, press quotes or awards. There are none.
- Statement inbox or interval reminders. Neither is usable in the app.
- Sign in with Google or Apple. The Android build has no working Google client, and Apple
  sign-in has not been checked on a sideloaded build, so the page mentions email and
  password only.
- "Automatic" for anything the user has to confirm, and "syncs in the background" without
  its condition.

When the phone checklist in `docs/superpowers/plans/2026-10-10-android-health-connect.md`
has been run, the two "not yet verified" statements change in the page and in the test
together.

---

## Look

Taken from the app's theme (`apps/mobile/src/theme/palette.ts` and `theme.ts`), not invented.

| | Light | Dark |
|---|---|---|
| Page | bone `#FBF9F6` | `#15171A` |
| Card | bone with the app's soft card shadow | `#1A1D21`, no shadow; depth from lightness |
| Inset control | sand `#EFECEA` | `#20242A` |
| Hairline | `#DBDAD7` | `#2C3138` |
| Text | stone `#2D2D2D`, muted `#6B6B68` | `#E6E9EC`, muted `#8D949C` |
| Accent | sage `#7D927D`, deep `#67806A`, wash `#E8EDE8` | `#89A889`, deep `#7A9A7A`, wash `#1F2620` |

- **Type:** Manrope at 400, 500, 600 and 700, served from the site's own `fonts/` folder as
  WOFF2 with its OFL licence beside it. The app's scale sets the proportions: a large tight
  title, 15px-equivalent body at a generous line height, uppercase wide-tracked overlines.
- **Shape:** 32px radius on large cards, 16px on small elements, as in the app.
- **Mark:** the three nested arcs of the app icon, redrawn as inline SVG in the three sage
  tones. It is the logo and, large and faint, the only decoration. No photographs: the
  glass-bowl images in `assets/` are Figma references whose licence is unknown.
- **Mocks:** built from the same tokens as the app, so they follow the system theme too.
  Each is a self-contained block that a real screenshot could replace later.
- **Layout:** one column on a phone. From about 900px, text and mock sit side by side and
  alternate. Content is capped near 1120px. No horizontal scrolling at 320px.
- **Motion:** the ring draws in once, as it does in the app. Nothing else moves, and nothing
  moves when the visitor prefers reduced motion.

Accessibility is part of the look, not an afterthought:
- Text meets 4.5:1 in both themes. White on the app's sage is 3.34:1, a documented exception
  inside the app, and sage text on bone is 4.10:1. So in light mode filled buttons and sage
  text use `#5E7260`, the tone the app already uses for sage text (5.18:1 under white, 4.93:1
  on bone). In dark mode a filled button is the app's `#89A889` with near-black text
  (6.86:1). A test holds every pair.
- Visible focus on everything focusable; tap targets at least 44px; real headings and
  landmarks.
- Each mock is exposed to a screen reader as one labelled image, so sample data is never
  read out as if it were the visitor's.
- Everything works with JavaScript off except the version, date and size line.

---

## How it is built

```
apps/web/
  package.json        name @synitheia/web, no dependencies, one script: test
  vercel.json         serve public/ as is; security headers; long cache for fonts
  public/
    index.html        the page
    styles.css        tokens as custom properties, both themes, every mock
    app.js            release details only
    fonts/            Manrope WOFF2 files and OFL.txt
    icon files        favicon, touch icon and social image, cut from apps/mobile/assets/icon.png
  test/               Node's built-in test runner
```

- **Downloads** are plain links to
  `https://github.com/tmonga2208/synitheia/releases/latest/download/Synitheia.apk` and
  `…/Synitheia-unsigned.ipa`. They follow every future release with no redeploy and do not
  depend on JavaScript.
- **Release details.** `app.js` asks GitHub's public API for the latest release once per
  page load and fills in the version, date and each file's size. If the request fails, is
  rate-limited or an asset is missing, the line keeps its plain fallback text and the
  buttons still work.
- **Nothing else leaves the page.** No analytics, no cookies, no fonts or scripts from
  another host. The content-security policy in `vercel.json` allows the site itself plus
  `api.github.com` for that one request, and forbids inline scripts and inline styles, so
  the mocks are styled by class, never by `style` attributes.
- **Headers:** content-security policy, `X-Content-Type-Options: nosniff`, a
  `Referrer-Policy`, a restrictive `Permissions-Policy`, and no framing by other sites.
- **Weight:** no images except the icon files. First load under 250 KB.
- Joining the workspace makes `pnpm check` run the site's tests. `pnpm-lock.yaml` gains one
  importer entry and no packages.

---

## Deployment

1. **A step only the user can do:** the Vercel CLI on this Mac is logged out, so
   `vercel login` has to be run first.
2. Deploy `apps/web` with the CLI as project `synitheia`: a preview first, checked in
   Chrome, then production.
3. If `synitheia.vercel.app` is no longer free, use the address Vercel assigns and say so.
4. Set the GitHub repository's website field to the live address.
5. Later changes are redeployed by hand. The download buttons never need it.

---

## Testing

| Area | How |
|---|---|
| The two download file names match what the release workflow produces, and the links point at `releases/latest/download/` | Test reading the page and the workflow files |
| No third-party hosts: every absolute URL in the page, stylesheet and script is on `github.com` or `api.github.com`, and the policy in `vercel.json` allows exactly that | Test |
| Contrast: every text and background pair the stylesheet uses meets 4.5:1, in both themes | Test reading the stylesheet's custom properties |
| Every "must be stated" line is on the page and no "must not appear" claim is | Test |
| Structure: one `h1`, no skipped heading levels, every image has alternative text, every in-page link has a target | Test |
| Release details: the happy path, a failed request, a rate-limit answer, a release with an asset missing | Tests on the pure formatting function in `app.js` |
| Weight: what the page loads first stays under 250 KB | Test summing the files the page references |

Checked by hand, in this order:

1. **In Chrome, before deploying:** at 390px and 1280px, in light and in dark; with the
   keyboard only; with JavaScript off; with the GitHub request blocked; with reduced motion.
   A Lighthouse run, fixing what it flags or recording why not.
2. **On the preview deployment:** the same page loads over HTTPS with the headers set.
3. **On production:** both buttons deliver the `v0.2.0` files, and the repository's website
   field opens the page.

---

## Files touched

New: everything under `apps/web/`.

Changed: `README.md` (the layout block lists `web/` and the site's address),
`ARCHITECTURE.md` (a short paragraph: what the site is, that it has no build step, how it is
deployed), `pnpm-lock.yaml` (one importer entry).

Not touched: `apps/mobile`, `apps/api`, `packages/`, and the workflows.
