// Vite plugin: SEO <head>, Google Tag Manager, and static per-route HTML.
//
// • transformIndexHtml (dev + build): fills the <!--seo:head--> / <!--seo:noscript-->
//   markers in index.html for "/", and injects Consent Mode v2 defaults + GTM when
//   VITE_GTM_ID is set (build only, unless VITE_GTM_IN_DEV=true).
// • closeBundle (build): writes dist/<route>/index.html for every route with that route's
//   title/description/canonical/OG/JSON-LD baked in, plus 404.html, robots.txt and
//   sitemap.xml. Crawlers and link-preview bots get correct tags without running JS.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROUTES, NOT_FOUND, getRouteMeta, headFor, renderHeadHtml, renderNoscriptHtml, renderRobots, renderSitemap } from '../src/seo/config.js';

const HEAD_RE = /<!--seo:head-->[\s\S]*?<!--\/seo:head-->/;
const NOSCRIPT_RE = /<!--seo:noscript-->[\s\S]*?<!--\/seo:noscript-->/;

export function gtmHeadSnippet(id, { marketing = false } = {}) {
  // Consent defaults MUST run before the container loads (Consent Mode v2). Marketing
  // choices only apply when the container holds ad tags (VITE_GTM_MARKETING=true).
  const marketingGranted = marketing ? "localStorage.getItem('project-s6:marketing-consent')==='granted'" : 'false';
  return `<script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', functionality_storage: 'granted', security_storage: 'granted', wait_for_update: 500 });
      try { var s6a = localStorage.getItem('project-s6:analytics-consent') === 'granted', s6m = ${marketingGranted}, s6u = {};
        if (s6a) s6u.analytics_storage = 'granted';
        if (s6m) { s6u.ad_storage = 'granted'; s6u.ad_user_data = 'granted'; s6u.ad_personalization = 'granted'; }
        if (s6a || s6m) gtag('consent', 'update', s6u); } catch (e) {}
    </script>
    <!-- Google Tag Manager: loaded only after opt-in, never while the address holds a secret (src/lib/urlScrub.js) -->
    <script>window.__s6StartAnalytics=function(){if(window.__s6GtmStarted)return;window.__s6GtmStarted=true;(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');};(function(){try{var L=location,p=new URLSearchParams(L.search),h=new URLSearchParams(L.hash.slice(1)),v={path:L.pathname};if(L.pathname==='/donation/success'&&p.has('session_id')){v.session_id=p.get('session_id');p.delete('session_id');}if(L.pathname.indexOf('/subscription/')===0&&h.has('token'))v.token=h.get('token');if(v.session_id||v.token){sessionStorage.setItem('project-s6:url-secrets',JSON.stringify(v));var q=p.toString();history.replaceState(history.state,'',L.pathname+(q?'?'+q:'')+(v.token?'':L.hash));}var clean=L.pathname.indexOf('/admin')!==0&&!/(^|[?&])session_id=/.test(L.search)&&!/(access_token|refresh_token|token=|error_description|code=)/.test(L.hash+L.search);if(clean&&(localStorage.getItem('project-s6:analytics-consent')==='granted'||${marketingGranted}))window.__s6StartAnalytics();}catch(e){}})();</script>
    <!-- End Google Tag Manager -->`;
}

// A noscript iframe cannot ask for consent. Never inject a third-party request here.
export const gtmBodySnippet = () => '';

export function renderPage(template, route, opts) {
  const head = headFor(route, opts);
  return template
    .replace(HEAD_RE, `<!--seo:head-->\n    ${renderHeadHtml(head)}\n    <!--/seo:head-->`)
    .replace(NOSCRIPT_RE, `<!--seo:noscript-->${renderNoscriptHtml(route)}<!--/seo:noscript-->`);
}

export default function seoPlugin(env) {
  const siteUrl = (env.VITE_SITE_URL || '').replace(/\/+$/, '');
  const noindex = String(env.VITE_NOINDEX || '').toLowerCase() === 'true';
  const gtmId = env.VITE_GTM_ID || '';
  const validGtm = /^GTM-[A-Z0-9]{4,12}$/.test(gtmId);
  let outDir = 'dist';
  let isBuild = false;

  return {
    name: 'project-s6-seo',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      isBuild = config.command === 'build';
      if (isBuild && !siteUrl) config.logger.warn('[seo] VITE_SITE_URL is not set: canonical, og:url, og:image, JSON-LD and sitemap URLs are omitted.');
      if (gtmId && !validGtm) config.logger.warn(`[seo] VITE_GTM_ID "${gtmId}" is not a valid GTM container id (GTM-XXXXXXX); GTM not installed.`);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let out = renderPage(html, getRouteMeta('/'), { siteUrl, noindex });
        const withGtm = validGtm && (isBuild || env.VITE_GTM_IN_DEV === 'true');
        if (withGtm) {
          out = out.replace('<!--gtm:head-->', gtmHeadSnippet(gtmId, { marketing: env.VITE_GTM_MARKETING === 'true' }));
          if (env.VITE_GTM_NOSCRIPT !== 'false') out = out.replace('<!--gtm:body-->', gtmBodySnippet(gtmId));
        }
        return out.replace('<!--gtm:head-->', '').replace('<!--gtm:body-->', '');
      },
    },
    closeBundle() {
      if (!isBuild) return;
      const template = readFileSync(path.join(outDir, 'index.html'), 'utf8');
      for (const route of ROUTES) {
        if (route.path === '/') continue;
        const dir = path.join(outDir, route.path);
        mkdirSync(dir, { recursive: true });
        const page = renderPage(template, route, { siteUrl, noindex });
        writeFileSync(path.join(dir, 'index.html'), page);
      }
      writeFileSync(path.join(outDir, '404.html'), renderPage(template, NOT_FOUND, { siteUrl, noindex }));
      writeFileSync(path.join(outDir, 'robots.txt'), renderRobots(siteUrl, { noindex }));
      if (siteUrl && !noindex) writeFileSync(path.join(outDir, 'sitemap.xml'), renderSitemap(siteUrl, new Date().toISOString().slice(0, 10)));
    },
  };
}
