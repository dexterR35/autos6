export const STATUS_LABELS = { needed: 'Needed', upgrade: 'Upgrade', bought: 'Bought' };

export function matchesSearch(part, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [part.name, part.condition, STATUS_LABELS[part.status]].some((v) => v?.toLowerCase().includes(q));
}

export function matchesStatus(part, filter) {
  return filter === 'all' || part.status === filter;
}

/** Tab counts come from the current data (after search), never from the screenshot. */
export function countByStatus(parts) {
  const counts = { all: parts.length, needed: 0, upgrade: 0, bought: 0 };
  for (const p of parts) if (p.status in counts) counts[p.status] += 1;
  return counts;
}

export function filterParts(parts, { query = '', status = 'all' } = {}) {
  return parts.filter((p) => matchesSearch(p, query) && matchesStatus(p, status));
}
