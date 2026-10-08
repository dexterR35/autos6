// End-to-end: run a real Vite production build with the SEO plugin into a temp dir, then
// serve it through the API's static mode and check what crawlers receive.
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { readConfig } from '../server/config.js';

const SITE = 'https://projects6.example';
let out;
let app;
const read = (f) => readFileSync(path.join(out, f), 'utf8');

beforeAll(async () => {
  out = mkdtempSync(path.join(tmpdir(), 's6-build-'));
  Object.assign(process.env, { VITE_SITE_URL: SITE, VITE_GTM_ID: 'GTM-TEST123', VITE_NOINDEX: 'false' });
  await build({ root: path.resolve(import.meta.dirname, '..'), logLevel: 'silent', mode: 'production', build: { outDir: out, emptyOutDir: true } });
  app = createApp({ config: { ...readConfig({}), serveStatic: true, distDir: out }, logger: { info() {}, warn() {}, error() {} } });
}, 120_000);

afterAll(() => {
  for (const k of ['VITE_SITE_URL', 'VITE_GTM_ID', 'VITE_NOINDEX']) delete process.env[k];
  rmSync(out, { recursive: true, force: true });
});

describe('production build', () => {
  it('writes a page per route plus 404, robots and sitemap', () => {
    for (const f of ['index.html', 'parts/index.html', 'donations/index.html', 'progress/index.html', 'about/index.html', 'admin/index.html', 'donation/success/index.html', 'donation/cancel/index.html', '404.html', 'robots.txt', 'sitemap.xml']) {
      expect(existsSync(path.join(out, f)), f).toBe(true);
    }
  });

  it('each page carries exactly one title, description, canonical and robots tag', () => {
    const html = read('progress/index.html');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html.match(/name="robots"/g)).toHaveLength(1);
    expect(html).toContain('<title>Restoration Progress &amp; Updates | Project S6</title>');
    expect(html).toContain(`href="${SITE}/progress"`);
  });

  it('installs Consent Mode defaults before the GTM container, and the noscript iframe after <body>', () => {
    const html = read('index.html');
    const consent = html.indexOf("gtag('consent', 'default'");
    const gtm = html.indexOf('googletagmanager.com/gtm.js');
    expect(consent).toBeGreaterThan(-1);
    expect(gtm).toBeGreaterThan(consent);
    expect(html).toContain("'GTM-TEST123'");
    expect(html.indexOf('ns.html?id=GTM-TEST123')).toBeGreaterThan(html.indexOf('<body>'));
  });

  it('does not compete with 3D loading by preloading an unused hero photo', () => {
    expect(read('index.html')).not.toContain('rel="preload" as="image"');
    expect(read('parts/index.html')).not.toContain('rel="preload" as="image"');
  });
});

describe('static serving (SERVE_STATIC=true)', () => {
  it('serves each route its own HTML with 200', async () => {
    const res = await request(app).get('/about');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>About the Project | Project S6</title>');
    const trailing = await request(app).get('/parts/');
    expect(trailing.text).toContain('Parts Needed for the Audi S6 Restoration');
  });

  it('returns a real 404 (not a soft 404) for unknown paths', async () => {
    const res = await request(app).get('/definitely-not-here');
    expect(res.status).toBe(404);
    expect(res.text).toContain('noindex, nofollow');
  });

  it('serves robots.txt and sitemap.xml', async () => {
    expect((await request(app).get('/robots.txt')).text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    const sm = await request(app).get('/sitemap.xml');
    expect(sm.status).toBe(200);
    expect(sm.text).toContain('<urlset');
  });
});
