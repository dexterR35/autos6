import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function contentSecurityPolicy(config, dist) {
  const hashes = [];
  if (config.serveStatic) {
    try {
      const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/src\s*=|application\/ld\+json/i.test(match[1]) || !match[2].trim()) continue;
        hashes.push(`'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
      }
    } catch { /* API-only process has no inline scripts. */ }
  }
  let supabaseOrigin = null;
  let modelOrigin = null;
  try { if (config.supabaseUrl) supabaseOrigin = new URL(config.supabaseUrl).origin; } catch { /* config not set */ }
  try { if (config.modelAssetBaseUrl) modelOrigin = new URL(config.modelAssetBaseUrl).origin; } catch { /* validated at frontend build */ }
  // Ad pixel hosts are allowed only when that pixel is configured (or GTM holds ad tags).
  const px = config.pixels ?? {};
  const meta = px.meta || px.gtmMarketing;
  const tiktok = px.tiktok || px.gtmMarketing;
  const ads = px.googleAds || px.gtmMarketing;
  const pixelScripts = [...(meta ? ['https://connect.facebook.net'] : []), ...(tiktok ? ['https://analytics.tiktok.com'] : [])];
  const pixelBeacons = [
    ...(meta ? ['https://www.facebook.com', 'https://connect.facebook.net'] : []),
    ...(tiktok ? ['https://analytics.tiktok.com'] : []),
    ...(ads ? ['https://www.google.com', 'https://googleads.g.doubleclick.net', 'https://www.googleadservices.com'] : []),
  ];
  return { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "'wasm-unsafe-eval'", ...hashes, 'https://www.googletagmanager.com', ...pixelScripts],
    scriptSrcAttr: ["'none'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', ...(supabaseOrigin ? [supabaseOrigin] : []), 'https://www.google-analytics.com', 'https://www.googletagmanager.com', ...pixelBeacons],
    connectSrc: ["'self'", 'blob:', ...(modelOrigin ? [modelOrigin] : []), ...(supabaseOrigin ? [supabaseOrigin, supabaseOrigin.replace(/^https:/, 'wss:')] : []), 'https://www.google-analytics.com', 'https://region1.google-analytics.com', 'https://www.googletagmanager.com', ...pixelBeacons],
    workerSrc: ["'self'"],
    frameSrc: ['https://www.googletagmanager.com', ...(ads ? ['https://td.doubleclick.net'] : [])], objectSrc: ["'none'"], baseUri: ["'self'"],
    frameAncestors: ["'none'"], formAction: ["'self'"], upgradeInsecureRequests: config.appOrigin.startsWith('https:') ? [] : null,
  } };
}
