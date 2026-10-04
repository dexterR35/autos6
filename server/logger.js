// Minimal structured logger that redacts personal data and secrets before printing.
const PATTERNS = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  [/\b(sk|rk)_(test|live)_[A-Za-z0-9]+/g, '[stripe-key]'],
  [/\bwhsec_[A-Za-z0-9]+/g, '[webhook-secret]'],
  [/\bsb_secret_[A-Za-z0-9_-]+/g, '[supabase-secret]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]'],
  [/\b(cs|pi|ch)_(test|live)_[A-Za-z0-9]*([A-Za-z0-9]{4})\b/g, '$1_$2_…$3'],
];

export function redact(value) {
  let s = typeof value === 'string' ? value : JSON.stringify(value);
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s;
}

export function createLogger({ silent = false } = {}) {
  const out = (level, msg, meta) => {
    if (silent) return;
    const line = `[${new Date().toISOString()}] ${level} ${redact(msg)}${meta ? ' ' + redact(meta) : ''}`;
    (level === 'ERROR' ? console.error : console.log)(line);
  };
  return {
    info: (m, meta) => out('INFO', m, meta),
    warn: (m, meta) => out('WARN', m, meta),
    error: (m, meta) => out('ERROR', m, meta),
  };
}
