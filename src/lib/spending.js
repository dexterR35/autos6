// "Where the money went": everything is derived from public data (part goals, net
// paid support per part, what the owner paid, and the campaign total).

/**
 * @param {Array} parts  parts with estimateCents, raisedCents, actualCostCents, status
 * @param {number} totalRaisedCents  net paid contributions to the whole project
 */
export function spendingReport(parts, totalRaisedCents) {
  const rows = parts.map((p) => {
    const raised = Math.max(0, p.raisedCents ?? 0);
    const spent = p.actualCostCents ?? null;
    // Money given to a part beyond its goal stays with the project (general fund).
    const overflow = Math.max(0, raised - p.estimateCents);
    // When the owner paid more than was raised for it, the general fund (or the owner) covered the rest.
    const topUp = spent != null ? Math.max(0, spent - Math.min(raised, p.estimateCents)) : 0;
    const saved = spent != null ? Math.max(0, Math.min(raised, p.estimateCents) - spent) : 0;
    return { ...p, raised, spent, overflow, topUp, saved };
  });
  const designated = rows.reduce((s, r) => s + r.raised, 0);
  const total = Math.max(totalRaisedCents ?? 0, designated);
  const spent = rows.reduce((s, r) => s + (r.spent ?? 0), 0);
  const overflow = rows.reduce((s, r) => s + r.overflow, 0);
  const saved = rows.reduce((s, r) => s + r.saved, 0);
  return {
    rows,
    totals: {
      raised: total,
      designated,
      general: total - designated,
      // General fund + overflow + savings on bought parts = money not tied to an open part.
      flexible: total - designated + overflow + saved,
      spent,
      unspent: Math.max(0, total - spent),
      overflow,
      saved,
      topUps: rows.reduce((s, r) => s + r.topUp, 0),
    },
  };
}
