// Single source of truth for SEO. Used in three places:
//   • the browser (src/seo/useSeo.js) to update <head> on client-side navigation,
//   • the Vite plugin (vite/seoPlugin.js) to write a static HTML file per route with the
//     right <head> already in it (for crawlers and link previews that don't run JS),
//   • the API's optional static server, to answer unknown paths with a real 404.
// Plain JS with no browser/Node APIs so all three can import it.
import { SEO_PARTS, partSharePath } from './parts.js';

export const SITE = {
  name: 'Project S6',
  titleSuffix: ' | Project S6',
  defaultTitle: 'Project S6 — Help Restore an Audi S6 C5 Avant',
  description:
    'Help restore a 2003 Audi S6 C5 Avant. Explore the car in the garage, see which parts are needed and what each costs, and contribute securely through Stripe.',
  locale: 'en_US',
  lang: 'en',
  themeColor: '#060b10',
  twitterSite: '', // e.g. '@projects6' — left empty until a real handle exists
  ogImage: { path: '/og-image.jpg', width: 1200, height: 630, type: 'image/jpeg', alt: 'Dark blue Audi S6 Avant in a neon-lit garage — Project S6' },
  // No engine in the name: the owner's live data is the source of truth for the spec.
  vehicle: { name: 'Audi S6 C5 Avant (2003)', brand: 'Audi', model: 'S6 Avant', year: '2003' },
};

/** One indexable page per part, so each part can be found and shared on its own. */
export const PART_ROUTES = SEO_PARTS.map((part) => ({
  path: `/parts/${part.slug}`,
  title: `${part.name} · Audi S6 Restoration`,
  description: `${part.name}: ${part.summary} Help fund it for Project S6, a 2003 Audi S6 C5 Avant restoration.`,
  h1: part.name,
  breadcrumb: part.name,
  parent: { path: '/parts', name: 'Parts' },
  changefreq: 'weekly',
  priority: 0.6,
  image: { path: partSharePath(part.slug), width: 1200, height: 630, type: 'image/jpeg', alt: `${part.name} for the Project S6 Audi S6 Avant restoration` },
  part,
}));

/**
 * Per-route metadata. Titles stay ≤ 60 characters and descriptions ≤ 160 so search
 * results don't truncate them. `index: false` → noindex + excluded from sitemap.
 */
export const ROUTES = [
  {
    path: '/',
    title: SITE.defaultTitle,
    absoluteTitle: true,
    description: SITE.description,
    h1: 'Project S6 — Audi S6 C5 Avant restoration',
    breadcrumb: 'Garage',
    changefreq: 'weekly',
    priority: 1.0,
  },
  {
    path: '/parts',
    title: 'Parts Needed for the Audi S6 Restoration',
    description: 'Every part the Audi S6 C5 Avant restoration needs: estimated costs, condition and purchase status, from bumpers and exhaust to suspension and interior.',
    h1: 'Parts needed for the restoration',
    breadcrumb: 'Parts',
    changefreq: 'weekly',
    priority: 0.8,
    listsParts: true,
  },
  ...PART_ROUTES,
  {
    path: '/donations',
    title: 'Support the Restoration',
    description: 'See how much the Audi S6 restoration has raised, how contributions are used, and the supporters who chose to be listed. Payments run through Stripe.',
    h1: 'Support the restoration',
    breadcrumb: 'Donations',
    changefreq: 'daily',
    priority: 0.7,
  },
  {
    path: '/progress',
    title: 'Restoration Progress & Updates',
    description: 'Restoration log for the Audi S6 C5 Avant: updates with photos and costs, parts bought so far, and what is still needed.',
    h1: 'Restoration progress',
    breadcrumb: 'Progress',
    changefreq: 'weekly',
    priority: 0.7,
  },
  {
    path: '/about',
    title: 'About the Project',
    description: 'The story behind Project S6, the restoration plan for the Audi S6 C5 Avant, and how funding and part contributions work.',
    h1: 'About Project S6',
    breadcrumb: 'About',
    changefreq: 'monthly',
    priority: 0.5,
  },
  { path: '/community', title: 'The Garage Community', description: 'Share your build, ask for repair help and connect with enthusiasts. A welcoming community built around the Project S6 restoration.', h1: 'The Project S6 community', breadcrumb: 'Community', changefreq: 'daily', priority: 0.7 },
  { path: '/terms', title: 'Donation Terms & Community Guidelines', description: 'How Project S6 contributions work, what happens after funding goals are reached, refund requests and community guidelines.', h1: 'Donation terms and community guidelines', breadcrumb: 'Terms', changefreq: 'monthly', priority: 0.2 },
  { path: '/privacy', title: 'Privacy Notice', description: 'How Project S6 handles payment information, community accounts, email subscriptions, consent and your privacy choices.', h1: 'Privacy notice', breadcrumb: 'Privacy', changefreq: 'monthly', priority: 0.2 },
  { path: '/subscription/confirm', title: 'Confirm Email Updates', description: 'Confirm your email subscription.', h1: 'Confirm your subscription', index: false },
  { path: '/subscription/unsubscribe', title: 'Unsubscribe', description: 'Manage your build emails.', h1: 'Unsubscribe', index: false },
  { path: '/admin', title: 'Owner Admin', description: 'Owner area.', h1: 'Owner admin', index: false },
  { path: '/donation/success', title: 'Thank You', description: 'Contribution confirmation.', h1: 'Confirming your contribution', index: false },
  { path: '/donation/cancel', title: 'Checkout Cancelled', description: 'Checkout was cancelled; no payment was taken.', h1: 'Checkout cancelled', index: false },
];

export const NOT_FOUND = { path: '/404', title: 'Page Not Found', description: 'This page could not be found.', h1: 'Page not found', index: false, notFound: true };

export const normalizePath = (pathname = '/') => {
  const p = pathname.split(/[?#]/)[0].replace(/\/{2,}/g, '/');
  return p.length > 1 ? p.replace(/\/+$/, '') : '/';
};

export function getRouteMeta(pathname) {
  const p = normalizePath(pathname);
  return ROUTES.find((r) => r.path === p) ?? NOT_FOUND;
}

export const fullTitle = (route) => (route.absoluteTitle ? route.title : `${route.title}${SITE.titleSuffix}`);

const trimSlash = (u) => (u || '').replace(/\/+$/, '');
export const absoluteUrl = (siteUrl, path) => (siteUrl ? `${trimSlash(siteUrl)}${path === '/' ? '/' : path}` : null);

const routeImage = (route) => route.image ?? SITE.ogImage;

/** JSON-LD graph for a route: WebSite + the car, breadcrumbs on sub-pages, the part a
 *  part page is about, and the list of part pages on /parts. */
export function structuredData(route, siteUrl) {
  if (!siteUrl || route.index === false) return null;
  const home = absoluteUrl(siteUrl, '/');
  const pageUrl = absoluteUrl(siteUrl, route.path);
  const image = absoluteUrl(siteUrl, routeImage(route).path);
  const graph = [
    {
      '@type': 'WebSite',
      '@id': `${home}#website`,
      url: home,
      name: SITE.name,
      description: SITE.description,
      inLanguage: SITE.lang,
    },
    {
      '@type': 'Car',
      '@id': `${home}#car`,
      name: SITE.vehicle.name,
      brand: { '@type': 'Brand', name: SITE.vehicle.brand },
      model: SITE.vehicle.model,
      vehicleModelDate: SITE.vehicle.year,
      image: absoluteUrl(siteUrl, SITE.ogImage.path),
      url: home,
    },
    {
      '@type': 'WebPage',
      '@id': `${pageUrl}#webpage`,
      url: pageUrl,
      name: fullTitle(route),
      description: route.description,
      isPartOf: { '@id': `${home}#website` },
      about: route.part ? { '@id': `${pageUrl}#part` } : { '@id': `${home}#car` },
      primaryImageOfPage: { '@type': 'ImageObject', url: image, width: routeImage(route).width, height: routeImage(route).height },
      inLanguage: SITE.lang,
    },
  ];
  if (route.part) {
    // A restoration item for the car, not a product for sale: no offer or price.
    graph.push({
      '@type': 'Thing',
      '@id': `${pageUrl}#part`,
      name: route.part.name,
      description: route.part.summary,
      image,
      url: pageUrl,
      subjectOf: { '@id': `${home}#car` },
    });
  }
  if (route.listsParts) {
    graph.push({
      '@type': 'ItemList',
      '@id': `${pageUrl}#parts`,
      name: 'Parts needed for the Audi S6 restoration',
      numberOfItems: PART_ROUTES.length,
      itemListElement: PART_ROUTES.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: r.part.name, url: absoluteUrl(siteUrl, r.path) })),
    });
  }
  if (route.path !== '/') {
    const trail = [{ name: 'Garage', path: '/' }, ...(route.parent ? [route.parent] : []), { name: route.breadcrumb ?? route.title, path: route.path }];
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((step, i) => ({ '@type': 'ListItem', position: i + 1, name: step.name, item: absoluteUrl(siteUrl, step.path) })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * Head tags for a route as plain descriptors. `key` identifies each tag so the browser
 * hook can update tags in place instead of duplicating them.
 * @returns {{ title: string, tags: Array<{tag:'meta'|'link', key:string, attrs:object}>, jsonLd: object|null }}
 */
export function headFor(route, { siteUrl = '', noindex = false } = {}) {
  const title = fullTitle(route);
  const url = absoluteUrl(siteUrl, route.path);
  const img = routeImage(route);
  const image = absoluteUrl(siteUrl, img.path);
  const robots = noindex || route.index === false ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
  const tags = [
    { tag: 'meta', key: 'description', attrs: { name: 'description', content: route.description } },
    { tag: 'meta', key: 'robots', attrs: { name: 'robots', content: robots } },
    { tag: 'meta', key: 'og:type', attrs: { property: 'og:type', content: 'website' } },
    { tag: 'meta', key: 'og:site_name', attrs: { property: 'og:site_name', content: SITE.name } },
    { tag: 'meta', key: 'og:locale', attrs: { property: 'og:locale', content: SITE.locale } },
    { tag: 'meta', key: 'og:title', attrs: { property: 'og:title', content: title } },
    { tag: 'meta', key: 'og:description', attrs: { property: 'og:description', content: route.description } },
    { tag: 'meta', key: 'twitter:card', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
    { tag: 'meta', key: 'twitter:title', attrs: { name: 'twitter:title', content: title } },
    { tag: 'meta', key: 'twitter:description', attrs: { name: 'twitter:description', content: route.description } },
  ];
  if (url && route.index !== false) {
    tags.push({ tag: 'link', key: 'canonical', attrs: { rel: 'canonical', href: url } });
    tags.push({ tag: 'meta', key: 'og:url', attrs: { property: 'og:url', content: url } });
  }
  if (image) {
    tags.push(
      { tag: 'meta', key: 'og:image', attrs: { property: 'og:image', content: image } },
      { tag: 'meta', key: 'og:image:type', attrs: { property: 'og:image:type', content: img.type } },
      { tag: 'meta', key: 'og:image:width', attrs: { property: 'og:image:width', content: String(img.width) } },
      { tag: 'meta', key: 'og:image:height', attrs: { property: 'og:image:height', content: String(img.height) } },
      { tag: 'meta', key: 'og:image:alt', attrs: { property: 'og:image:alt', content: img.alt } },
      { tag: 'meta', key: 'twitter:image', attrs: { name: 'twitter:image', content: image } },
      { tag: 'meta', key: 'twitter:image:alt', attrs: { name: 'twitter:image:alt', content: img.alt } },
    );
  }
  if (SITE.twitterSite) tags.push({ tag: 'meta', key: 'twitter:site', attrs: { name: 'twitter:site', content: SITE.twitterSite } });
  return { title, tags, jsonLd: noindex ? null : structuredData(route, siteUrl) };
}

// ---------------------------------------------------------------- static rendering helpers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Serialize JSON-LD safely for inline <script> (no "</script>" breakout). */
export const jsonLdString = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

export function renderHeadHtml(head) {
  const lines = [`<title>${esc(head.title)}</title>`];
  for (const t of head.tags) {
    const attrs = Object.entries(t.attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
    lines.push(t.tag === 'link' ? `<link ${attrs} data-seo="${esc(t.key)}" />` : `<meta ${attrs} data-seo="${esc(t.key)}" />`);
  }
  if (head.jsonLd) lines.push(`<script type="application/ld+json" data-seo="jsonld">${jsonLdString(head.jsonLd)}</script>`);
  return lines.join('\n    ');
}

/** Minimal crawlable fallback for visitors/crawlers without JavaScript. */
export const renderNoscriptHtml = (route) =>
  `<noscript><main style="font-family:sans-serif;color:#f4f7fb;background:#060b10;padding:24px"><h1>${esc(route.h1 ?? route.title)}</h1><p>${esc(route.description)}</p><p>This site needs JavaScript for the interactive garage and donations.</p></main></noscript>`;

export function renderSitemap(siteUrl, lastmod) {
  const urls = ROUTES.filter((r) => r.index !== false)
    .map((r) => {
      const img = routeImage(r);
      const image = `\n    <image:image>\n      <image:loc>${esc(absoluteUrl(siteUrl, img.path))}</image:loc>\n    </image:image>`;
      return `  <url>\n    <loc>${esc(absoluteUrl(siteUrl, r.path))}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority.toFixed(1)}</priority>${image}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls}\n</urlset>\n`;
}

export function renderRobots(siteUrl, { noindex = false } = {}) {
  if (noindex) return 'User-agent: *\nDisallow: /\n';
  // Private pages (/admin, /donation/*) are NOT blocked here: crawlers must be able to fetch
  // them to see their noindex tag. Only the JSON API is blocked.
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /api/'];
  if (siteUrl) lines.push('', `Sitemap: ${absoluteUrl(siteUrl, '/sitemap.xml')}`);
  return `${lines.join('\n')}\n`;
}
