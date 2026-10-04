import { describe, expect, it } from 'vitest';
import { redact } from '../server/logger.js';

describe('log redaction', () => {
  it('removes emails, keys and shortens Stripe ids', () => {
    const s = redact('donor a.b@example.com key sk_test_51Habc whsec_abc123 sb_secret_xyz cs_test_a1b2c3d4e5f6');
    expect(s).not.toMatch(/example\.com|sk_test_51|whsec_abc|sb_secret_xyz|a1b2c3d4e5/);
    expect(s).toContain('cs_test_…e5f6');
  });
});
