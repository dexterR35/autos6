import { describe, expect, it } from 'vitest';
import { aggregateGarageSupporters, mapGarageSupporters, formatSupporterAmount } from '../src/lib/garageSupportersData.js';

describe('garage supporter board data', () => {
  it('combines matching public names, counts repeat contributions and sums integer cents', () => {
    const rows = aggregateGarageSupporters([
      { displayName: '  Alex   Pop ', amountCents: 2500 },
      { displayName: 'alex pop', amountCents: 500 },
      { displayName: 'ALEX POP', amountCents: 1250 },
      { displayName: 'Mara', amountCents: 1500 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ displayName: 'Alex Pop', label: '3× Alex Pop', count: 3, amountCents: 4250, currency: 'usd' });
    expect(formatSupporterAmount(rows[0])).toBe('$42.50');
    expect(rows[1].label).toBe('Mara');
  });

  it('keeps currencies and unnamed contributors separate', () => {
    const rows = aggregateGarageSupporters([
      { displayName: 'Alex', amountCents: 500, currency: 'EUR' },
      { displayName: 'Alex', amountCents: 900, currency: 'usd' },
      { displayName: null, amountCents: 100 },
      { displayName: 'Anonymous', amountCents: 200 },
    ]);
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.displayName === 'Alex').map((row) => row.amountCents)).toEqual([500, 900]);
    expect(rows.filter((row) => row.displayName === 'Anonymous').every((row) => row.count === 1)).toBe(true);
  });

  it('does not expose private emails or count private, failed, zero or invalid amounts', () => {
    const rows = aggregateGarageSupporters([
      { displayName: 'Allowed', amountCents: 400, email: 'private@example.com', donorEmail: 'private@example.com', donor_email: 'private@example.com' },
      { displayName: 'Private', amountCents: 400, isPublic: false },
      { displayName: 'Private DB row', amountCents: 400, is_public: false },
      { displayName: 'Failed', amountCents: 400, status: 'failed' },
      { displayName: 'Refunded', amountCents: 0 },
      { displayName: 'Invalid', amountCents: 4.5 },
      { displayName: 'Negative', amountCents: -100 },
      { displayName: 'Unsafe', amountCents: Number.MAX_SAFE_INTEGER + 1 },
      null,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBeNull();
    expect(JSON.stringify(rows)).not.toContain('private@example.com');
  });

  it('uses the campaign currency and handles missing input', () => {
    const rows = aggregateGarageSupporters([{ displayName: 'Ioana', amountCents: 1000 }], { currency: 'EUR' });
    expect(formatSupporterAmount(rows[0])).toBe('€10');
    expect(aggregateGarageSupporters(null)).toEqual([]);
    expect(aggregateGarageSupporters()).toEqual([]);
  });

  it('preserves distinct server identities with the same name and server repeat counts', () => {
    const rows = mapGarageSupporters([
      { display_name: 'Alex', donation_count: '3', amount_cents: '2500' },
      { display_name: 'Alex', donation_count: 2, amount_cents: 1000 },
      { display_name: 'private@example.com', donation_count: 1, amount_cents: 100 },
    ], { currency: 'eur', offset: 100 });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.label)).toEqual(['3× Alex', '2× Alex', 'Supporter']);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(rows[0].id).toBe('supporter-100');
    expect(rows.every((row) => row.email === null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('@');
    expect(mapGarageSupporters([null, { amount_cents: 1, donation_count: -1 }])).toEqual([]);
  });
});
