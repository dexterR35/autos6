import { describe, expect, it } from 'vitest';
import {
  NOT_FOUND, PART_ROUTES, ROUTES, fullTitle, getRouteMeta, headFor, jsonLdString, renderHeadHtml, renderRobots, renderSitemap,
} from '../src/seo/config.js';

const SITE = 'https://projects6.example';
const nav = ['/', '/parts', ...PART_ROUTES.map((r) => r.path), '/donations', '/progress', '/about', '/community', '/terms', '/privacy'];

describe('route metadata', () => {
  it('every public page has a unique title (≤ 60 chars) and description (70–160 chars)', () => {
    const pub = ROUTES.filter((r) => r.index !== false);
    expect(pub.map((r) => r.path)).toEqual(nav);
    expect(new Set(pub.map(fullTitle)).size).toBe(pub.length);
    expect(new Set(pub.map((r) => r.description)).size).toBe(pub.length);
    for (const r of pub) {
      expect(fullTitle(r).length, r.path).toBeLessThanOrEqual(60);
      expect(r.description.length, r.path).toBeGreaterThanOrEqual(70);
      expect(r.description.length, r.path).toBeLessThanOrEqual(160);
    }
  });

  it('normalizes paths and falls back to the 404 meta', () => {
    expect(getRouteMeta('/parts/').path).toBe('/parts');
    expect(getRouteMeta('/parts?x=1#y').path).toBe('/parts');
    expect(getRouteMeta('/nope')).toBe(NOT_FOUND);
  });

  it('private and error pages are noindex with no canonical or JSON-LD', () => {
    for (const p of ['/admin', '/donation/success', '/donation/cancel', '/nope']) {
      const h = headFor(getRouteMeta(p), { siteUrl: SITE });
      expect(h.tags.find((t) => t.key === 'robots').attrs.content).toBe('noindex, nofollow');
      expect(h.tags.find((t) => t.key === 'canonical')).toBeUndefined();
      expect(h.jsonLd).toBeNull();
    }
  });

  it('public pages get absolute canonical, OG and Twitter tags', () => {
    const h = headFor(getRouteMeta('/parts'), { siteUrl: `${SITE}/` });
    const tag = (k) => h.tags.find((t) => t.key === k)?.attrs;
    expect(tag('canonical').href).toBe(`${SITE}/parts`);
    expect(tag('og:url').content).toBe(`${SITE}/parts`);
    expect(tag('og:image').content).toBe(`${SITE}/og-image.jpg`);
    expect(tag('twitter:card').content).toBe('summary_large_image');
    expect(tag('robots').content).toMatch(/^index, follow/);
    const types = h.jsonLd['@graph'].map((n) => n['@type']);
    expect(types).toEqual(['WebSite', 'Car', 'WebPage', 'ItemList', 'BreadcrumbList']);
    const list = h.jsonLd['@graph'].find((n) => n['@type'] === 'ItemList');
    expect(list.itemListElement).toHaveLength(10);
    expect(list.itemListElement[1]).toEqual({ '@type': 'ListItem', position: 2, name: 'Hood', url: `${SITE}/parts/hood` });
  });

  it('every part has its own indexable page, share image and breadcrumbs, with no price or offer', () => {
    expect(PART_ROUTES.map((r) => r.path)).toEqual(['/parts/front-bumper', '/parts/hood', '/parts/wheels', '/parts/side-skirts', '/parts/rear-bumper', '/parts/exhaust', '/parts/coilovers', '/parts/brake-kit', '/parts/roof-box', '/parts/interior']);
    const h = headFor(getRouteMeta('/parts/hood/'), { siteUrl: SITE });
    const tag = (k) => h.tags.find((t) => t.key === k)?.attrs;
    expect(h.title).toBe('Hood · Audi S6 Restoration | Project S6');
    expect(tag('canonical').href).toBe(`${SITE}/parts/hood`);
    expect(tag('og:image').content).toBe(`${SITE}/og/parts/hood.jpg`);
    expect(tag('og:image:type').content).toBe('image/jpeg');
    expect(tag('og:image:alt').content).toMatch(/^Hood /);
    expect(tag('robots').content).toContain('max-image-preview:large');
    const graph = h.jsonLd['@graph'];
    expect(graph.find((n) => n['@type'] === 'WebPage').about).toEqual({ '@id': `${SITE}/parts/hood#part` });
    expect(graph.find((n) => n['@type'] === 'Thing')).toMatchObject({ name: 'Hood', image: `${SITE}/og/parts/hood.jpg` });
    expect(graph.find((n) => n['@type'] === 'BreadcrumbList').itemListElement.map((i) => i.name)).toEqual(['Garage', 'Parts', 'Hood']);
    expect(JSON.stringify(h.jsonLd)).not.toMatch(/"(offers|price|Product)"/);
    expect(getRouteMeta('/parts/not-a-part')).toBe(NOT_FOUND);
  });

  it('without a site URL, absolute-only tags are omitted instead of being wrong', () => {
    const h = headFor(getRouteMeta('/'), { siteUrl: '' });
    expect(h.tags.find((t) => t.key === 'canonical')).toBeUndefined();
    expect(h.tags.find((t) => t.key === 'og:image')).toBeUndefined();
  });

  it('VITE_NOINDEX turns every page noindex (staging)', () => {
    const h = headFor(getRouteMeta('/'), { siteUrl: SITE, noindex: true });
    expect(h.tags.find((t) => t.key === 'robots').attrs.content).toBe('noindex, nofollow');
    expect(renderRobots(SITE, { noindex: true })).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('rendering', () => {
  it('escapes attribute values and cannot break out of the JSON-LD script', () => {
    const html = renderHeadHtml({ title: 'A <b> & "q"', tags: [{ tag: 'meta', key: 'x', attrs: { name: 'x', content: '"><script>' } }], jsonLd: { a: '</script><script>alert(1)</script>' } });
    expect(html).toContain('<title>A &lt;b&gt; &amp; &quot;q&quot;</title>');
    expect(html).not.toContain('"><script>');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(JSON.parse(jsonLdString({ a: '</script>' }))).toEqual({ a: '</script>' });
  });

  it('sitemap lists only indexable pages with absolute URLs; robots points at it', () => {
    const xml = renderSitemap(SITE, '2026-10-04');
    expect(xml.match(/<loc>/g)).toHaveLength(18);
    expect(xml).toContain(`<loc>${SITE}/parts/hood</loc>`);
    expect(xml).toContain(`<image:loc>${SITE}/og/parts/hood.jpg</image:loc>`);
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(xml).not.toMatch(/admin|donation\//);
    expect(xml).toContain(`<loc>${SITE}/parts</loc>`);
    const robots = renderRobots(SITE);
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(robots).toContain('Disallow: /api/');
    expect(robots).not.toContain('Disallow: /admin'); // crawlers must see the noindex tag
  });
});
