# Part cards: goals, funding and purchases

Every part (repair or upgrade) is a card with its own funding goal, photos and an
optional 3D model. Supporters fund a specific part or the general fund through
Stripe. When a part reaches its goal it is marked **Funded** automatically; you
buy it, then record the purchase, which posts the update for supporters.

```
Funding ──(goal reached, automatic)──▶ Funded ──▶ Ordered ──▶ Bought ──▶ Installed
   ▲                                     │        (owner steps, from /admin)
   └──── refund / goal raised ───────────┘
```

## 1. Apply the migration

```
supabase db push            # hosted project
# or: supabase db reset     # local, re-applies everything + seed
```

`supabase/migrations/20261118120000_part_lifecycle.sql` adds:

| What | Details |
| --- | --- |
| `parts.kind` | `repair` or `upgrade` (existing "upgrade" parts are converted) |
| `parts.status` | now `needed`/`upgrade` (open) · `funded` · `ordered` · `bought` · `installed` |
| `parts.image_urls`, `thumbnail_url` | gallery (max 12) + cover image for the card |
| `parts.model_url` | `.glb` shown in the card's 3D viewer |
| `parts.actual_cost_cents` | what you actually paid |
| `parts.funded_at / ordered_at / bought_at / installed_at` | set by the database only |
| `restoration_updates.part_id` | links an update to a part (its "Build log") |
| `record_part_progress()` | owner RPC: change stage + post update in one transaction |

Rules enforced in Postgres (not just the UI):

- A part turns **Funded** when paid, unrefunded, non-quarantined contributions
  reach `estimate_cents` (the goal). A refund, a quarantined payment, or raising
  the goal puts it back to open. Ordered/Bought/Installed are never changed automatically.
- New part checkouts are refused once a part is not open (`409 part_closed`) and
  for more than what is left of the goal (`400 amount_exceeds_remaining`, with
  `remainingCents`). The donation dialog offers "Complete this part: $X". If less
  than $1 is left, a $1 contribution may still finish it. The general fund is always open.
- Two donors paying the last amount at the same moment can overshoot slightly; the
  full amount stays in the ledger (as before) and you decide where the extra goes
  (the terms already say extra funds can go to fitting, labour and future upgrades).
- Stage timestamps can't be written by the browser; only owners (`project_admins`)
  can edit parts, upload media or call `record_part_progress`.

## 2. Add a part card (`/admin` → Parts & goals → Add a part)

1. Name (the slug fills itself; it becomes `/parts/<slug>`), goal in USD, type
   (Upgrade / Repair), priority, condition, description.
2. **Photos**: JPG/PNG/WebP up to 5 MB each, up to 12. Click "Make cover" to choose
   the card image. Stored in the `project-media` bucket under `<project id>/parts/<slug>/`.
3. **3D model**: a `.glb` up to 25 MB, stored in `project-models`. You can also
   paste an `https://` URL instead.
4. Add part. It appears on `/parts` immediately and its link works straight away
   (the server checks the slug in the database before answering 404).

To show the part as a hotspot on the garage car, also add its slug to
`src/data/views.js` (and optionally `src/seo/parts.js` for a pre-rendered share page).

### Preparing a 3D model

Blender: select only the part, **File → Export → glTF 2.0**, format *glTF Binary
(.glb)*, *Selected Objects*, *+Y up*, apply modifiers. Units don't matter; the
viewer centres and frames the model. Then compress (Meshopt is supported, Draco is not):

```
npx gltf-transform optimize part.glb part-web.glb --compress meshopt --texture-compress webp --texture-size 2048
```

Aim for under ~5 MB so it opens quickly on phones. The viewer only downloads the
model when a visitor taps **3D**.

## 3. When a part is funded

`/admin` shows "Ready to buy: …". Subscribers following the part get an email
(the existing batched part-update email).

1. Buy the part.
2. Open the part in `/admin` → **Record purchase / progress**: choose *Ordered*,
   *Bought* or *Installed*, enter what you paid, keep "Post an update" ticked,
   add a title/text and photos (receipt, box, fitted part) → **Save progress**.
3. The card moves along its stepper with dates, the update appears on `/progress`
   and in the part's "Build log", and followers are emailed.

Repeat for *Installed* once it's on the car. You can also set the stage from the
part's edit form without posting an update.

## 4. Stripe

Nothing new to configure if payments already work. The webhook endpoint
`/api/stripe/webhook` must receive:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`,
`charge.refunded`, `refund.failed`, `refund.updated`, and for monthly support
`invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`,
`customer.subscription.deleted`, and the four `charge.dispute.*` events (see docs/SUPPORTER-FEATURES.md).
Funding status is recalculated inside the same database transaction that records
each payment or refund, so it can never drift from the ledger.

## 5. Static hosting note

When the Node server serves the site (`SERVE_STATIC=true`) new part links are
handled automatically. If you host `dist/` on a static host instead, add a rewrite
from `/parts/:slug` to `/parts/index.html`.

## Tests

`tests/part-lifecycle.test.js` (database + Stripe webhook + checkout limits +
owner RPC + share links) and `tests/admin-parts.ui.test.jsx` (owner UI).
