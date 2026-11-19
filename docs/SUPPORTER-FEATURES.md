# Supporter features: setup and how they work

Migration: `supabase/migrations/20261119090000_supporter_features.sql` (apply after
`20261118120000_part_lifecycle.sql`):

```
supabase db push
```

It also moves the terms/privacy **policy version to `2026-11-19`** (terms now cover
monthly support, donor emails, votes and currencies). Deploy the database and the
site/API together: an old browser tab sending the old version gets "please accept the
current terms" and simply ticks the box again.

| Feature | Where | Owner action |
| --- | --- | --- |
| Installed parts on the 3D car | Garage | Upload a `.glb`, set "Show on 3D car", mark Installed |
| Where the money went | `/spending` | Enter what you paid + receipt photo |
| Share cards | Any `/parts/<slug>` link | Nothing (automatic) |
| Leftover money → general fund | `/spending` | Nothing (automatic) |
| Next up (max 3) | Top of `/parts` | Tick "Next up" on a part |
| Monthly support | Donate dialog → Monthly | Stripe settings below |
| EUR / RON / GBP | Admin → Campaign copy | Change before the first payment |
| Supporter votes | `/community` | Admin → Supporter votes |
| Funded by | Part details | Nothing (donors who chose to be shown) |
| Donor update emails | Donate dialog checkbox | Nothing |
| Before / after slider | Part details | Upload before + after photos |
| Reorder / duplicate / CSV import | Admin → Parts & goals | — |
| Daily digest | Your inbox | Set email env vars |
| Error monitoring | Sentry | Set `SENTRY_DSN` / `VITE_SENTRY_DSN` |
| Backups | `npm run db:backup` | Run it, and test a restore |

---

## Installed parts on the 3D car

When a part is **Installed** and has a 3D model, the garage car shows that model instead
of the original piece. Choose how it is placed (Admin → part → "Show on 3D car"):

- **Fit into the original part** (default): the model is scaled and centred into the
  bounding box of the car's own mesh for that part (meshes tagged with the part's slug
  in the car GLB, e.g. `hood`, `front-bumper`, `wheels`). Export the part alone from
  Blender; units don't matter. Best for quick swaps.
- **Exported in car coordinates**: export the part from the same Blender scene as the
  car (`output/car-refinement/.../audi_s6_modular.blend`), without moving it. It is
  placed exactly where it was. Use this for precise fitment, or for a part the car mesh
  doesn't have (a spoiler, roof rails): "Fit" needs an original mesh to size against.
- **Don't show on the car**.

The original mesh is hidden (not deleted) and comes back if the status changes.
Clicking the new model still opens the part. Keep models under ~5 MB
(`npx gltf-transform optimize in.glb out.glb --compress meshopt`).

## Where the money went (`/spending`)

Built only from public data: each part's goal, net paid support, what you entered as
paid (Record purchase / progress), receipt photo, and the campaign total.

- **Extra beyond a part's goal** (two donors paying the last bit at once) and **savings**
  (a part cost less than it raised) are shown as going to the general fund.
- **Topped up** shows when a part cost more than it raised.
- Receipts are **public**: crop out your address, card digits and names before uploading.

## Share cards

Every part link (`/parts/hood`) now has a live preview image for Facebook, WhatsApp,
X, Discord, etc.: cover photo, name, stage, progress bar, "€120 to go", supporters.
Served by the API at `/api/og/parts/<slug>.png` (cached 10 minutes) and injected into
the page `<head>` when the Node server serves the site (`SERVE_STATIC=true`).
Cover photos are only fetched from your Supabase storage or your own site.

Test a link: <https://developers.facebook.com/tools/debug/> (click "Scrape again" after changes).
Parts also have a **Share this part** button (phone share sheet, or copy link).

## Next up

Tick **Next up** on up to three open parts. They appear at the top of the Parts page.
A part leaves the list automatically when it becomes funded. The database enforces the
limit of three.

## Monthly support (Stripe subscriptions)

Supporters choose **Monthly** in the donate dialog. Each month Stripe charges them and
the paid invoice becomes a normal contribution in the ledger (refunds work the same).
Money for a part counts toward it while it is raising; after it is funded, later months
go to the general fund automatically.

Stripe setup (test mode first, then live):

1. **Webhook** → your endpoint `/api/stripe/webhook` → add these events to the existing ones:
   `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, and for chargebacks `charge.dispute.created`,
   `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_reinstated`.
   Set the endpoint's **API version to `2026-09-30.endive`** (the version the installed
   `stripe` library uses); older versions also work, but matching avoids surprises.
2. **Settings → Billing → Customer portal** → activate it; allow "Cancel subscriptions"
   and "Update payment methods"; turn **off** "switch plans / update quantities" (a changed
   amount would be held for review). Click **Activate link** and put that login link
   (`https://billing.stripe.com/p/login/…`) in `VITE_STRIPE_PORTAL_LOGIN_URL`: the Donations
   page then shows **Manage monthly support**, where supporters sign in with their email and a
   one-time code. The button on the confirmation page works for 2 days after checkout.
3. **Settings → Customer emails** → turn on receipts for successful payments. If your
   Stripe account offers a "link to the customer portal" in emails, enable it too, so
   supporters can cancel from any receipt.
4. Optional: **Settings → Billing → Subscriptions → Manage failed payments** (Smart
   Retries). After the final retry Stripe cancels the subscription; the site updates itself.

Test with a real test-mode checkout (card `4242 4242 4242 4242`): the first month's
`invoice.paid` creates the contribution, and **Manage monthly support** opens the portal
where you can cancel. Later months go through exactly the same `invoice.paid` path
(covered by the automated tests). `stripe trigger invoice.paid` won't work: its fake
invoice has no `recurring_id`, so the site correctly ignores it.

## Chargebacks (disputes)

When a supporter's bank disputes a payment, it leaves every total (and a part can drop
back from Funded to raising) until the dispute is won. A lost dispute stays out. You see
disputed payments in the daily digest's "payments need review" count; respond to them in
the Stripe Dashboard → Disputes.

## Currency (USD, EUR, RON, GBP)

Admin → Campaign copy → **Currency**. Goals keep their numbers (450 becomes €450).
It can only change before any payment exists in the current currency (and not while a
checkout from the last 25 hours could still complete), because totals only count money in
the project's currency. Stripe's minimum charge is 2.00 lei for RON, so the site requires
at least 2 lei there (1.00 in the other currencies). Stripe Checkout shows Apple Pay, Google Pay
and local methods automatically when enabled in **Settings → Payment methods**
(for Apple Pay on Stripe-hosted Checkout no domain setup is needed).

## Supporter votes

Admin → **Supporter votes** → question, 2–8 options (label, estimate, note, photo),
optional closing date. Supporters sign in with an email link on the Community page;
one vote per confirmed account, changeable until it closes. Only totals are public.
**Close vote** with a winner and "Turn the winner into an open part card" creates the
part (needs the option's estimate) and links the vote to it.

## Funded by

Part details list the names of people who contributed to that part **and** chose
"Show me on the supporter wall". Names are merged case-insensitively; refunded
contributions disappear.

## Update emails for donors

The donate dialog has "Email me when the … is bought and fitted". If ticked, once the
payment is confirmed the donor follows that part (or everything, for the general fund)
using the email they gave Stripe. They are emailed when the part changes stage (e.g.
"Hood is bought") and when you post an update. Existing subscriptions are never narrowed.
Every email has an unsubscribe link.

## Admin: reorder, duplicate, CSV import

- ↑ / ↓ on each part reorders the cards (one transaction).
- **Duplicate** copies a part (photos, model, goal) as "… (copy)" with a new slug.
- **Import parts from a CSV file**: header row `name,goal,type,priority,condition,description`
  (only name and goal required). Works with Excel files saved as CSV, including
  semicolon-separated files and amounts like `1.250,00 lei`. You see a preview and errors
  by row before anything is saved; nothing is imported unless every row is valid.

## Daily owner digest

Once a day (after `DIGEST_HOUR_UTC`, default 06:00 UTC = 08:00 Bucharest in winter) each
owner gets: yesterday's money and contributions, refunds, newly funded parts, parts ready
to buy, payments needing review, community posts waiting, monthly supporters and failed
monthly payments. Quiet days are skipped unless `DIGEST_WHEN_QUIET=true`.
Needs `RESEND_API_KEY` and `EMAIL_FROM` (same as update emails). If several API servers
run, only one sends. Turn off with `OWNER_DIGEST=false`.

## Error monitoring (Sentry)

Create a Sentry project (free tier is fine), then set:

- API (`server/.env`): `SENTRY_DSN=<server DSN>` and `VITE_SENTRY_DSN=<browser DSN>` (for the CSP).
- Frontend build (`.env`): `VITE_SENTRY_DSN=<browser DSN>`, then rebuild.

Nothing is sent without a DSN. No IP addresses, cookies, request bodies or emails are
sent; URLs are stripped of query strings (checkout session ids). The browser SDK loads
after the page is idle, in its own file.

## Backups

Supabase Pro takes daily backups (Dashboard → Database → Backups); the free plan does
not. Either way, keep your own copy before launch and monthly:

```
npx supabase login
npx supabase link --project-ref <your-project-ref>
npm run db:backup          # → backups/<date>/roles.sql, schema.sql, data.sql
```

The backup contains donor emails: store it encrypted, never commit it (`backups/` is
git-ignored). **Test a restore** once into a scratch project:

```
psql "<scratch db url>" -f backups/<date>/roles.sql
psql "<scratch db url>" -f backups/<date>/schema.sql
psql "<scratch db url>" -c "SET session_replication_role = replica" -f backups/<date>/data.sql
```

Storage files (photos, models) are not in the database dump; download the
`project-media` and `project-models` buckets from the dashboard if you need them.
