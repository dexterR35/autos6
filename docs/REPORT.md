# Build verification report (2026-10-04)

## Checks actually run

| Check | Result |
| --- | --- |
| `npm test` (Vitest 5, 10 files) | **99 / 99 passed** |
| `npm run build` (Vite 8) | Passes. Initial JS 334 KB (106 KB gzip). Supabase (214 KB) and Admin (14 KB) are lazy chunks. |
| Playwright screenshots at 1983×793, 1440×900, 1024×768 and 390×844 (`npm run screenshots`) | 20 screenshots in `docs/screenshots/`. **No console errors or page errors.** |
| Visual comparison with `docs/reference/reference-dashboard.png` at 1983×793 | Layout, palette, density, callouts, angle strip, funding panel and rail match closely. The car is drawn somewhat larger than in the reference, because the source photos frame it tighter. |
| Horizontal overflow at 390×844 (all routes) and 1024×768 | 0 px |
| Keyboard | Enter on a hotspot selects the part and syncs its row. Arrow keys move through the angle strip. The donation dialog traps Tab, closes on Escape and restores focus to the opener. |
| Live mode with no Supabase (`VITE_DEMO_MODE=false`) | Banner shown, totals "unavailable", parts list empty with explanation, donate button disabled. No demo money appears. |
| API through the Vite proxy with no credentials | `/api/health` → `{payments:false}`. Checkout → 503 with message. Webhook → 503. |
| Secret scan of `src/`, `server/`, `dist/` | No keys found. `.env.example` files contain empty values only. |
| Calibration panel in production bundle | Removed by tree-shaking (`import.meta.env.DEV` guard). |

## What the tests cover

- **Projection math:** contain/cover/focus fits, letterboxing, cropping, object-position, round-trip, and an anchor staying on the same image feature across four viewport sizes. Anchors outside the visible crop, or under a panel, are hidden rather than clamped.
- **Per-view hotspots:** every view's files exist on disk. Front and rear dots differ. Coilovers and interior have no dot. Interior, engine and top-view are unavailable and never rendered as buttons.
- **UI (jsdom):**
  - Switching to Front swaps the image and the hotspot map together, with no stale layer left behind.
  - Dot clicks and list clicks stay in sync.
  - Selecting an off-camera part switches to a view that shows it.
  - A part with no photo keeps the camera and explains why there's no dot.
  - "Not visible in this angle" appears when needed.
  - Search and status tabs filter rows, counts and dots together.
  - Custom-amount validation works, and the demo checkout never pretends to charge.
  - All routes render.
- **RLS (real migrations in PGlite, with Supabase-like roles and default grants):**
  - Anonymous users can read published content but can't read or write donations or stripe_events, call server functions, or grant themselves ownership.
  - Authenticated non-owners can't modify parts, the project or updates.
  - Owners can write content, but can't change slug or currency or read donations, and can upload only to their own project folder.
  - The public summary counts paid donations only. The public supporters list contains no emails or Stripe ids.
- **Payment API (supertest):**
  - Checkout: validation (minimum, maximum, non-integer, bad slugs, name length), custom amount with part, idempotent retries (one donation, one idempotency key), attempt mismatch → 409, cross-origin → 403, missing Stripe → 503, Stripe error → 502 with the donation left pending, cancellation leaves totals unchanged, and status stays pending until the webhook.
  - Webhook (signed with the real `stripe` library): invalid or forged signature → 400 with no DB writes, paid completion, duplicate counted once, async success and failure, out-of-order delivery, expiry, cumulative refunds (partial, then full), amount mismatch flagged, unknown donation → 500 with rollback so Stripe retries, DB failure → 500, unrelated events ignored.

## Not verified (credentials absent)

- **No real Stripe API calls** were made. `checkout.sessions.create` is mocked; signature verification uses the real library with a local test secret. The hosted Checkout redirect, Stripe CLI forwarding and Dashboard refunds were not exercised.
- **No hosted Supabase project** was used. The SQL was verified on PGlite (Postgres 17) with stubbed `auth` and `storage` schemas. Supabase Auth sign-in, Storage uploads from the admin page, and PostgREST behaviour were not exercised end to end.
- Nothing was deployed, and no live payments were made.

## Bug found and fixed by the tests

`create_pending_donation` first failed with `column reference "project_id" is ambiguous`: PL/pgSQL `returns table` output names collided with table columns. Fixed with `#variable_conflict use_column`.

## Deviations from the brief

- The brief listed six car images. Ten were supplied, so the two rear three-quarter images were added as extra angles, and two near-duplicates were kept but not shown (see `ASSETS.md`).
- Callout chips show the part's condition when it's short ("Scratched", "Needs paint"), otherwise the status label ("Needed", "Upgrade"), matching the reference's mix.
- The reference "View / Upgrade" button on the Roof Box card is shown as a green "Purchased" chip, since that part is bought.

## Update: SEO, GTM and motion (same day)

| Check | Result |
| --- | --- |
| `npm test` | **124 / 124 passed** (adds SEO, build, analytics and layout-stability tests) |
| Production build with `VITE_SITE_URL` + `VITE_GTM_ID` | 8 route pages, `404.html`, `robots.txt` and `sitemap.xml` written. Each page has exactly one title, description, canonical and robots tag. Consent defaults appear before the GTM loader. |
| Hover stability, measured in Chromium (1983×793 and 1440×900) | Hovering every card and dot: **0 DOM changes and 0 card moves**. Clicking a featured part's dot: layout unchanged. |
| View-change motion | Frames captured at 60, 200, 380 and 900 ms: glide-in from the direction of travel, staggered dots, then cards |

Not verified: a real GTM container or GA4 property (no container id was supplied), and Google's Rich Results Test against a live URL.
