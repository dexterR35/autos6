import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { readScrubbed } from '../lib/urlScrub.js';

export default function SubscriptionReturn() {
  const { pathname, hash } = useLocation();
  const confirm = pathname.endsWith('/confirm');
  // main.jsx moves the token out of the address before trackers load (urlScrub.js).
  const [token] = useState(() => new URLSearchParams(hash.slice(1)).get('token') || readScrubbed('token', pathname) || '');
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const submit = async () => {
    setState('busy');
    try {
      const response = await fetch(`/api/subscriptions/${confirm ? 'confirm' : 'unsubscribe'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Please try again.');
      setState('done');
      window.history.replaceState(null, '', pathname);
    } catch (err) { setError(err.message); setState('idle'); }
  };
  return <div className="page page--narrow"><section className="panel return-card"><Bell aria-hidden="true" className="return-card__icon" /><h1>{state === 'done' ? confirm ? 'You’re part of the build' : 'You’re unsubscribed' : confirm ? 'Confirm your subscription' : 'Unsubscribe from updates'}</h1><p>{state === 'done' ? confirm ? 'We’ll email you when there’s news on the build.' : 'You will no longer receive build emails.' : confirm ? 'Confirm that you would like to receive Project S6 updates.' : 'Stop all build emails for this subscription.'}</p>{error && <p className="form-error" role="alert">{error}</p>}{state !== 'done' && <button className="btn btn--primary" disabled={!token || state === 'busy'} onClick={submit}>{state === 'busy' ? 'Saving…' : confirm ? 'Confirm email updates' : 'Unsubscribe'}</button>}{!token && state !== 'done' && <p className="muted">Open the full link from your email.</p>}<Link to="/community">Visit the community</Link></section></div>;
}
