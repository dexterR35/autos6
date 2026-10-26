# Garage lighting, service lifts and supporter wall

The live Three.js garage now replaces the five photographic lift columns with two complete, opposing-post service lifts. The original GLB remains unchanged; the runtime removes only the old lift geometry and preserves the other shared-material objects. Neon tubes and Audi rings use shaped wall spill and floor reflections in the existing scene pass.

The light-bulb control adjusts brightness from 35% to 200%. The scene starts at its normal 100%; higher levels boost workshop lights and reflections while retaining the neon colors.

The east-wall equipment station has a repaired cabinet, a parked tool trolley and a separate oil drum. Two white twin-tube fixtures above this station replace its former red tube and follow the same brightness slider as the ceiling lights.

The small tool cart, drum and two floor jacks at the west wall are parked beneath the supporter screen, keeping the center of the workshop clear.

The former east-wall cabinet run is now a walnut office desk with drawer pedestals, an office chair, service paperwork and hand tools. The desk is 4.32 m wide (10% shorter than its first version), with its surface raised to about 1.08 m. Its two monitors, keyboard, mouse and headset accompany a windowed gaming tower with three RGB fans and visible internal components. Three original framed garage artworks hang above it. A small task lamp follows the existing brightness control.

The supporter screen sits on the west wall directly behind the S6, visible in its front view. The **Supporter wall** camera button opens a close view. **Read supporter table** opens its accessible table, and **Next board page** cycles through groups of ten. The feed refreshes every minute. Email addresses remain hidden. Demo mode never invents donors.

## Complete donor history

`supabase/migrations/20261025154352_garage_supporters.sql` (applied to the hosted project on 25 October 2026) adds one public aggregate RPC, with the existing publication, consent, paid, review, refund and currency checks. As refined by `20261025154428_audit_hardening.sql`, it groups a repeat donor's named donations by private normalized email and shows their latest public display name, count and net total; unnamed donations stay separate rows. It paginates all supporters without returning any email or payment identifier. Unrelated people with the same public name remain separate.

The migration is verified against the local PostgreSQL test database and is live on the hosted project. If a deployment ever lacks it, the app falls back to the latest 100 public contributions and labels that fallback as such; matching public names are combined in that fallback only.

## Verification

`npm test` checks lift removal against the actual compressed GLB, neon shaders, feed pagination, aggregation and database permissions. `node scripts/verify-garage-upgrade.mjs` checks the real WebGL viewer, wall camera, board pagination, private email display and dialog controls on desktop and mobile. Its synthetic payment fixtures intercept browser transport only and never write to the database.
