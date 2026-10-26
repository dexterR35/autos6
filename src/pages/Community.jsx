import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Plus } from 'lucide-react';
import Modal from '../components/Modal.jsx';
import SubscribeButton from '../components/SubscribeButton.jsx';
import DemoBadge from '../components/DemoBadge.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';
import useCommunitySession from '../hooks/useCommunitySession.js';
import { supabase } from '../lib/supabase.js';
import { POLICY_VERSION } from '../lib/policies.js';
import { communityPostError } from '../lib/communityErrors.js';

const CATEGORIES = { all: 'All', help: 'Help', parts: 'Parts', builds: 'Builds', general: 'Garage talk' };
const PAGE_SIZE = 12;

function Composer({ project, parent = null, onDone }) {
  const [form, setForm] = useState({ name: '', title: '', body: '', category: 'help', consent: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!form.consent) return setError('Please accept the community rules.');
    setBusy(true); setError('');
    try {
      const { error: failure } = await supabase.rpc('create_community_post', { p_slug: project.slug, p_parent: parent?.id ?? null, p_name: form.name, p_category: parent?.category ?? form.category, p_title: parent ? `Re: ${parent.title}`.slice(0, 140) : form.title, p_body: form.body, p_consent: POLICY_VERSION });
      if (failure) throw failure;
      onDone();
    } catch (err) { setError(communityPostError(err)); }
    finally { setBusy(false); }
  };
  return <form onSubmit={submit}>
    {!parent && <fieldset className="chip-choice" aria-label="Topic">
      {Object.entries(CATEGORIES).filter(([id]) => id !== 'all').map(([id, name]) => <label key={id}><input type="radio" name="topic" value={id} checked={form.category === id} onChange={set('category')} /><span>{name}</span></label>)}
    </fieldset>}
    {!parent && <label className="field"><span>Title</span><input required minLength={3} maxLength={140} value={form.title} onChange={set('title')} /></label>}
    <label className="field"><span>{parent ? 'Your reply' : 'Message'}</span><textarea required minLength={10} maxLength={4000} rows={5} value={form.body} onChange={set('body')} /></label>
    <label className="field"><span>Your name</span><input required minLength={2} maxLength={40} autoComplete="nickname" value={form.name} onChange={set('name')} /></label>
    <label className="check"><input type="checkbox" required checked={form.consent} onChange={set('consent')} /><span>I accept the <Link to="/terms" target="_blank" rel="noopener noreferrer">community rules</Link>. Posts are public.</span></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="btn btn--primary btn--block" disabled={busy}>{busy ? 'Sending…' : parent ? 'Post reply' : 'Post'}</button>
    <p className="form-footnote">Posts appear after a quick review.</p>
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
    if (failure) { setStatus('error'); setError('Posts could not load.'); return; }
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
    if (isDemo) { setNotice('Demo mode: posting opens when the site is live.'); return; }
    if (!supabase || projectStatus !== 'ready') { setNotice('Posting is unavailable right now.'); return; }
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
    } catch { setError('Could not send the link. Please try again.'); setAuthStatus('idle'); }
  };
  const done = () => { setCompose(false); setActive(null); setNotice('Thanks! Your post appears after review.'); load(); };

  return <div className="page studio community-page">
    <header className="studio-head">
      <div>
        <h1>Community {isDemo && <DemoBadge>Demo</DemoBadge>}</h1>
        <p className="studio-head__stat">Ask, share builds, find parts.</p>
      </div>
      <div className="studio-head__actions">
        <button type="button" className="btn btn--primary" onClick={() => { setActive(null); begin(); }}><Plus aria-hidden="true" /> New post</button>
        <SubscribeButton className="btn btn--ghost" />
        {session && <button type="button" className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>}
      </div>
    </header>

    <div className="studio-filters">
      <div className="studio-segment" role="group" aria-label="Topic">
        {Object.entries(CATEGORIES).map(([id, name]) => <button key={id} type="button" aria-pressed={category === id} onClick={() => { setCategory(id); setPage(0); }}>{name}</button>)}
      </div>
    </div>

    {notice && <p className="form-note" role="status">{notice}</p>}
    {status === 'loading' && <p className="muted">Loading posts…</p>}
    {status === 'error' && <div className="panel studio-empty-card"><p role="alert">{error}</p><button className="btn btn--ghost" onClick={load}>Try again</button></div>}
    {status === 'ready' && rows.length === 0 && <div className="panel studio-empty-card"><MessageCircle aria-hidden="true" /><h2>No posts yet</h2><button type="button" className="btn btn--primary" onClick={begin}><Plus aria-hidden="true" /> Start the first one</button></div>}

    <ul className="post-list">{rows.map((post) => <li key={post.id}>
      <button type="button" className="panel post-card" onClick={() => setActive(post)}>
        <span className="post-card__top"><span className="post-card__tag">{CATEGORIES[post.category]}</span>{post.status !== 'approved' && <span>· {post.status}</span>}<span className="post-card__replies"><MessageCircle aria-hidden="true" /></span></span>
        <strong className="post-card__title">{post.title}</strong>
        <span className="post-card__excerpt">{post.body}</span>
        <span className="post-card__top">{post.display_name} · {new Date(post.created_at).toLocaleDateString()}</span>
      </button>
    </li>)}</ul>
    {(page > 0 || hasMore) && <div className="pagination"><button className="btn btn--ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button><span>Page {page + 1}</span><button className="btn btn--ghost" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</button></div>}

    <Modal open={authOpen} onClose={() => setAuthOpen(false)} title="Sign in to post" labelledBy="community-auth-title">
      {authStatus === 'sent'
        ? <p className="form-note" role="status">Check your email for the sign-in link.</p>
        : <form onSubmit={signIn}>
          <label className="field"><span>Email</span><input type="email" autoComplete="email" maxLength={254} required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn--primary btn--block" disabled={authStatus === 'sending'}>{authStatus === 'sending' ? 'Sending…' : 'Email me a sign-in link'}</button>
          <p className="form-footnote">No password. Your email stays private (<Link to="/privacy" target="_blank" rel="noopener noreferrer">privacy</Link>).</p>
        </form>}
    </Modal>
    <Modal open={Boolean(active) && !compose} onClose={() => setActive(null)} title={active?.title ?? 'Post'} labelledBy="discussion-title">
      {active && <>
        <p className="fine">{active.display_name} · {CATEGORIES[active.category]}</p>
        <p className="community-post-body">{active.body}</p>
        <h3 className="form-label">Replies</h3>
        {replyStatus === 'loading' && <p className="muted">Loading…</p>}
        {replyStatus === 'error' && <p role="alert">Replies could not load.</p>}
        {replyStatus === 'ready' && replies.length === 0 && <p className="muted">No replies yet.</p>}
        <ul className="replies">{replies.map((reply) => <li key={reply.id}><strong>{reply.display_name}</strong>{reply.status !== 'approved' && <small> · {reply.status}</small>}<p className="community-post-body">{reply.body}</p></li>)}</ul>
        <button className="btn btn--primary btn--block" disabled={active.status !== 'approved'} onClick={begin}>Reply</button>
      </>}
    </Modal>
    <Modal open={compose} onClose={() => setCompose(false)} title={active ? 'Reply' : 'New post'} labelledBy="compose-title"><Composer key={active?.id ?? 'new'} project={project} parent={active} onDone={done} /></Modal>
  </div>;
}
