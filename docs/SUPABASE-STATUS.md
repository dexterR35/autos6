# Connected Supabase status · 21 October 2026 (updated 25 October 2026)

## 25 October 2026 update

- **Migrations:** `20261025154352_garage_supporters` and `20261025154428_audit_hardening` were applied through the Supabase connector, so all thirteen are live. A drift check beforehand matched the hosted functions to the local files. After applying, `queue_project_notification`, `process_stripe_event` and `get_garage_supporters` matched the local files exactly (identical `pg_get_functiondef` fingerprints). Local filenames were renamed to the hosted versions.
- **Access review (catalog queries):**
  - All ten tables in `public` and `private` have RLS enabled.
  - Donations, Stripe events, subscribers, email jobs and owner invitations have no browser grants.
  - `community_posts` is now readable by column only, excluding `author_id` and `consent_version`.
  - Owner writes are column-scoped and policy-checked.
  - Storage has no anonymous policies; both buckets keep their size and MIME limits.
  - Every SECURITY DEFINER function pins `search_path`. Payment, subscription and email functions are executable by `service_role` only.
- **Rollback smoke test** (on the live database; it ended with an exception, so nothing persisted, and that was confirmed afterwards):
  - Two quick part edits queued one delayed email with the latest text.
  - Unpublish cancelled an update email, republish revived it, delete cancelled it.
  - A refund then a failed refund moved the refunded total 3000 → 0, and a replayed event was a duplicate.
  - A signed-in non-owner could not read `author_id` or donations and updated zero parts.
- **Advisors:** no new kinds of finding. `get_garage_supporters` joins the reviewed, deliberately public SECURITY DEFINER aggregates. Leaked-password protection is still off. Performance shows only unused-index notices (no data yet).
- **Live probes** with the publishable key: anonymous `author_id`/`consent_version` reads now fail with 42501, and `get_garage_supporters` returns 200. `node scripts/verify-supabase.mjs` passes.
- **Owner access:** one invitation is still pending and **expires 27 October 2026 at 22:32 UTC**. The one Auth user has not confirmed an email, so there are no owners yet.

Project `hbjtppfmqyunzeddfjzt` is initialized through the authenticated, project-scoped MCP connection. It was empty before initialization. All eleven migrations are applied, and the local migration filenames now match hosted history (versions use UTC timestamps).

Campaign `project-s6` has ID `006db33e-7594-4b89-b604-4c7c49f58a51`, a $10,000 USD goal and ten initial parts from the existing campaign content. No donation, subscriber, progress update or community post was fabricated. Initial confirmed funding is zero.

## Model release

The public folder is:

```text
https://hbjtppfmqyunzeddfjzt.supabase.co/storage/v1/object/public/project-models/006db33e-7594-4b89-b604-4c7c49f58a51/v1
```

It contains the compressed car, compressed garage and precomputed HDR lighting. All three public downloads were checked against local SHA-256 hashes and have `max-age=31536000`. The app's ignored `.env.local` uses live Supabase data and these public model URLs. Live build output excludes local models and HDR lighting.

MCP has no direct file-upload action. A temporary capability-protected Edge Function issued signed upload URLs for exactly these three fixed paths, without exposing server keys. Unauthorized requests were rejected. Uploads did not overwrite any release. The `model-release-bootstrap` function was then replaced with an inert HTTP 410 handler and JWT verification enabled. It contains no storage calls or credentials; it can be removed from the Dashboard when convenient.

## Owner access

An expiring owner invitation is stored in the private schema for the operator-supplied address. A Supabase email sign-in link was requested. Membership activates only when Auth confirms the matching primary email; the invitation is then consumed. The invitation expires after seven days. No owner permission was granted to an unverified account. Future invitations require trusted SQL; they cannot be manufactured through a browser request.

The local callback preview is running at `http://localhost:3000/admin` to support Supabase's default localhost site URL. Restart it with `npm run dev:web -- --port 3000`. Owner sign-in uses email links and does not create new accounts. For regular development at port 5173 and production, configure Supabase Auth's site URL and the exact `/admin` and `/community` redirect URLs. Keep email confirmation enabled and configure production SMTP before public launch.

## Hosted checks and advisories

- Every public application table has RLS enabled.
- Real anonymous Data API requests cannot read donations, Stripe events, subscribers or email jobs. Server-only payment/subscription RPCs are not executable by either browser role.
- Public campaign/part summaries and published content work with the publishable key. Desktop and mobile browser checks loaded both models from the real Supabase URLs.
- Missing foreign-key indexes and duplicate permissive SELECT policies were fixed in the hosted follow-up migration.
- The [no-policy information notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) are intentional for server-only tables and the private invitation table: browser access is denied.
- The [public SECURITY DEFINER warnings](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [member SECURITY DEFINER warnings](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) remain for deliberately exposed aggregate projections, current-account owner checks and the authenticated, moderated community submission RPC. They pin the search path and enforce explicit publication, consent, identity or membership rules. Private mutation RPCs remain server-only. These are reviewed exceptions, not a claim of zero advisory warnings.
- [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) is not enabled in the hosted Auth settings. The app uses email links, but enable that protection before enabling password-based flows elsewhere. Unused-index information notices are expected on a newly initialized project and are not a reason to remove necessary indexes.

Run `node scripts/verify-supabase.mjs` for read-only live checks. Evidence is under `output/supabase-verification/`; browser evidence is under `output/performance-verification/`. No elevated API key is used by the live verification script.

## Still needed for launch

The Node API needs its server-only Supabase secret key, Stripe secret/webhook configuration, Resend sender/key and a stable subscription signing secret. No such credentials were extracted from OAuth or placed in the frontend. Checkout and update-email delivery remain unavailable until configured. Complete operator/contact/legal content, production origin/Auth redirects, SMTP, backups and provider test transactions using [LAUNCH.md](LAUNCH.md). Supabase hosting and model delivery are complete; this does not certify a public payment launch.
