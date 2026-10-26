# Security review · 21 October 2026

This is an implementation review and automated regression audit, not an external penetration test or compliance certification.

| Finding | Resolution |
| --- | --- |
| Critical shell-quote command-injection advisory through concurrently | Updated concurrently to 10.0.6 and lockfile; npm audit reports zero known advisories |
| Moderate Vite/Windows launch-editor advisory | Updated Vite to 8.3.4 |
| Payment flow could open without a configured webhook | Checkout now requires the webhook secret |
| Successful event with NULL amount/currency could bypass SQL mismatch comparison | Invalid/missing fields normalize to a mismatch; regression tests assert no funding or confirmation |
| Review-flagged donation could appear paid on return | Scoped lookup reports processing while review is required |
| Signed events from the wrong Stripe mode | Rejected before database processing |
| Policy acceptance was not recorded | Required current consent in API, transactional version/time in donations, required hosted Stripe checkbox |
| Retry could reuse different recognition preferences | Transaction rejects changed name/public preference with same attempt UUID |
| API disabled CSP entirely | Script hashes for bootstrap, no executable inline handlers/eval, object/embedding restrictions, configured Supabase origin |
| Browser accepted arbitrary checkout redirect URLs | Redirect restricted to HTTPS checkout.stripe.com |
| Broad owner UPDATE grants | Parts cannot change project identity; update authors/project IDs cannot be replaced |
| Accidental browser exposure of private provider credentials | Vite refuses common server-key prefixes and legacy service-role JWTs before bundling |
| Photo uploads accepted unrestricted media | Storage bucket and form restrict formats and sizes; safe media URL validation |
| Email/subscriber exposure and forged unsubscribe | Private no-client-grant tables, hashed expiring confirmation tokens, HMAC unsubscribe tokens with constant-time checks |
| Duplicate or concurrent email processing | Leases, retries, provider idempotency and pre-delivery consent checks |
| Spam or self-approval in community | Confirmed-email RPC, database rate limits and owner moderation; protected authorship/status |
| Analytics could load before choice | GTM only starts after opt-in; noscript tracking removed; revocation reloads |
| Remote font requests were incompatible with the restrictive CSP | Removed third-party font requests; use the existing system font fallback |
| Free-text search analytics / draft PII | Analytics emits catalogue names rather than raw search; stored donation drafts exclude names and recognition choices |
| Refund return page could thank and track a fully refunded payment | Dedicated refund state; no new purchase event on a refunded return |

## Boundaries checked

React renders community, donor and owner text as text nodes. User content is never injected with `dangerouslySetInnerHTML`. SEO content is escaped and JSON-LD serializes `<` safely. Media rejects script/data/protocol-relative URLs. Database access uses Supabase parameterized RPCs or the query builder; all security-definer functions pin an empty search path. Browser clients receive no grants to donation, event, subscriber or email-job tables. Unconfirmed community content is visible only to its author and project owners. Public aggregates exclude refunds, mismatched currencies and review flags. Funding numbers are derived from the ledger rather than incremented by a client request.

The payment webhook retains raw-body signature validation, event-id deduplication, transactional status transitions, async methods and cumulative refund processing. Rate limiting, bounded JSON, origin checks, HTTPS production configuration, redacted logging and no-store API responses are included.

## Deployment responsibilities

The connected Supabase project's migrations, model release and hosted access checks are now complete; see [SUPABASE-STATUS.md](SUPABASE-STATUS.md) for the actual deployment state, intentionally exposed RPC advisories and remaining Auth/provider settings. Anonymous API probes confirmed that private payment/email tables are inaccessible. Trusted, expiring owner invitations are stored outside the exposed schema and activate only after Auth email confirmation. Owner sign-in uses email links; the hosted leaked-password protection setting still needs operator review.

The operator must still apply migrations, configure credentials/Dashboard settings, test provider integrations, complete/review legal identity and policies, provision owners, secure account access, configure database backups and retention, monitor Stripe/reconciliation and email failures, and configure trusted proxies accurately. In-memory IP rate limits are **per API instance**; deployments with several instances should add shared gateway limits. Confirm actual RLS/grants and storage settings on the hosted Supabase project. A public static host needs the frontend security headers too. Follow the concrete steps in [LAUNCH.md](LAUNCH.md).

Resend handles provider suppressions; this build does not ingest bounce/complaint webhooks. Notification retries stop and remain visible as failed queue rows. Identity-based community rate limits and moderation limit publication abuse; production Auth email/CAPTCHA settings remain operator configuration. Dependency audit results only cover known package advisories, not every possible vulnerability.

## Follow-up review · 25 October 2026

| Finding | Resolution |
| --- | --- |
| New advisories: body-parser DoS through compressed bodies (high, every API route), ip-address quadratic parsing (moderate, via express-rate-limit), undici (high, dev-only via jsdom) | `npm audit fix` updated them to body-parser 2.4.0, ip-address 10.7.5 and undici 8.12.3; npm audit reports zero known advisories |
| Anonymous readers could select `community_posts.author_id`, linking posts by account | Column-level read grants exclude `author_id` and `consent_version`; the row policy still lets members see their own pending posts |
| The supporter wall folded unnamed public donations into the donor's named row by private email | Unnamed donations (empty, "Anonymous", or an email-like name) stay separate rows; named donations still combine by email |
| Every part edit, and every unpublish/republish of an update, emailed all subscribers | 10-minute batching window per part or update; one email per restoration update and subscriber; drafts and deleted items cancel queued emails |
| A failed or cancelled Stripe refund stayed subtracted from funding totals | Refund events (`charge.refunded`, `refund.failed`, `refund.updated`) recount refunds from Stripe and store that total |
| Community posting showed raw database errors, including constraint names | Only the posting function's member-facing messages are shown; other errors use fixed copy |
| Build scripts loaded whichever glTF Transform CLI was in the npx cache | `@gltf-transform/cli` pinned at 4.5.1 as a dev dependency; the npx-cache search was removed |

`supabase/migrations/20261025154428_audit_hardening.sql` (and the preceding `20261025154352_garage_supporters.sql`) were applied to the hosted project on 25 October 2026; hosted function definitions were checked against the local files. Still to do: add the two new refund events to the Stripe webhook endpoint (see [LAUNCH.md](LAUNCH.md)).
