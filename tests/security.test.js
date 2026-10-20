import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { readConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { safeMediaUrl } from '../src/lib/safeMedia.js';
import { percentOf } from '../src/lib/money.js';
import { validatePublicEnv } from '../vite/validatePublicEnv.js';

describe('security boundaries', () => {
  it('blocks browser builds containing server credentials without exposing the value', () => {
    expect(()=>validatePublicEnv({VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_hidden'})).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
    const encoded = Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url');
    expect(()=>validatePublicEnv({VITE_SUPABASE_PUBLISHABLE_KEY:`eyJ.${encoded}.signature`})).toThrow(/Server credential/);
    expect(()=>validatePublicEnv({VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_public'})).not.toThrow();
  });
  it('denies executable content and embedding in the production response policy', async () => {
    const app = createApp({ config:readConfig({}) });
    const response = await request(app).get('/api/health');
    expect(response.headers['content-security-policy']).toContain("script-src-attr 'none'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    const script = response.headers['content-security-policy'].split(';').find((p)=>p.trim().startsWith('script-src '));
    expect(script).not.toContain('unsafe-inline'); expect(script.split(/\s+/)).not.toContain("'unsafe-eval'");
    expect(script).toContain("'wasm-unsafe-eval'"); // Meshopt decoder, not JavaScript eval.
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it.each(['javascript:alert(1)','data:image/svg+xml,<svg onload=alert(1)>','//evil.example/x','/\\evil.example/x','https://user:pass@example.com/x','https://example.com/x\n'])('rejects unsafe media URL %s', (url) => {
    expect(safeMediaUrl(url)).toBeNull();
  });
  it('preserves valid images and does not show 100% before the price is reached', () => {
    expect(safeMediaUrl('/assets/car/s6/front.webp')).toBe('/assets/car/s6/front.webp');
    expect(safeMediaUrl('https://example.supabase.co/storage/v1/object/public/a.webp')).toBeTruthy();
    expect(percentOf(999999,1000000)).toBe(99);
    expect(percentOf(1000000,1000000)).toBe(100);
  });
  it('fails closed on invalid deployment origins, limits and missing operator details', () => {
    expect(()=>readConfig({APP_ORIGIN:'https://site.example/path'})).toThrow(/origin/);
    expect(()=>readConfig({NODE_ENV:'production',APP_ORIGIN:'http://site.example'})).toThrow(/HTTPS/);
    expect(()=>readConfig({DONATION_MAX_CENTS:'1000001'})).toThrow(/limits/);
    expect(()=>readConfig({NODE_ENV:'production',APP_ORIGIN:'https://site.example',STRIPE_SECRET_KEY:'sk_live_test'})).toThrow(/OPERATOR_NAME/);
  });
});
