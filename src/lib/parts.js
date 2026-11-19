// Part lifecycle: needed/upgrade (open) → funded (automatic) → ordered → bought → installed.
export const STATUS_LABELS = {
  needed: 'Needed',
  upgrade: 'Upgrade',
  funded: 'Funded',
  ordered: 'Ordered',
  bought: 'Bought',
  installed: 'Installed',
};

export const OPEN_STATUSES = ['needed', 'upgrade'];
export const OWNER_STAGES = ['ordered', 'bought', 'installed'];

/** The steps shown on a part card, with the timestamp field that records each. */
export const STAGES = [
  { id: 'open', label: 'Funding', at: null },
  { id: 'funded', label: 'Funded', at: 'fundedAt' },
  { id: 'ordered', label: 'Ordered', at: 'orderedAt' },
  { id: 'bought', label: 'Bought', at: 'boughtAt' },
  { id: 'installed', label: 'Installed', at: 'installedAt' },
];

const RANK = { needed: 0, upgrade: 0, funded: 1, ordered: 2, bought: 3, installed: 4 };
export const stageRank = (status) => RANK[status] ?? 0;

export const isOpen = (part) => OPEN_STATUSES.includes(part?.status);
/** Bought or installed: the part is on (or for) the car. */
export const isAcquired = (part) => stageRank(part?.status) >= 3;
export const partKind = (part) => part?.kind ?? (part?.status === 'upgrade' ? 'upgrade' : 'repair');

/** What is still needed to reach the part's goal (never negative; null when unknown). */
export function remainingCents(part) {
  if (!part || !Number.isFinite(part.raisedCents)) return null;
  return Math.max(0, part.estimateCents - Math.max(0, part.raisedCents));
}

// Filter tabs group the lifecycle: "Funded" covers funded + ordered, "Bought" covers bought + installed.
const TAB_OF = { needed: 'needed', upgrade: 'upgrade', funded: 'funded', ordered: 'funded', bought: 'bought', installed: 'bought' };

export function matchesSearch(part, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [part.name, part.condition, STATUS_LABELS[part.status]].some((v) => v?.toLowerCase().includes(q));
}

export function matchesStatus(part, filter) {
  if (filter === 'all') return true;
  if (filter === 'upgrade') return partKind(part) === 'upgrade' && isOpen(part);
  return TAB_OF[part.status] === filter;
}

/** Tab counts come from the current data (after search), never from the screenshot. */
export function countByStatus(parts) {
  const counts = { all: parts.length, needed: 0, upgrade: 0, funded: 0, bought: 0 };
  for (const p of parts) {
    const tab = TAB_OF[p.status];
    if (tab in counts) counts[tab] += 1;
  }
  return counts;
}

/** Up to three open parts the owner wants funded first, in card order. */
export const nextUpParts = (parts) => parts.filter((p) => p.isNextUp && isOpen(p)).slice(0, 3);

export function filterParts(parts, { query = '', status = 'all', priority = 'all' } = {}) {
  return parts.filter((p) => matchesSearch(p, query) && matchesStatus(p, status) && (priority === 'all' || (p.priority ?? 'standard') === priority));
}
