import { formatCents } from './money.js';

const publicName = (value) => typeof value === 'string'
  ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 80)
  : '';
const currencyCode = (value, fallback = 'usd') => typeof value === 'string' && /^[a-z]{3}$/i.test(value) ? value.toLowerCase() : fallback;
const safeName = (value) => {
  const name = publicName(value);
  return name.includes('@') ? 'Supporter' : !name || /^anonymous$/i.test(name) ? 'Anonymous' : name;
};

/** Normalize server aggregates without merging unrelated people with the same name. */
export function mapGarageSupporters(rows = [], { currency = 'usd', offset = 0 } = {}) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row, index) => {
    if (!row) return [];
    const amountCents = Number(row.amountCents ?? row.amount_cents);
    const count = Number(row.count ?? row.donation_count ?? 1);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !Number.isSafeInteger(count) || count < 1) return [];
    const displayName = safeName(row.displayName ?? row.display_name);
    return [{ id: `supporter-${offset + index}`, displayName, label: count > 1 ? `${count}× ${displayName}` : displayName, count, amountCents, currency: currencyCode(row.currency, currencyCode(currency)), email: null }];
  });
}

/**
 * Fallback for the legacy, recent public contribution feed. Only this feed lacks
 * server identity grouping, so matching display names are combined per currency.
 * Unnamed donations remain separate; private email fields are never copied.
 */
export function aggregateGarageSupporters(contributions = [], { currency = 'usd' } = {}) {
  const grouped = new Map();
  const fallbackCurrency = currencyCode(currency);
  if (!Array.isArray(contributions)) return [];
  contributions.forEach((contribution, index) => {
    if (!contribution || contribution.isPublic === false || contribution.is_public === false) return;
    if (contribution.status && !['paid', 'confirmed'].includes(contribution.status)) return;
    const amount = Number(contribution.amountCents);
    if (!Number.isSafeInteger(amount) || amount <= 0) return;
    const name = safeName(contribution.displayName);
    const anonymous = ['Anonymous', 'Supporter'].includes(name);
    const code = currencyCode(contribution.currency, fallbackCurrency);
    const key = `${code}:${anonymous ? `anonymous-${index}` : name.toLocaleLowerCase('en-US')}`;
    let row = grouped.get(key);
    if (!row) {
      row = { id: key, displayName: name, label: '', count: 0, amountCents: 0, currency: code, email: null };
      grouped.set(key, row);
    }
    if (!Number.isSafeInteger(row.amountCents + amount)) return;
    row.amountCents += amount;
    row.count += 1;
    row.label = row.count > 1 ? `${row.count}× ${row.displayName}` : row.displayName;
  });
  return [...grouped.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.amountCents - a.amountCents || a.displayName.localeCompare(b.displayName));
}

export const formatSupporterAmount = (row) => formatCents(row.amountCents, row.currency);
