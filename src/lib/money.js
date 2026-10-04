// Money helpers. All amounts are integer cents; floats never reach the payment API.

export const DONATION_PRESETS_CENTS = [500, 1000, 2500, 5000, 10000];
export const DEFAULT_MIN_CENTS = 100; // $1
export const DEFAULT_MAX_CENTS = 1_000_000; // $10,000

export function formatCents(cents, currency = 'usd', { compact = true } = {}) {
  if (!Number.isFinite(cents)) return '—';
  const whole = compact && cents % 100 === 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/** "25", "25.5", "$1,200.00" → integer cents, or null when not a valid money string. */
export function parseDollarsToCents(input) {
  if (typeof input === 'number') input = String(input);
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function validateAmountCents(cents, { min = DEFAULT_MIN_CENTS, max = DEFAULT_MAX_CENTS } = {}) {
  if (!Number.isInteger(cents)) return 'Enter a valid amount.';
  if (cents < min) return `The minimum contribution is ${formatCents(min)}.`;
  if (cents > max) return `The maximum contribution is ${formatCents(max)}.`;
  return null;
}

export function percentOf(part, whole) {
  if (!whole || whole <= 0 || !Number.isFinite(part)) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}
