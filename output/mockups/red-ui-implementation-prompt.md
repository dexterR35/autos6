# Project S6 — Graphoria × NFS Garage, Red UI

Redesign the existing app in `C:\Users\Dexter\Desktop\projects\autos6`. Use the attached approved Project S6 mockup as the primary visual reference and inspect `C:\Users\Dexter\Desktop\projects\graphoria-site` for the Graphoria design foundations. Implement the design across the garage, parts cards, parts table, community, and donations pages. Work within the existing app and preserve working routes, data flows, authentication, camera/orbit controls, part selection, funding logic, and payment integration.

## Visual direction

Match the approved screenshot closely: cinematic garage scene on the left, structured part detail panel on the right, large condensed editorial headings, thin dividers, compact tracked labels, minimal corner rounding, and generous spacing. Combine Graphoria's oversized condensed typography, asymmetric editorial grid, numbered cards, and northeast arrows with an NFS-inspired garage atmosphere. Keep Project S6 branding; do not introduce Graphoria or NFS branding.

Use the existing blue Audi S6 C5 Avant and roof box, existing garage assets, and blue/red environmental lighting. Preserve the live interactive garage rather than replacing it with a screenshot. Blue belongs to the car and scene lighting. Replace cyan/blue UI accents with racing red throughout all redesigned pages.

Palette: background #0B0D0F, surface #121518, raised surface #191D21, primary text #F2F0EA, muted text #A4ABB3, red accent #F33440, red hover #D92332, subtle white dividers at 14–20% opacity. Use white labels on red buttons with verified readable contrast. Red applies to CTAs, selected states, focus outlines, links, highlighted headline words, logo accent, hotspot rings, category borders, and funding progress. Use neutral text plus explicit labels/icons for statuses; red should not make every item look like an error. Avoid orange, cyan controls, blue links, excessive glows, glass panels, and excessive pill shapes.

Use Bebas Neue or the existing closest condensed typeface for display headings and Inter for body text, forms, tables, and small labels. Keep table content readable rather than making every label condensed uppercase.

## Shared shell and garage

Consistent navigation: Garage, Parts, Progress, Community, Donations, with a red active indicator and a clear Support Build action. Adapt the shell to existing routing conventions.

Garage: preserve the real interactive scene as the dominant area. Use the BUILD YOUR S6 headline, with YOUR red. Keep camera presets, orbit/zoom/reset controls and clickable part hotspots accessible and unobstructed. Selecting a hotspot or category updates the right panel with the part image, name, status, cost, funded amount, percentage, relevant specifications and Fund This Part action. Provide Bodywork, Wheels and Performance editorial category cards beneath the scene. Show project funding totals in a restrained lower strip. Use actual project data; reference amounts in the mockup are examples, not values to hardcode.

## Parts cards and TanStack Table

Provide Card and Table views sharing one set of filters and the same data. Part cards show image, name, category, status, priority, cost, funded/remaining amount, percentage, a slim red progress bar, View Details and Fund Part. Use clean hierarchy, consistent image ratios, and a red border for the selected card.

Use TanStack Table for the parts table. Columns: Part (thumbnail + name), Category, Status, Priority, Cost, Funded, Remaining, Progress, and Actions. Support name search, category/status/priority filters, sorting, pagination, column visibility, clear filters and a visible result count. Format monetary values consistently and derive totals from the same source as cards. Use subtle row separators, restrained hover, sticky headers where appropriate and an accessible action menu. Clicking View Details opens the same part detail experience as the garage. Funding targets the selected part through the existing donation flow.

At narrow widths, retain the part name and key cost/status information; move secondary details into expandable rows or a controlled horizontally scrollable table. Prevent the whole page from overflowing.

## Community

Use the same editorial dark/red visual system. Hero: A GARAGE FOR ALL OF US, with ALL OF US red; small BUILT TOGETHER. DRIVEN TOGETHER. label; existing short community description; red Start a Discussion button and outlined Subscribe to Updates button. Pair with existing garage/car imagery. Add the three thin-rule feature columns: Share the know-how, Help each other, Keep it welcoming.

Around the Garage includes All Discussions, Ask for Help, Parts Exchange, Your Builds and Garage Talk filters. Discussion rows show avatar, category, title, short excerpt, author, activity time and reply count. Keep a Project S6 sidebar card with image, real funding progress and View the Build. Use existing moderation/auth/posting behavior. Preserve clearly labeled preview states if live posting is unavailable.

Add a Community Support section with a compact recent contributions table and a link to the full donations page. Reuse donation data and table components. Display only donor information already public or consented for display, respecting anonymous contributions.

## Donations

Create or restyle the dedicated donations page with the same design. Use a SUPPORT THE BUILD headline, red emphasis, garage imagery, real funded/goal/remaining totals and a red progress bar. A clean donation panel supports the existing preset amounts, custom amount, project-wide or specific-part funding, existing anonymity preferences and working checkout behavior.

Use TanStack Table for the community contribution history: Date, Public Supporter Name or Anonymous, Funded Part or General Build, Amount, and public-safe Status when available. Add search, sorting, appropriate filters and pagination. Use a compact version of this table on Community. Never expose email addresses, payment identifiers or private donor notes. Display existing live data, clearly labeled demo data, or a designed empty state as appropriate; do not invent contributors or imply a completed payment.

## Implementation and acceptance

Reuse existing components, dependencies, styles and data sources where practical. Build shared tokens, buttons, section headings, part cards, progress bars, table primitives and empty/loading/error states so every page feels consistent. Keep keyboard navigation, visible red focus states, readable contrast, descriptive action labels and reduced-motion support. Ensure layouts work at 1440px, 1024px and 390px without clipped controls or unreadable tables.

Inspect the current project instructions and implementation first. Implement the redesign rather than returning another concept image. Preserve existing functionality and integrations, run appropriate existing checks, and visually verify the garage, parts Card/Table views, community and donations pages on desktop and mobile. Deliver the changed pages, screenshots, validation results and any actual integration limitations. The final UI must match the approved composition with red replacing cyan, while retaining the blue/red garage atmosphere.
