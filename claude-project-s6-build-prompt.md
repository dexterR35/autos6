# Claude build prompt — Project S6 restoration donation website

Copy this prompt into Claude Code and provide all seven original PNGs alongside it. The images are required inputs; this Markdown does not embed their bytes. Build the working application, not only a design proposal.

## Your task

You are a senior frontend engineer with strong visual implementation skills. Create a complete car restoration crowdfunding website called **PROJECT S6**, using **React, Vite, JavaScript, Stripe, and Supabase**. Reproduce the supplied dashboard's composition, colors, density, hierarchy, and interaction style as closely as possible. Use real HTML controls and real car images. Do not use the dashboard screenshot as the entire webpage.

The current viewer is **2D images with interactive dots anchored to car parts**. Each selected camera image has its own dot positions and visible parts. Keep the same UI shell and colors when switching angles. Prepare a clean viewer interface for a future Three.js renderer, but do not install or implement Three.js now.

The deliverable is a runnable repository with frontend, backend functions, SQL migrations, demo data, meaningful tests, setup documentation, and a complete donation flow in Stripe test mode when credentials are supplied. Do not deploy or charge live payments as part of development.

## 1. Inspect and map the supplied assets first

The original assets were visually inspected for this specification. Verify them yourself before implementation and locate their actual paths in the repository. Their names are authoritative; do not infer camera angles from suffix numbers.

| Original filename | Dimensions | Observed content | Suggested local name / use |
| --- | --- | --- | --- |
| `Neon Audi S6 Garage Dashboard(2).png` | 1983 × 793 | Complete reference dashboard with header, car scene, hotspot cards, angle strip, donation panel, and right parts list | `reference-dashboard.png`; visual reference only |
| `ChatGPT Image Oct 4, 2026, 01_38_30 AM-1.png` | 1672 × 941 | Front three-quarter car in neon garage; nose points right; roof box | `exterior-a.png`; default Exterior |
| `ChatGPT Image Oct 4, 2026, 01_38_31 AM-2.png` | 1672 × 941 | Straight rear, taillights, roof box and exhaust tips | `rear.png`; Rear |
| `ChatGPT Image Oct 4, 2026, 01_38_32 AM-3.png` | 1672 × 941 | Side profile, nose points right | `side-a.png`; Side A |
| `ChatGPT Image Oct 4, 2026, 01_38_35 AM-7.png` | 1672 × 941 | Straight front, headlights, grille, bumper and roof box | `front.png`; Front |
| `ChatGPT Image Oct 4, 2026, 01_38_35 AM-8.png` | 1672 × 941 | Another side profile, also nose points right; composition close to Side A | `side-b.png`; Side B |
| `ChatGPT Image Oct 4, 2026, 01_38_36 AM-9.png` | 1672 × 941 | Closer front three-quarter composition, nose points right | `exterior-b.png`; Exterior close |

All PNGs report RGBA, but visually contain full garage scenes. Preserve the backgrounds. These are not isolated transparent car cutouts.

There are **no standalone interior, engine, top-view, opposite-side, or individual part thumbnail assets** in the supplied set. Do not relabel either side image as an independently verified left/right side: both show the fuel-door side, with the nose pointing right. Use Side A and Side B until genuine opposite-side assets exist. Do not mirror an image: that reverses the badge and plate.

The reference angle strip reads Exterior, Interior, Engine, Left Side, Right Side, Rear, Top View. For this working version, use the six available images: Exterior, Front, Side A, Side B, Rear, Exterior close. Keep the strip styling and visual footprint. Leave missing view slots in configuration as unavailable, not selectable broken buttons. Explain this asset gap in the README.

For initial parts thumbnails, use purposeful crops of the supplied car images where the part is visible; use consistent outlined icons for unavailable engine/interior/suspension imagery. Keep all thumbnails inside dark framed tiles. Never display pieces of the dashboard containing baked-in text as functional cards. Provide a manifest that makes future replacement with real part photos straightforward.

Do not alter or overwrite the originals. Copy them to `public/assets/car/` with stable names and record the original-to-local mapping in `ASSETS.md`. Optimize additional derivatives only if visually faithful.

## 2. Match the reference UI

### Desktop layout

Treat 1983 × 793 as the primary visual reference viewport. Approximate landmarks below are design guides, not mandatory fixed pixel coordinates:

- Left garage area occupies roughly 80% of the screen; right parts rail occupies 20% (~390px at reference width).
- The right rail starts at the top and reaches the bottom, with its own vertical scroll. A thin border separates it from the garage scene.
- Header overlays the top of the scene. Brand left, rounded navigation panel center, search + red Donate button + account icon toward the right of the main area. Height approximately 70px.
- Brand: italic bold white `PROJECT`, red `S6`; smaller subtitle `AUDI S6 C5 AVANT 2.7 BiTurbo (2003)`. Preserve this supplied display text as configurable project copy; do not treat it as verified factory vehicle specifications.
- Navigation: GARAGE, PARTS, DONATIONS, PROGRESS, ABOUT. Active GARAGE is white with a vivid blue underline and glow.
- Main scene dominates the center. Show the actual car large enough for dots and callouts to read comfortably. Retain the workshop, wet floor, neon blue/red lights, and cinematic image framing.
- Bottom overlay: angle selector on the left (~60% of main width); donation panel on the right (~40%). Both have dark translucent backgrounds, steel borders, rounded corners, and aligned bottoms.
- The reference shows about six floating part callouts around the car, each connected to a blue ring dot by a thin blue elbow leader. Recreate this visual density on desktop without obstructing the windshield, grille, or donor controls.
- Parts rail: `PARTS LIST`, filter icon, tabs `All`, `Needed`, `Bought`, then ten compact rows. Each row includes a framed thumbnail, name, price, status chip, and chevron.

Implement a layered stage: image at the back, subtle edge vignette, dots and SVG leaders above, callout cards next, header/footer panels above those. Limit overlays that darken the actual car. The main image must remain crisp.

### Design tokens

These are visually estimated starting values, not sampled exact source colors. Tune against the screenshot:

```css
:root {
  --bg: #060b10;
  --panel: rgba(8, 15, 23, 0.92);
  --panel-soft: rgba(13, 22, 32, 0.86);
  --border: #354b60;
  --text: #f4f7fb;
  --muted: #b2bfce;
  --blue: #087cff;
  --blue-bright: #55b7ff;
  --red: #ff123b;
  --red-dark: #651522;
  --green: #00d477;
  --radius: 9px;
}
```

Use a compact sans-serif such as Inter or a similar local fallback. Most text is 13–16px, panel titles 18–24px, brand 28–36px. Match the high information density. Panels use restrained glass blur, thin cool borders, and soft shadows. Buttons have subtle gradients and glow only where the reference does. Use SVG icons, preferably Lucide React. Avoid emoji for interface icons.

All hotspot anchors remain blue, regardless of part status. Status chips are red for Needed, blue for Upgrade, green for Bought. The donation CTA is red; funding progress is green; selection/focus is blue. Do not invent a different palette per camera.

### Reference content and honest demo data

Use this parts catalog in demo mode. Amounts are USD and stored as integer cents:

| ID | Name | Price | Status | Condition |
| --- | --- | ---: | --- | --- |
| front-bumper | Front Bumper | $800 | needed | Scratched |
| hood | Hood | $650 | needed | Needs paint |
| wheels | Wheels (OEM+) | $1,200 | upgrade | Optional upgrade |
| side-skirts | Side Skirts | $450 | needed | Missing |
| rear-bumper | Rear Bumper | $700 | needed | Needs restoration |
| exhaust | Exhaust System | $950 | needed | Needs replacement |
| coilovers | Coilovers (Suspension) | $1,200 | needed | Needs replacement |
| brake-kit | Brake Kit | $1,400 | upgrade | Optional upgrade |
| roof-box | Roof Box | $450 | bought | Purchased |
| interior | Interior Refresh | $600 | needed | Needs restoration |

The initial catalog contains ten parts: seven Needed, two Upgrade, and one Bought. Compute tab counts from the current data rather than hardcoding screenshot counts; Upgrade items appear under All and can have an additional filter if useful.

The row costs add up to a different amount than the campaign goal; treat parts estimates and overall campaign target as independent configuration. The reference campaign target is $8,000 and sample funding $2,650 (33% rounded). Show those values only in clearly labeled demo mode. Live mode starts from confirmed records, never adds a fictional $2,650 to real donations. Do not invent donors, purchase receipts, or restoration progress.

Funding panel text: `MAKE THIS CAR GREAT AGAIN`, `$2,650 / $8,000`, green bar, `33%`, preset buttons $5 / $10 / $25 / $50 / $100, large heart icon + `DONATE NOW`. Add custom amount inside the donation dialog so the dashboard footprint stays close to the reference.

## 3. Image-specific hotspots — core functionality

Hotspots must use **normalized source-image coordinates**, with a separate map for every image ID. The same `partId` can appear at different positions in different views. Show only parts visible in that selected image. For example: the front view has hood and front bumper dots; the rear view has rear bumper and exhaust dots; front-only dots disappear on the rear.

Suggested initial anchors below are approximate visual placements on the original 1672 × 941 images. Validate and refine them in the browser. Coordinates are `(x, y)` in the range 0–1, origin top-left. They are not callout-card positions.

| View ID | Part anchors |
| --- | --- |
| exterior-a | roof-box (0.375, 0.255); hood (0.580, 0.455); front-bumper (0.662, 0.585); wheels (0.425, 0.587); side-skirts (0.335, 0.593); exhaust (0.191, 0.568); brake-kit (0.447, 0.590) |
| front | roof-box (0.490, 0.238); hood (0.493, 0.478); front-bumper (0.491, 0.638) |
| rear | roof-box (0.495, 0.216); rear-bumper (0.495, 0.606); exhaust (0.383, 0.663) |
| side-a | roof-box (0.385, 0.264); wheels (0.260, 0.590); brake-kit (0.683, 0.593); side-skirts (0.472, 0.615); front-bumper (0.807, 0.563); rear-bumper (0.133, 0.562); hood (0.709, 0.449) |
| side-b | roof-box (0.390, 0.265); wheels (0.265, 0.591); brake-kit (0.698, 0.592); side-skirts (0.478, 0.616); front-bumper (0.818, 0.558); rear-bumper (0.144, 0.557); hood (0.720, 0.449) |
| exterior-b | roof-box (0.405, 0.251); hood (0.611, 0.471); front-bumper (0.687, 0.652); wheels (0.442, 0.653); side-skirts (0.335, 0.634); rear-bumper (0.195, 0.564); brake-kit (0.467, 0.658) |

Do not anchor coilovers on bodywork just because they are in the catalog. They are not directly visible. Interior and coilovers remain selectable from the list without a misleading exterior dot.

Use data shaped like:

```js
const views = [{
  id: 'front',
  label: 'Front',
  src: '/assets/car/front.png',
  width: 1672,
  height: 941,
  available: true,
  hotspots: [
    { id: 'front-hood', partId: 'hood', x: 0.493, y: 0.478,
      callout: { preferredSide: 'right', offsetX: 35, offsetY: -90 } },
    { id: 'front-bumper', partId: 'front-bumper', x: 0.491, y: 0.638,
      callout: { preferredSide: 'right', offsetX: 70, offsetY: 15 } },
  ],
}];
```

### Correct image projection

An absolute `left: x*100%; top: y*100%` on the outer stage is wrong whenever `object-fit` adds letterboxing or cropping. Implement a reusable tested projection helper.

For source dimensions `Iw, Ih` and stage dimensions `W, H`:

```js
const scale = fit === 'cover'
  ? Math.max(W / Iw, H / Ih)
  : Math.min(W / Iw, H / Ih);
const renderedW = Iw * scale;
const renderedH = Ih * scale;
const offsetX = (W - renderedW) * objectPositionX; // 0..1, default 0.5
const offsetY = (H - renderedH) * objectPositionY;
const px = offsetX + x * renderedW;
const py = offsetY + y * renderedH;
```

Use the exact same fit and position for the image, dots, and leader endpoints. Recalculate via ResizeObserver after resize and image load. Hide anchors outside the visible image region or under reserved UI areas rather than clamping their dots to unrelated bodywork. Clamp/reposition **cards**, not anchor points. Desktop can use a tuned crop for visual similarity; compact layouts should favor contain and image aspect ratio to keep the entire car accessible.

Hotspots are semantic buttons with a 44px hit area and a visible blue ring about 18–24px. Provide meaningful aria-labels, visible focus, and reduced-motion support. Desktop default can show six curated compact callouts; focus, hover, or click raises the active card. Clicking a dot or part row selects the same part, highlights its row and visible dot, and opens detailed information with a `Fund this part` action.

Cards contain thumbnail, name, estimated cost, status/condition chip, and chevron/action. Use an SVG overlay for elbow leaders with pointer-events disabled. Keep labels readable, reposition on collision, and reduce inactive callouts when space is tight. On mobile, show dots plus one selected callout or a bottom sheet rather than six overlapping cards.

Switching angle changes both image and its hotspot map with a short fade. Preload adjacent images. Clear hover state; retain selected part only if visible, otherwise keep its details panel and show `Not visible in this angle`. Never leave the old dots over the new image. Disable nonexistent images rather than flashing broken assets.

Selecting an off-camera part from the list may switch to the first available view containing it, with a clear selected thumbnail. If no view contains it, leave the camera unchanged and show the details without a dot. Search and filtering update rows and visible hotspots consistently; the default unfiltered state matches the reference.

Provide a development-only coordinate calibration mode: click the image to log/copy normalized coordinates, show a small coordinate readout, and export edited view configuration. It must not appear in the production visitor UI.

## 4. Routes and interactions

- `/` Garage: reference dashboard, parts rail, camera thumbnails, donation controls.
- `/parts`: same shell and palette, searchable catalog and detailed part drawer.
- `/donations`: campaign summary and privacy-safe opt-in supporter activity; empty state for a new live campaign.
- `/progress`: restoration update timeline, costs, milestones and photos from Supabase; labeled fixture updates only in demo mode.
- `/about`: owner/project story, restoration plan, funding explanation. Use editable placeholder copy where facts are unknown.
- `/donation/success`: pending confirmation until the backend confirms payment; then thank-you state.
- `/donation/cancel`: explain cancellation and return to the garage with amount/part selection preserved.
- `/admin`: authenticated owner controls to manage parts, purchase status, campaign copy, and updates. Verify owner role on the server/database, not only in React.

Every visible navigation control must work. Search matches part names and conditions. Tabs compute counts from current data. Bought status is updated by the owner after purchase, not automatically when a donation arrives. The user icon opens sign-in; donors can contribute without creating an account.

Donation dialog includes preset/custom amount, optional display name, opt-in public recognition, and selected part or general restoration fund. Explain that a part contribution supports restoration and is not a parts purchase. Keep the interface concise; do not claim charitable/tax-deductible status.

## 5. Frontend architecture

Use React + Vite with **JavaScript and JSX**, CSS variables, and React Router. No Next.js and no TypeScript application files. Pin verified dependency versions and commit the lockfile. Plain CSS or CSS Modules are suitable; prioritize accurate styling over introducing a large UI library.

Suggested modules:

```text
src/
  components/ AppHeader, GarageStage, ImageCarViewer, HotspotLayer,
              HotspotButton, PartCallout, PartsSidebar, PartDetailsDrawer,
              AngleSelector, FundingPanel, DonationDialog
  pages/ Garage, Parts, Donations, Progress, About, Admin, DonationReturn
  data/ views.js, demoProject.js, assetManifest.js
  hooks/ useImageProjection.js, useProjectData.js
  lib/ supabase.js, donations.js, money.js
  styles/ tokens.css, global.css, garage.css
server/                         # JavaScript payment API
supabase/migrations/
tests/
public/assets/car/
```

Keep view ID, selected part ID, search/filter, and donation draft as shared state at the appropriate shell level. Store persistent project content in Supabase; geometry can initially live in a versioned JS config. Do not fetch the same catalog separately for every callout.

Expose a renderer boundary such as `<CarViewer mode="image" viewId={viewId} selectedPartId={selectedPartId} onPartSelect={...} />`. The shell, donations, catalog, and domain part IDs must not depend on image pixel positions. A future Three.js viewer can implement the same selection contract with separate 3D anchor metadata. Do not create fake 3D rotation controls now.

## 6. Supabase design

Use Supabase Postgres for campaign, parts, updates and payment records; Auth for owner access; Storage for future uploaded progress/part images. Propose and implement SQL for:

- `projects`: id, slug, title, vehicle_display_name, currency, goal_cents, description, timestamps.
- `parts`: id, project_id, slug, name, estimate_cents, status, condition, description, thumbnail_url, sort_order.
- `restoration_updates`: id, project_id, title, body, image_urls, published_at, created_by.
- `project_admins`: project_id, user_id; provision owner access through a trusted setup step.
- `donations`: id, project_id, optional part_id, amount_cents, currency, payment status, refunded_cents, private donor fields, public display-name preference, unique Stripe session/payment identifiers, timestamps.
- `stripe_events`: unique event_id and processing metadata for retry protection.
- A privacy-safe public contribution projection containing only consented display names, public amounts/dates, and no emails or Stripe identifiers; campaign totals available through a dedicated safe API.

These are application requirements, not a claim that Supabase supplies a donation schema. Use integer cents, foreign keys, status/amount constraints, and useful indexes. Separate private payment data from public campaign data.

Enable RLS on exposed tables and explicitly grant only required operations. Public visitors can read published project/parts/updates. They cannot mutate payment records or owner roles. Authenticated owner writes require project membership; authentication alone is insufficient. Keep privileged keys server-side. Protect views deliberately; do not expose private columns through an unrestricted view. Test anonymous, authenticated non-owner, and owner access. Follow the current official RLS guide linked below.

Live project totals should reflect confirmed contributions minus recorded refunds, in the campaign currency. A safe aggregate endpoint must not disclose private donor records. If realtime updates are used, publish only public projections; otherwise refetch the safe summary after payment and on an interval. Do not subscribe visitors to the private donations table.

## 7. Stripe payment backend

Use a small **Node.js + Express JavaScript** API alongside Vite for Checkout creation and webhooks. Vite proxies `/api` locally; production needs an actual server/serverless deployment for this API. Do not put secret keys in Vite variables. Hosted Stripe Checkout keeps payment entry outside the dashboard.

Implement `POST /api/donations/checkout` with validated project/part IDs, configured currency, integer amount within server limits, optional recognition preferences, and trusted return URLs. Create the pending record and Checkout session server-side, link identifiers, and use a stable idempotency key per donation attempt. Return the hosted Checkout URL; disable duplicate submit clicks.

Implement `POST /api/stripe/webhook`. Verify Stripe signatures against the raw body before parsing. Handle duplicate and out-of-order deliveries; confirm payment state before recording success, account for asynchronous success/failure if enabled, and update refunds. Use unique event/session constraints and transactional writes so retries cannot count twice. Return success only after required durable updates; allow retry on temporary database failures. The browser success URL never proves a payment succeeded. Consult current Checkout and webhook docs below.

Return pages must read confirmation through a privacy-safe scoped status API; never expose arbitrary donation records by a guessable ID. Give a waiting state, retry, and support text if the webhook is delayed. Cancellation does not increment totals. Do not persist card data. Add request validation, sensible rate limiting, server-origin controls, and redacted logs.

Frontend environment example:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_DEMO_MODE=true
```

Server environment example:

```dotenv
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
APP_ORIGIN=http://localhost:5173
PORT=3001
```

Use current documented Supabase key conventions; adjust the server key name if the verified SDK requires a newer secret-key configuration. Never prefix private credentials with `VITE_`. Include `.env.example` files with empty values, no real credentials.

The app must be visually reviewable without credentials through explicitly labeled demo fixtures. Demo checkout explains that no payment is taken; it never pretends to process a real contribution. Live mode without credentials shows a clear unavailable state and does not silently fall back to fixture money.

## 8. Responsive behavior and accessibility

At wide desktop sizes, match the screenshot closely with a stable parts rail and bottom panels. At laptop widths, narrow the rail and reduce inactive callouts before shrinking text. At tablet widths, move the rail to a collapsible drawer or below the stage. At phone widths, use compact navigation, a full-width car image, horizontal angle strip, donation card below, and accessible parts drawer. Avoid horizontal page overflow and tiny desktop controls scaled down to fit.

Use keyboard-operable controls, dialog focus trapping, Escape to dismiss, focus restoration, accessible status announcements and descriptive image alt text. Support reduced motion. Keep text contrast legible through the dark panels. Funding progress has an accessible numeric value; status is conveyed by text and icon as well as color.

Handle image loading errors, loading skeletons, empty searches, no updates, backend failure and payment errors without losing the UI shell. Preload the default image; lazy-load nonessential derivatives. Avoid loading all full-resolution images repeatedly.

## 9. Implementation order and verification

1. Inspect files, create manifest, scaffold Vite React JavaScript and local API.
2. Build the static dashboard shell using original images and fixture data. Tune at 1983 × 793 against the reference before expanding scope.
3. Implement image projection, per-view hotspot maps, leaders/cards, angle switching, synchronized part selection and responsive behavior.
4. Add working routes, dialogs, catalog filters and owner management.
5. Add Supabase schema/policies and safe data services, then Stripe test-mode integration.
6. Verify and polish the completed app; document remaining asset gaps and credential-dependent setup.

Required checks:

- Compare browser screenshots at 1983 × 793, 1440 × 900, 1024 × 768, and 390 × 844. Tune the visual result, not only the component structure.
- Every available angle switches to its correct source image and map. Front/rear have distinct dots. No interior/engine/top assets are fabricated.
- Hotspots stay on the same physical image features during resize, contain/cover changes, and image loading. Unit-test projection math including letterboxing and cropping.
- Dot/list selection stays synchronized; off-camera and unavailable parts behave as specified. Filters/counts come from data. No callouts collide with donation buttons or rail.
- Preset and custom donation validation, cancellation, delayed confirmation, failed payment, duplicate webhook, invalid signature, and refund behavior are tested.
- RLS tests deny public payment writes, private donor reads, and non-owner content updates while allowing intended public reads and owner writes.
- Production frontend build passes; no missing assets, unhandled exceptions, leaked secrets or console errors. Report tests that could not run because credentials are absent; do not claim live payment verification.

Provide a README with exact install/dev/build commands, running both API and Vite, Supabase migration/setup and owner provisioning, Stripe test webhook configuration, production hosting requirements, asset mapping, demo/live mode, and hotspot calibration instructions. Provide screenshots of the final implementation and a brief report of actual checks run.

## 10. Final acceptance criteria

The site should feel like the supplied neon garage dashboard from the first render: large car scene, blue part rings with connected dark callouts, compact right-hand parts list, thumbnail angle strip, and red donation action with a green progress bar. Switching to Front must place a new set of dots on the front image while keeping the interface design unchanged. Data and payment behavior must work without relying on baked-in screenshot text. The future 3D renderer must be replaceable without rebuilding donation logic or the page shell.

Proceed autonomously with routine implementation decisions. Ask only for genuinely missing credentials or assets that block a specific integration; continue the visual/demo build while those are unavailable. Deliver the complete implementation, not a list of suggestions.

## Official technical references

Check these current primary sources again before implementation because SDK and API conventions change:

- [Supabase changelog](https://supabase.com/changelog)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
- [Stripe webhooks](https://docs.stripe.com/webhooks)

The UI observations and approximate hotspot coordinates above come from the supplied images. Design tokens, architecture, schema, and responsive adaptations are proposed implementation decisions.
