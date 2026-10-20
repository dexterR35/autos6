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
  return { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "'wasm-unsafe-eval'", ...hashes, 'https://www.googletagmanager.com'],
    scriptSrcAttr: ["'none'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', ...(supabaseOrigin ? [supabaseOrigin] : []), 'https://www.google-analytics.com', 'https://www.googletagmanager.com'],
    connectSrc: ["'self'", 'blob:', ...(modelOrigin ? [modelOrigin] : []), ...(supabaseOrigin ? [supabaseOrigin, supabaseOrigin.replace(/^https:/, 'wss:')] : []), 'https://www.google-analytics.com', 'https://region1.google-analytics.com', 'https://www.googletagmanager.com'],
    workerSrc: ["'self'"],
    frameSrc: ['https://www.googletagmanager.com'], objectSrc: ["'none'"], baseUri: ["'self'"],
    frameAncestors: ["'none'"], formAction: ["'self'"], upgradeInsecureRequests: config.appOrigin.startsWith('https:') ? [] : null,
  } };
}
