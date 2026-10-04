import { useEffect, useState } from 'react';
import { LogOut, Plus, Save, Trash2, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { useProjectData } from '../hooks/useProjectData.jsx';
import { formatCents, parseDollarsToCents } from '../lib/money.js';

// Owner controls. The UI hides itself for non-owners, but the real enforcement is
// Postgres RLS (project_admins membership) — see supabase/migrations.

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setMsg(error.message);
  };
  return (
    <form className="panel admin-signin" onSubmit={submit}>
      <h2>Owner sign in</h2>
      <p className="fine">Supporters don’t need an account. This area is for the project owner only.</p>
      <label className="field"><span>Email</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {msg && <p className="form-error" role="alert">{msg}</p>}
      <button className="btn btn--primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

function useSession() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

function CampaignEditor({ project, onSaved }) {
  const [form, setForm] = useState({
    title: project.title ?? '',
    tagline: project.tagline ?? '',
    vehicle_display_name: project.vehicleDisplayName ?? '',
    goal: project.goalCents != null ? (project.goalCents / 100).toFixed(2) : '',
    description: project.description ?? '',
  });
  const [msg, setMsg] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    const goal_cents = parseDollarsToCents(form.goal);
    if (goal_cents == null || goal_cents <= 0) return setMsg('Enter a valid goal.');
    const { error } = await supabase
      .from('projects')
      .update({ title: form.title, tagline: form.tagline, vehicle_display_name: form.vehicle_display_name, goal_cents, description: form.description })
      .eq('id', project.id);
    setMsg(error ? error.message : 'Saved.');
    if (!error) onSaved();
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form className="panel admin-section" onSubmit={save}>
      <h2>Campaign copy</h2>
      <div className="form-grid">
        <label className="field"><span>Title</span><input value={form.title} onChange={set('title')} required /></label>
        <label className="field"><span>Tagline</span><input value={form.tagline} onChange={set('tagline')} /></label>
        <label className="field"><span>Vehicle display name</span><input value={form.vehicle_display_name} onChange={set('vehicle_display_name')} /></label>
        <label className="field"><span>Goal (USD)</span><input inputMode="decimal" value={form.goal} onChange={set('goal')} required /></label>
      </div>
      <label className="field"><span>Description</span><textarea rows={3} value={form.description} onChange={set('description')} /></label>
      <div className="dialog-actions"><span className="fine" role="status">{msg}</span><button className="btn btn--primary"><Save aria-hidden="true" /> Save</button></div>
    </form>
  );
}

function PartRow({ part, onSaved }) {
  const [p, setP] = useState({ ...part, estimate: (part.estimateCents / 100).toFixed(2) });
  const [msg, setMsg] = useState(null);
  const save = async () => {
    const estimate_cents = parseDollarsToCents(p.estimate);
    if (estimate_cents == null) return setMsg('Bad amount');
    const { error } = await supabase
      .from('parts')
      .update({ name: p.name, estimate_cents, status: p.status, condition: p.condition, description: p.description, sort_order: Number(p.sortOrder) || 0 })
      .eq('id', part.dbId);
    setMsg(error ? error.message : 'Saved');
    if (!error) onSaved();
  };
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));
  return (
    <tr>
      <td><input aria-label="Name" value={p.name} onChange={set('name')} /></td>
      <td><input aria-label="Estimate (USD)" inputMode="decimal" value={p.estimate} onChange={set('estimate')} size={8} /></td>
      <td>
        <select aria-label="Status" value={p.status} onChange={set('status')}>
          <option value="needed">Needed</option>
          <option value="upgrade">Upgrade</option>
          <option value="bought">Bought</option>
        </select>
      </td>
      <td><input aria-label="Condition" value={p.condition ?? ''} onChange={set('condition')} /></td>
      <td><input aria-label="Sort order" value={p.sortOrder} onChange={set('sortOrder')} size={3} /></td>
      <td><button type="button" className="btn btn--ghost btn--sm" onClick={save}><Save aria-hidden="true" /> Save</button> <span className="fine" role="status">{msg}</span></td>
    </tr>
  );
}

function NewPart({ projectId, onSaved }) {
  const [p, setP] = useState({ slug: '', name: '', estimate: '', status: 'needed', condition: '' });
  const [msg, setMsg] = useState(null);
  const add = async (e) => {
    e.preventDefault();
    const estimate_cents = parseDollarsToCents(p.estimate);
    if (estimate_cents == null) return setMsg('Enter a valid estimate.');
    const { error } = await supabase.from('parts').insert({ project_id: projectId, slug: p.slug, name: p.name, estimate_cents, status: p.status, condition: p.condition, sort_order: 100 });
    setMsg(error ? error.message : 'Added.');
    if (!error) {
      setP({ slug: '', name: '', estimate: '', status: 'needed', condition: '' });
      onSaved();
    }
  };
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="form-grid form-grid--inline" onSubmit={add}>
      <label className="field"><span>Slug (matches hotspot partId)</span><input value={p.slug} onChange={set('slug')} pattern="[a-z0-9-]+" required /></label>
      <label className="field"><span>Name</span><input value={p.name} onChange={set('name')} required /></label>
      <label className="field"><span>Estimate (USD)</span><input inputMode="decimal" value={p.estimate} onChange={set('estimate')} required /></label>
      <label className="field"><span>Status</span><select value={p.status} onChange={set('status')}><option value="needed">Needed</option><option value="upgrade">Upgrade</option><option value="bought">Bought</option></select></label>
      <label className="field"><span>Condition</span><input value={p.condition} onChange={set('condition')} /></label>
      <button className="btn btn--ghost"><Plus aria-hidden="true" /> Add part</button>
      <span className="fine" role="status">{msg}</span>
    </form>
  );
}

function UpdatesEditor({ projectId, userId }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ title: '', body: '', cost: '', publish: true });
  const [files, setFiles] = useState([]);
  const [msg, setMsg] = useState(null);
  const load = async () => {
    const { data } = await supabase.from('restoration_updates').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
    setRows(data ?? []);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const create = async (e) => {
    e.preventDefault();
    setMsg('Saving…');
    const image_urls = [];
    for (const f of files) {
      const path = `${projectId}/updates/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]/g, '_')}`;
      const { error } = await supabase.storage.from('project-media').upload(path, f, { contentType: f.type });
      if (error) return setMsg(`Upload failed: ${error.message}`);
      image_urls.push(supabase.storage.from('project-media').getPublicUrl(path).data.publicUrl);
    }
    const cost_cents = form.cost ? parseDollarsToCents(form.cost) : null;
    const { error } = await supabase.from('restoration_updates').insert({
      project_id: projectId, title: form.title, body: form.body, image_urls, cost_cents, created_by: userId,
      published_at: form.publish ? new Date().toISOString() : null,
    });
    setMsg(error ? error.message : 'Update saved.');
    if (!error) {
      setForm({ title: '', body: '', cost: '', publish: true });
      setFiles([]);
      load();
    }
  };
  const togglePublish = async (u) => {
    await supabase.from('restoration_updates').update({ published_at: u.published_at ? null : new Date().toISOString() }).eq('id', u.id);
    load();
  };
  const remove = async (u) => {
    if (!window.confirm(`Delete “${u.title}”?`)) return;
    await supabase.from('restoration_updates').delete().eq('id', u.id);
    load();
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <section className="panel admin-section">
      <h2>Restoration updates</h2>
      <form onSubmit={create}>
        <label className="field"><span>Title</span><input value={form.title} onChange={set('title')} required /></label>
        <label className="field"><span>Body</span><textarea rows={3} value={form.body} onChange={set('body')} required /></label>
        <div className="form-grid">
          <label className="field"><span>Cost (USD, optional)</span><input inputMode="decimal" value={form.cost} onChange={set('cost')} /></label>
          <label className="field"><span><Upload aria-hidden="true" /> Photos</span><input type="file" accept="image/*" multiple onChange={(e) => setFiles([...e.target.files])} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={form.publish} onChange={set('publish')} /> <span>Publish now</span></label>
        <div className="dialog-actions"><span className="fine" role="status">{msg}</span><button className="btn btn--primary"><Plus aria-hidden="true" /> Add update</button></div>
      </form>
      <ul className="admin-updates">
        {rows.map((u) => (
          <li key={u.id}>
            <strong>{u.title}</strong> <span className="muted">{u.published_at ? `published ${new Date(u.published_at).toLocaleDateString()}` : 'draft'}</span>
            <span className="admin-updates__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => togglePublish(u)}>{u.published_at ? 'Unpublish' : 'Publish'}</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => remove(u)} aria-label={`Delete ${u.title}`}><Trash2 aria-hidden="true" /></button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Admin() {
  const { project, parts, isDemo, reload, status } = useProjectData();
  const session = useSession();
  const [isOwner, setIsOwner] = useState(null);

  useEffect(() => {
    if (!supabase || !session || !project.id) return;
    supabase.rpc('is_project_admin', { p_project_id: project.id }).then(({ data, error }) => setIsOwner(!error && data === true));
  }, [session, project.id]);

  if (!supabase) {
    return (
      <div className="page page--narrow">
        <h1>Owner admin</h1>
        <div className="panel">
          <p>Admin needs Supabase. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>, then provision an owner (see README → “Owner provisioning”).</p>
          {isDemo && <p className="fine">The site is in demo mode, so parts and campaign values come from local fixtures and can’t be edited here.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div><p className="kicker">Owner</p><h1>Admin</h1></div>
        {session && (
          <button type="button" className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>
            <LogOut aria-hidden="true" /> Sign out
          </button>
        )}
      </header>
      {session === undefined ? (
        <p className="muted">Checking session…</p>
      ) : !session ? (
        <SignIn />
      ) : isDemo ? (
        <p className="panel">Signed in. Switch <code>VITE_DEMO_MODE=false</code> to edit live data.</p>
      ) : status !== 'ready' ? (
        <p className="muted">Loading project…</p>
      ) : isOwner === null ? (
        <p className="muted">Checking permissions…</p>
      ) : !isOwner ? (
        <p className="panel">This account isn’t an owner of this project.</p>
      ) : (
        <>
          <CampaignEditor project={project} onSaved={reload} />
          <section className="panel admin-section">
            <h2>Parts &amp; purchase status</h2>
            <p className="fine">Mark a part “Bought” only after you’ve actually bought it. Donations never change status automatically.</p>
            <div className="table-wrap">
              <table className="admin-table">
                <thead><tr><th>Name</th><th>Estimate</th><th>Status</th><th>Condition</th><th>Order</th><th /></tr></thead>
                <tbody>{parts.map((p) => <PartRow key={p.dbId} part={p} onSaved={reload} />)}</tbody>
              </table>
            </div>
            <h3>Add part</h3>
            <NewPart projectId={project.id} onSaved={reload} />
            <p className="fine">Totals: {formatCents(parts.reduce((s, p) => s + p.estimateCents, 0))} estimated across {parts.length} parts.</p>
          </section>
          <UpdatesEditor projectId={project.id} userId={session.user.id} />
        </>
      )}
    </div>
  );
}
