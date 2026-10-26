# Project S6 launch guide

## Product rules

- The campaign target is **$10,000 USD**, independent of the combined parts budget.
- Each part has a price target and an `important` or `standard` priority. Purchase status remains `needed`, `upgrade` or `bought`.
- A confirmed part contribution advances that part and the campaign once. A general contribution advances only the campaign. Refunds reduce both applicable totals. Pending, failed and quarantined payments do not count.
- Displayed campaign funding stops at $10,000 and each part stops at its own price. The private ledger retains every cent. Payments remain open after targets are reached. A funded part is not automatically marked bought.
- Both donation entry points offer **$5 / $25 / Custom**. The default transaction limits are $1–$10,000.
- Email subscriptions are free updates, with an optional followed part. They are separate from payment, public recognition, analytics and community sign-in. They never create recurring charges.

## 1. Supabase

Apply **all migrations in filename order** to an existing database. Do not reset a production database. For a fresh database, apply migrations and then `supabase/seed.sql`. The connected project is initialized; see [SUPABASE-STATUS.md](SUPABASE-STATUS.md). Local migration versions match its hosted history.

New objects:

| Object | Purpose / access |
| --- | --- |
| `parts.priority` | Owner-editable important/standard classification |
| `get_part_funding(slug)` | Public net funding per part; no donor records |
| `donations.terms_version`, `terms_accepted_at`, `privacy_version` | Private record of accepted policy version |
| `create_consented_donation` | Server-only transactional consent + pending donation |
| `subscribers` | Private email, preference, consent, confirmation and unsubscribe state |
| `email_jobs` | Private durable queue, leases, retry counters and delivery metadata |
| `community_posts` | Authenticated submissions, parent replies and moderation state |
| `request_subscription`, `confirm_subscription`, `unsubscribe_member` | Server-only subscription mutations |
| `claim_email_jobs`, `finish_email_job` | Server-only delivery coordination |
| `create_community_post` | Authenticated, confirmed-email-only, rate-limited submissions |

Existing grants are tightened so owners cannot move parts between projects or replace update authors. Storage accepts JPG, PNG and WebP only, up to 5 MB per object. The $10,000 USD goal is also enforced in PostgreSQL.

Provision an owner using the README's trusted SQL step. Under Supabase Auth, enable email confirmation, configure your **public site URL**, and add `https://your-domain/community` to the redirect allowlist. Configure production SMTP and Auth rate limits; enable Supabase CAPTCHA for sign-in if public abuse warrants it. Community members request a magic link and must verify their email before posting. Operator review at `/admin` is required before members' posts/replies appear publicly. Rate limit: one post per minute and five per hour per account, enforced transactionally in Postgres.

Alternatively create an expiring invitation in `private.project_owner_invitations` through trusted SQL. Its Auth trigger consumes the invitation and grants membership after the matching primary email is confirmed. Invitations are never exposed through the Data API. Keep Auth email confirmation enabled and add the production `/admin` URL to the redirect allowlist too.

## 2. Public configuration and legal copy

Set browser-safe values in `.env`:

```dotenv
VITE_DEMO_MODE=false
VITE_PROJECT_SLUG=project-s6
VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-KEY
VITE_SITE_URL=https://your-domain.example
VITE_OPERATOR_NAME=Your real operator name
VITE_CONTACT_EMAIL=your-support-address@example.com
VITE_MODEL_ASSET_BASE_URL=https://YOUR-REF.supabase.co/storage/v1/object/public/project-models/YOUR-PROJECT-UUID/v1
```

Review `/terms`, `/privacy` and About before launch. Complete the operator's identity and contact details, actual project story, refund process, retention schedule, applicable privacy bases and provider agreements. The supplied policy copy describes app behavior and is a **draft requiring operator/legal review**, not a certification of compliance. Filling in two environment values alone does not complete that review. The live browser checkout stays disabled until identity and contact fields exist. Production API startup also requires operator details when a Stripe key is configured.

## 3. Stripe

Live model hosting must also be configured: apply the model bucket migration, upload the compressed assets, and set the matching public URL on frontend and API. Follow [MODEL-HOSTING.md](MODEL-HOSTING.md). Live builds intentionally exclude local models.

Set the following in **server/.env**, never in `VITE_` variables:

```dotenv
SUPABASE_URL=https://YOUR-REF.supabase.co
SUPABASE_SECRET_KEY=YOUR-SERVER-SECRET
STRIPE_SECRET_KEY=YOUR-STRIPE-SECRET
STRIPE_WEBHOOK_SECRET=YOUR-ENDPOINT-SIGNING-SECRET
APP_ORIGIN=https://your-domain.example
OPERATOR_NAME=Your real operator name
CONTACT_EMAIL=your-support-address@example.com
NODE_ENV=production
SERVE_STATIC=true
# Set to the actual number of trusted reverse proxies, not an arbitrary value.
TRUST_PROXY=1
```

In Stripe's public business settings, configure the terms URL (`/terms`), privacy URL (`/privacy`) and support contact. Checkout requests **required terms acceptance**. Without the Dashboard terms setup, Stripe can reject session creation. Confirm the activated Stripe account supports your actual project/business model.

Register `/api/stripe/webhook` for:

```
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
charge.refunded
refund.failed
refund.updated
```

Each refund event makes the API recount the payment's refunds from Stripe, so the API's secret key needs read access to refunds. Failed or cancelled refunds are left out of the recount, which puts the money back into the totals. Without `refund.failed` and `refund.updated`, a failed refund stays subtracted.

Test first with a test key and test endpoint secret. API/webhook modes must match. Checkout refuses to open without a signing secret. Run a test contribution to a part, a general contribution, a duplicate webhook replay, an async payment and a refund. Verify both aggregate RPCs and the return page. The redirect URL never confirms payment. Check Stripe webhook failures and reconcile the private ledger with Stripe when operating the site.

## 4. Email updates

Create a Resend API key with send permission and verify your sending domain (SPF/DKIM). Configure:

```dotenv
RESEND_API_KEY=YOUR-SERVER-ONLY-KEY
EMAIL_FROM=Project S6 <updates@your-verified-domain.example>
SUBSCRIPTION_SIGNING_SECRET=AT-LEAST-32-RANDOM-CHARACTERS
```

Generate a signing secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep it stable and private: rotating it invalidates existing unsubscribe links.

Update emails wait 10 minutes before sending. Further edits to the same part or restoration update in that window rewrite the queued email instead of adding another. Each restoration update is emailed once per subscriber: unpublishing a queued one cancels it, and republishing never resends one already sent. Deleting a part or update cancels its queued emails. The API process runs the queue worker every 30 seconds. Keep the Node process running; an ephemeral static-only or request-only deployment cannot deliver this queue. Multiple always-running API instances can share the queue: PostgreSQL leases with `SKIP LOCKED` coordinate delivery and Resend receives a stable idempotency key. Retries stop at eight attempts or twelve hours; expired leases can be reclaimed. Failed delivery requires operator attention. Monitor your provider's bounce/complaint suppressions and account/domain health.

The flow is:

1. Unchecked, separate email consent; generic response avoids exposing whether an address is subscribed.
2. Private pending row + durable confirmation email job. Repeated requests are throttled for an hour per existing address.
3. Email link opens a confirmation page; **explicit POST** activates the subscription. GET requests by mail scanners do not activate it. The random token expires after 24 hours; only its SHA-256 hash is stored on the subscriber. The private pending email payload necessarily contains its delivery URL and is cleared after successful delivery.
4. Part additions/edits and published build updates create jobs for matching **active** subscribers. A followed-part subscriber receives changes to that part and general restoration updates. All-build subscribers receive all part changes.
5. Consent is rechecked immediately before sending. Every email includes signed unsubscribe links and RFC 8058 one-click headers. Unsubscribe cancels pending jobs. A message already handed to the provider may still arrive.

Confirm delivery and unsubscribe with your own address before opening public subscriptions. Test cancellation while work is queued. Review jobs in the private Supabase dashboard; never expose subscriber/email-job tables through the browser. Set and operate your retention/deletion process for unconfirmed and unsubscribed addresses, failed payloads, email metadata, community accounts and financial records. There is no automatic financial-record deletion job.

## 5. Hosting and verification

Run `npm run build`, then deploy the built frontend **and** the real Node API. Recommended setup: one service with `SERVE_STATIC=true`, or the same public origin reverse-proxying `/api` to Node. The API static server supplies CSP, no-referrer, anti-framing, content-type and other Helmet headers. A separate static host must apply equivalent headers; Express cannot set headers on a different host's frontend responses.

The CSP hashes the installed analytics bootstrap, permits no inline script handlers or eval, and allows the configured Supabase endpoint. If you add trusted third-party assets, update the policy deliberately. Optional analytics only loads after opt-in; there is no pre-consent GTM noscript request. Consent revocation reloads the page so the container does not continue running. Configure the GTM container to respect consent and keep sensitive data out of custom tags.

Run:

```bash
npm test
npm run build
npm audit
# With npm run dev active; uses installed Edge and real WebGL:
node scripts/verify-funding.mjs
# Builds and serves a temporary copy to check actual CSP and analytics consent:
node scripts/verify-csp.mjs
```

`output/funding-verification/` contains screenshots and a browser report. Hosted migrations are applied (see [SUPABASE-STATUS.md](SUPABASE-STATUS.md)); no live charge or real email send has been performed in this workspace. Finish the live smoke tests above before calling the deployment production-ready.

## 6. Search, sharing and ad pixels

**Before the production build**
- Set `VITE_SITE_URL` to the final `https://` origin, without a trailing slash. Canonical links, `og:url`, share images, structured data and `sitemap.xml` need absolute URLs; without it they are left out rather than wrong. Use `VITE_NOINDEX=true` on staging and preview deployments.
- The build writes a crawlable HTML page per route, including one per part (`/parts/<slug>`), each with its own title, description, canonical, share image and JSON-LD (breadcrumbs, the part, and the list of parts on `/parts`; no price or offer markup).
- Adding or renaming a part: edit `src/seo/parts.js`, then run `node scripts/make-og-images.mjs` to rebuild `public/og/parts/<slug>.jpg`. Parts that exist only in the database still open at `/parts/<slug>` in the app, but are not pre-rendered or in the sitemap.

**After launch**
- Submit `https://<domain>/sitemap.xml` in Google Search Console and Bing Webmaster Tools, and request indexing for `/` and `/parts`.
- Check share previews with the Facebook Sharing Debugger and LinkedIn Post Inspector for `/` and one part page.

**Ad pixels** (all optional; each loads only after the visitor accepts marketing cookies)
- Meta: `VITE_META_PIXEL_ID`. TikTok: `VITE_TIKTOK_PIXEL_ID`. Google Ads: `VITE_GOOGLE_ADS_ID` (`AW-…`) and `VITE_GOOGLE_ADS_DONATION_LABEL` from a "Donation" conversion action. If your GTM container holds ad tags, set `VITE_GTM_MARKETING=true`.
- Set the same variables for the API process that serves the site: its CSP only allows a vendor's hosts when that vendor is configured.
- In Meta and TikTok Events Manager keep **automatic advanced matching off**. The site's forms collect emails, which must not be sent to ad platforms. Meta's automatic event setup is already disabled in code.
- Events: page views, `ViewContent` (part), `InitiateCheckout`, and for confirmed donations Meta `Donate`, TikTok `CompletePayment` and the Google Ads conversion, deduplicated with the hashed transaction id. Verify with Meta Pixel Helper, TikTok Pixel Helper and Google Tag Assistant after accepting cookies.
- `node scripts/verify-csp.mjs` builds the site with every pixel configured and checks consent, CSP and secret removal in a real browser.
- Pixels and analytics never see the Stripe session id or email-link tokens: they are moved out of the address before any tracker loads (`src/lib/urlScrub.js`, plus the same step inline before GTM).

References: [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment), [Stripe custom components and policies](https://docs.stripe.com/payments/checkout/custom-components), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase function security](https://supabase.com/docs/guides/database/functions), [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email).
