import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Handshake, MessageCircle, Plus, ShieldCheck, Users, Wrench } from 'lucide-react';
import Modal from '../components/Modal.jsx';
import SubscribeButton from '../components/SubscribeButton.jsx';
import DemoBadge from '../components/DemoBadge.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';
import useCommunitySession from '../hooks/useCommunitySession.js';
import { supabase } from '../lib/supabase.js';
import { POLICY_VERSION } from '../lib/policies.js';

const CATEGORIES = { all: 'All discussions', help: 'Ask for help', parts: 'Parts exchange', builds: 'Your builds', general: 'Garage talk' };
const PAGE_SIZE = 12;

function Composer({ project, parent = null, onDone }) {
  const [form, setForm] = useState({ name: '', title: '', body: '', category: 'help', consent: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!form.consent) return setError('Please accept the community guidelines.');
    setBusy(true); setError('');
    try {
      const { error: failure } = await supabase.rpc('create_community_post', { p_slug: project.slug, p_parent: parent?.id ?? null, p_name: form.name, p_category: parent?.category ?? form.category, p_title: parent ? `Re: ${parent.title}`.slice(0, 140) : form.title, p_body: form.body, p_consent: POLICY_VERSION });
      if (failure) throw failure;
      onDone();
    } catch (err) { setError(err.message || 'Could not submit. Please try again.'); }
    finally { setBusy(false); }
  };
  return <form onSubmit={submit}>
    <p className="fine">New posts and replies are reviewed before appearing publicly. Keep personal contact details out of posts.</p>
    <label className="field"><span>Public display name</span><input required minLength={2} maxLength={40} value={form.name} onChange={set('name')} /></label>
    {!parent && <><label className="field"><span>Topic</span><select value={form.category} onChange={set('category')}>{Object.entries(CATEGORIES).filter(([id]) => id !== 'all').map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="field"><span>Title</span><input required minLength={3} maxLength={140} value={form.title} onChange={set('title')} /></label></>}
    <label className="field"><span>{parent ? 'Your reply' : 'What’s on your mind?'}</span><textarea required minLength={10} maxLength={4000} rows={5} value={form.body} onChange={set('body')} /></label>
    <label className="check"><input type="checkbox" required checked={form.consent} onChange={set('consent')} /><span>I agree to the <Link to="/terms" target="_blank" rel="noopener noreferrer">community guidelines and terms</Link> and understand this content is public.</span></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="btn btn--primary btn--block" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</button>
  </form>;
}

export default function Community() {
  const { project, isDemo, status: projectStatus } = useProjectData();
  const session = useCommunitySession();
  const [category, setCategory] = useState('all');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [compose, setCompose] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [authStatus, setAuthStatus] = useState('idle');
  const [active, setActive] = useState(null);
  const [replies, setReplies] = useState([]);
  const [replyStatus, setReplyStatus] = useState('idle');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (isDemo || !supabase || !project.id) { setRows([]); setStatus('ready'); return; }
    setStatus('loading'); setError('');
    let query = supabase.from('community_posts').select('id,title,body,display_name,category,status,created_at').eq('project_id', project.id).is('parent_id', null).order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    if (category !== 'all') query = query.eq('category', category);
    const { data, error: failure } = await query;
    if (failure) { setStatus('error'); setError('Discussions could not load. Please try again.'); return; }
    setRows(data.slice(0, PAGE_SIZE)); setHasMore(data.length > PAGE_SIZE); setStatus('ready');
  }, [isDemo, project.id, category, page, session?.user.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!active || !supabase) return;
    let stopped = false;
    setReplies([]); setReplyStatus('loading');
    supabase.from('community_posts').select('id,body,display_name,status,created_at').eq('parent_id', active.id).order('created_at').limit(100).then(({ data, error: failure }) => { if (!stopped) { setReplies(data ?? []); setReplyStatus(failure ? 'error' : 'ready'); } });
    return () => { stopped = true; };
  }, [active]);
  const begin = () => {
    setNotice('');
    if (isDemo) { setNotice('Demo mode: community posting becomes available when live Supabase is connected.'); return; }
    if (!supabase || projectStatus !== 'ready') { setNotice('Community posting is temporarily unavailable.'); return; }
    if (!session) { setAuthOpen(true); setAuthStatus('idle'); setError(''); return; }
    setCompose(true);
  };
  const signIn = async (e) => {
    e.preventDefault();
    if (!supabase || authStatus === 'sending') return;
    setAuthStatus('sending'); setError('');
    try {
      const { error: failure } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/community` } });
      if (failure) throw failure;
      setAuthStatus('sent');
    } catch { setError('Sign-in email unavailable. Please try again later.'); setAuthStatus('idle'); }
  };
  const done = () => { setCompose(false); setActive(null); setNotice('Thanks! Your contribution is awaiting moderator review.'); load(); };

  return <div className="page community-page">
    <header className="community-hero panel"><div><p className="kicker">Built together. Driven together.</p><h1>A garage for<br /><span>all of us.</span></h1><p className="muted">Share what you know. Find the part you need.<br />Help a fellow enthusiast get back on the road.</p><div className="community-hero__actions"><button className="btn btn--primary" onClick={() => { setActive(null); begin(); }}><Plus aria-hidden="true" /> Start a discussion</button><SubscribeButton className="btn btn--ghost" /></div>{isDemo && <DemoBadge>Demo preview</DemoBadge>}</div><div className="community-hero__art" aria-hidden="true"><Users /><span>GOOD PEOPLE.<br />GREAT BUILDS.</span></div></header>
    <div className="community-values">{[[Wrench, 'Share the know-how', 'Repairs, upgrades and lessons learned.'], [Handshake, 'Help each other', 'Source parts and solve problems together.'], [ShieldCheck, 'Keep it welcoming', 'Helpful people. Reviewed discussions.']].map(([Icon, title, body]) => <div key={title}><Icon aria-hidden="true" /><span><strong>{title}</strong><small>{body}</small></span></div>)}</div>
    <div className="community-layout"><section aria-labelledby="discussions-title"><div className="section-head"><h2 id="discussions-title">Around the garage</h2>{session && <button className="link-btn" onClick={() => supabase.auth.signOut()}>Sign out</button>}</div><div className="priority-filters community-filters" role="group" aria-label="Discussion category">{Object.entries(CATEGORIES).map(([id, name]) => <button key={id} aria-pressed={category === id} onClick={() => { setCategory(id); setPage(0); }}>{name}</button>)}</div>
      {notice && <p className="note" role="status">{notice}</p>}
      {status === 'loading' && <p className="muted">Loading discussions…</p>}
      {status === 'error' && <div className="panel empty"><p role="alert">{error}</p><button className="btn btn--ghost" onClick={load}>Try again</button></div>}
      {status === 'ready' && rows.length === 0 && <div className="panel community-empty"><MessageCircle aria-hidden="true" /><h3>The next conversation starts with you.</h3><p className="muted">Ask a repair question, share your build, or help someone find a part.</p><button className="btn btn--ghost" onClick={begin}>Start the conversation <ArrowUpRight aria-hidden="true" /></button></div>}
      <ul className="discussion-list">{rows.map((post) => <li key={post.id}><button className="panel discussion-card" onClick={() => setActive(post)}><span className="discussion-card__category">{CATEGORIES[post.category]}{post.status !== 'approved' && ` · ${post.status}`}</span><strong>{post.title}</strong><span className="discussion-card__excerpt">{post.body}</span><span className="discussion-card__meta">{post.display_name} <span>· {new Date(post.created_at).toLocaleDateString()}</span><MessageCircle aria-hidden="true" /></span></button></li>)}</ul>
      {(page > 0 || hasMore) && <div className="pagination"><button className="btn btn--ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button><span>Page {page + 1}</span><button className="btn btn--ghost" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</button></div>}
    </section><aside className="community-aside"><div className="panel"><p className="kicker">The build that brought us here</p><h2>Project S6</h2><img src="/assets/car/thumbs/exterior-a.webp" alt="Audi S6 restoration in the garage" loading="lazy" /><p className="muted">One Audi. A $10,000 goal. Every part moves the story forward.</p><Link className="btn btn--ghost btn--block" to="/parts">Explore the parts <ArrowUpRight aria-hidden="true" /></Link></div><div className="panel"><h2>A few garage rules</h2><p className="muted">Be kind. Share useful advice. No spam or scams. Keep private details private.</p><Link to="/terms">Read the community guidelines</Link></div></aside></div>
    <Modal open={authOpen} onClose={() => setAuthOpen(false)} title="Join the conversation" labelledBy="community-auth-title"><p className="muted">Sign in with a secure email link. No password needed.</p>{authStatus === 'sent' ? <p className="note note--ok" role="status">Check your email for a sign-in link, then return here to post.</p> : <form onSubmit={signIn}><label className="field"><span>Email</span><input type="email" autoComplete="email" maxLength={254} required value={email} onChange={(e) => setEmail(e.target.value)} /></label><p className="fine">Your email stays private. Signing in does not subscribe you to build emails. See our <Link to="/privacy" target="_blank" rel="noopener noreferrer">privacy notice</Link>.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="btn btn--primary btn--block" disabled={authStatus === 'sending'}>{authStatus === 'sending' ? 'Sending…' : 'Email me a sign-in link'}</button></form>}</Modal>
    <Modal open={Boolean(active) && !compose} onClose={() => setActive(null)} title={active?.title ?? 'Discussion'} labelledBy="discussion-title">{active && <><p className="fine">{active.display_name} · {CATEGORIES[active.category]}</p><p className="community-post-body">{active.body}</p><h3>Replies</h3>{replyStatus === 'loading' && <p className="muted">Loading replies…</p>}{replyStatus === 'error' && <p role="alert">Replies could not load.</p>}{replyStatus === 'ready' && replies.length === 0 && <p className="muted">No replies yet. Share what you know.</p>}<ul className="replies">{replies.map((reply) => <li key={reply.id}><strong>{reply.display_name}</strong>{reply.status !== 'approved' && <small> · {reply.status}</small>}<p className="community-post-body">{reply.body}</p></li>)}</ul><button className="btn btn--primary btn--block" disabled={active.status !== 'approved'} onClick={begin}>Add a helpful reply</button></>}</Modal>
    <Modal open={compose} onClose={() => setCompose(false)} title={active ? 'Reply to discussion' : 'Start a discussion'} labelledBy="compose-title"><Composer key={active?.id ?? 'new'} project={project} parent={active} onDone={done} /></Modal>
  </div>;
}
