import { useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { track } from '../lib/analytics.js';

/** Native share sheet on phones; copies the link elsewhere. Links get a live preview card. */
export default function ShareButton({ path, title, text, className = 'btn btn--ghost btn--block' }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = new URL(path, window.location.origin).href;
    track('share', { method: navigator.share ? 'native' : 'copy', content_type: 'part', item_id: path });
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return; } catch (err) { if (err?.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this link', url);
    }
  };
  return (
    <button type="button" className={className} onClick={share}>
      {copied ? <Check aria-hidden="true" /> : <Share2 aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'Link copied' : 'Share this part'}</span>
    </button>
  );
}
