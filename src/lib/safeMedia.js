// Only local paths and HTTPS media can be rendered from database content.
export function safeMediaUrl(input) {
  if (typeof input !== 'string' || input.length > 2000 || /[\u0000-\u0020\u007f\\]/.test(input)) return null;
  if (input.startsWith('/') && !input.startsWith('//')) return input;
  try { const url = new URL(input); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
