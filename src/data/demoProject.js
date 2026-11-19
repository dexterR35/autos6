// DEMO FIXTURES — shown only when VITE_DEMO_MODE=true and always labelled as demo in the UI.
// Live mode never reads these values and never adds demo money to real totals.

export const demoProject = {
  id: 'demo-project',
  slug: 'project-s6',
  title: 'PROJECT S6',
  vehicleDisplayName: 'AUDI S6 C5 AVANT 4.2 V8 (2003)',
  tagline: 'MAKE THIS CAR GREAT AGAIN',
  currency: 'usd',
  goalCents: 1000000,
  description:
    'A long-term restoration of a C5-generation Audi S6 Avant. Contributions go toward parts, paint and labour, one job at a time.',
};

// Sample funding shown in demo mode only.
export const demoSummary = { raisedCents: 265000, goalCents: 1000000, donationCount: null, monthly: { activeCount: 4, monthlyCents: 6000 } };

export const demoParts = [
  { id: 'front-bumper', name: 'Front Bumper', estimateCents: 80000, status: 'needed', condition: 'Scratched', description: 'Original bumper cover is scratched and scuffed. Plan: repair, prime and paint to match.' },
  { id: 'hood', name: 'Hood', estimateCents: 65000, status: 'needed', condition: 'Needs paint', description: 'Clear coat failure on the hood. Plan: strip, prep and respray.' },
  { id: 'wheels', name: 'Wheels (OEM+)', estimateCents: 120000, status: 'upgrade', condition: 'Optional upgrade', description: 'OEM-style wheel refresh or upgrade. Optional — only after the essentials are done.' },
  { id: 'side-skirts', name: 'Side Skirts', estimateCents: 45000, status: 'needed', condition: 'Missing', description: 'Side skirt trim is missing and needs to be sourced and fitted.' },
  { id: 'rear-bumper', name: 'Rear Bumper', estimateCents: 70000, status: 'needed', condition: 'Needs restoration', description: 'Rear bumper cover needs repair and refinishing.' },
  { id: 'exhaust', name: 'Exhaust System', estimateCents: 95000, status: 'needed', condition: 'Needs replacement', description: 'Exhaust needs replacement. Twin-outlet layout with one tip on each side to be retained.' },
  { id: 'coilovers', name: 'Coilovers (Suspension)', estimateCents: 120000, status: 'needed', condition: 'Needs replacement', description: 'Worn suspension to be replaced with a quality coilover kit. Not visible in the exterior photos.' },
  { id: 'brake-kit', name: 'Brake Kit', estimateCents: 140000, status: 'upgrade', condition: 'Optional upgrade', description: 'Optional brake upgrade for the front axle.' },
  { id: 'roof-box', name: 'Roof Box', estimateCents: 45000, status: 'bought', condition: 'Purchased', description: 'Roof box already purchased and fitted.' },
  { id: 'interior', name: 'Interior Refresh', estimateCents: 60000, status: 'needed', condition: 'Needs restoration', description: 'Seats, trim and carpets need cleaning and repair. No interior photos yet.' },
].map((p, i) => ({ ...p, kind: p.status === 'upgrade' ? 'upgrade' : 'repair', modelUrl: null, imageUrls: [], actualCostCents: p.status === 'bought' ? 41800 : null, isNextUp: ['front-bumper', 'exhaust'].includes(p.id), carPlacement: 'fit', beforeImageUrl: null, afterImageUrl: null, receiptUrl: null, fundedAt: p.status === 'bought' ? '2026-09-20T12:00:00Z' : null, orderedAt: null, boughtAt: p.status === 'bought' ? '2026-10-01T12:00:00Z' : null, installedAt: null, supporterCount: null, priority: ['front-bumper', 'exhaust', 'coilovers'].includes(p.id) ? 'important' : 'standard', raisedCents: [32000, 21000, 12000, 15000, 18000, 42000, 48000, 7000, 0, 20000][i], sortOrder: i, thumbnailUrl: null }));

// Labelled fixture updates for the Progress page in demo mode. Placeholder copy only —
// these are NOT real restoration events.
export const demoUpdates = [
  {
    id: 'demo-update-2',
    title: 'Example update: parts list drafted',
    body: 'Demo fixture. In live mode this area shows real restoration updates posted by the owner from the admin page, with photos and costs.',
    imageUrls: ['/assets/car/thumbs/side-a.webp'],
    publishedAt: '2026-10-02T12:00:00Z',
    costCents: null,
  },
  {
    id: 'demo-update-1',
    title: 'Example update: car photographed in the garage',
    body: 'Demo fixture. The six-plus camera angles used in the garage viewer were captured. Replace this entry with a real first update.',
    imageUrls: ['/assets/car/thumbs/exterior-a.webp', '/assets/car/thumbs/rear.webp'],
    publishedAt: '2026-10-01T12:00:00Z',
    costCents: null,
  },
];

export const demoMilestones = [
  { id: 'm1', label: 'Bodywork essentials', targetCents: 260000 },
  { id: 'm2', label: 'Running gear (exhaust, suspension)', targetCents: 520000 },
  { id: 'm3', label: 'Interior and finishing', targetCents: 1000000 },
];

// Labelled fixtures for "funded by" and supporter votes in demo mode.
export const demoPartSupporters = {
  'front-bumper': [{ name: 'Andrei', totalCents: 12000, count: 2 }, { name: 'Maria', totalCents: 5000, count: 1 }, { name: 'S6 Club Iași', totalCents: 2500, count: 1 }],
  hood: [{ name: 'Radu', totalCents: 8000, count: 1 }],
};
export const demoPolls = [{
  id: 'demo-poll-1', question: 'Example vote: which wheels should come next?', description: 'Demo fixture. Supporters vote; the owner turns the winner into a part card.',
  status: 'open', closesAt: null, winnerOptionId: null, myVote: null, totalVotes: 23,
  options: [
    { id: 'demo-opt-a', label: 'OEM Avus 18"', description: 'Period-correct, refurbished.', imageUrl: null, estimateCents: 90000, partDbId: null, sortOrder: 0, votes: 9 },
    { id: 'demo-opt-b', label: 'RS6 rotor 19"', description: 'The classic swap.', imageUrl: null, estimateCents: 140000, partDbId: null, sortOrder: 1, votes: 14 },
  ],
}];
