// Analytics and ad pixels read the page address. Two pages carry bearer values in it:
// the Stripe return (?session_id=, which unlocks the donation status) and the email links
// (#token=, which confirm or cancel a subscription). Before any tracker can load, move
// them into this tab's session storage and clean the address bar. vite/seoPlugin.js runs
// the same scrub inline in <head> ahead of Google Tag Manager.

const KEY = 'project-s6:url-secrets';
let memory = null; // fallback when session storage is blocked

export function scrubSensitiveUrl(win = globalThis.window) {
  if (!win?.location || !win.history) return;
  const { pathname, search, hash } = win.location;
  const params = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const saved = {};
  if (pathname === '/donation/success' && params.has('session_id')) {
    saved.session_id = params.get('session_id');
    params.delete('session_id');
  }
  if (pathname.startsWith('/subscription/') && fragment.has('token')) saved.token = fragment.get('token');
  if (!Object.keys(saved).length) return;
  memory = { path: pathname, ...saved };
  try { win.sessionStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* memory copy is used */ }
  const query = params.toString();
  const keepHash = saved.token ? '' : hash;
  win.history.replaceState(win.history.state, '', `${pathname}${query ? `?${query}` : ''}${keepHash}`);
}

/** A value scrubbed from this page's address, if the tab is still on that page. */
export function readScrubbed(name, pathname) {
  let value = memory;
  try { value = JSON.parse(globalThis.sessionStorage?.getItem(KEY) || 'null') ?? memory; } catch { /* use memory */ }
  return value && value.path === pathname ? value[name] ?? null : null;
}

/** True when the address holds nothing a tracker must not see (also sign-in callbacks). */
export function isTrackableUrl(loc = globalThis.location) {
  if (!loc) return false;
  if (loc.pathname.startsWith('/admin')) return false;
  if (/(^|[?&])session_id=/.test(loc.search)) return false;
  return !/(access_token|refresh_token|token=|error_description|code=)/.test(`${loc.hash}${loc.search}`);
}
