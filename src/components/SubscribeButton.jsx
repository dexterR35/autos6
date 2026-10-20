import { useId, useState } from 'react';
import { Bell, CheckCircle2, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import Modal from './Modal.jsx';
import { POLICY_VERSION } from '../lib/policies.js';
import { useProjectData } from '../hooks/useProjectData.jsx';

export default function SubscribeButton({ partId = null, className = 'btn btn--ghost btn--block' }) {
  const titleId = useId();
  const { project, isDemo, parts } = useProjectData();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const part = parts.find((p) => p.id === partId);
  const submit = async (event) => {
    event.preventDefault();
    if (state === 'sending') return;
    if (!consent) return setError('Please agree to receive email updates.');
    setError('');
    if (isDemo) { setState('demo'); return; }
    setState('sending');
    try {
      const response = await fetch('/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectSlug: project.slug, partId, email, website, consent: POLICY_VERSION }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Subscription unavailable.');
      setState('sent');
      setEmail('');
    } catch (err) { setError(err.message || 'Please try again.'); setState('idle'); }
  };
  return <>
    <button type="button" className={className} onClick={() => { setOpen(true); setState('idle'); setError(''); setConsent(false); }}><Bell aria-hidden="true" />{part ? 'Follow this part' : 'Subscribe to build updates'}</button>
    <Modal open={open} onClose={() => setOpen(false)} title="Stay in the build" labelledBy={titleId} className="subscribe-modal">
      {state === 'sent' || state === 'demo' ? <div className="subscription-result" role="status"><CheckCircle2 aria-hidden="true" /><h3>{state === 'demo' ? 'Demo preview · no email sent' : 'Check your inbox'}</h3><p>{state === 'demo' ? 'Live subscriptions send a confirmation link before activating updates.' : 'If this address needs confirmation, an email is on its way. Open it within 24 hours. Existing subscriptions stay active.'}</p><button className="btn btn--primary" onClick={() => setOpen(false)}>Done</button></div> : <form onSubmit={submit}>
        <p className="muted">{part ? `Get an email when ${part.name} changes, plus published restoration updates.` : 'Part upgrades, new additions and restoration updates. Follow the journey, one part at a time.'}</p>
        <label className="field"><span><Mail aria-hidden="true" /> Email address</span><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
        <label className="check"><input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>I want email updates about this build. I have read the <Link target="_blank" rel="noopener noreferrer" to="/privacy">privacy notice</Link>. I can unsubscribe at any time.</span></label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button className="btn btn--primary btn--block" disabled={state === 'sending'}>{state === 'sending' ? 'Saving…' : 'Send confirmation email'}</button>
        <p className="fine">Free email subscription. No recurring payments. {isDemo && 'Demo mode: your email will not be stored or sent.'}</p>
      </form>}
    </Modal>
  </>;
}
