import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Trophy, Vote, X } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { fetchPolls } from '../../lib/liveData.js';
import { formatCents, parseDollarsToCents } from '../../lib/money.js';
import { uploadImage } from '../../lib/adminMedia.js';

const blankOption = () => ({ key: crypto.randomUUID(), label: '', description: '', estimate: '', imageUrl: null });

function NewPoll({ project, onSaved }) {
  const [form, setForm] = useState({ question: '', description: '', closes: '' });
  const [options, setOptions] = useState([blankOption(), blankOption()]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const setOpt = (key, patch) => setOptions((list) => list.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  const upload = async (key, file) => {
    if (!file) return;
    try { setOpt(key, { imageUrl: await uploadImage(supabase, project.id, 'polls', file) }); } catch (err) { setMsg(err.message); }
  };
  const create = async (e) => {
    e.preventDefault();
    const filled = options.filter((o) => o.label.trim());
    if (filled.length < 2) return setMsg('Add at least two options.');
    const bad = filled.find((o) => o.estimate && !parseDollarsToCents(o.estimate));
    if (bad) return setMsg(`“${bad.label}”: the estimate must be an amount like 450.`);
    setBusy(true); setMsg(null);
    const { data: poll, error } = await supabase.from('polls').insert({
      project_id: project.id, question: form.question.trim(), description: form.description.trim() || null,
      closes_at: form.closes ? new Date(`${form.closes}T23:59:00`).toISOString() : null,
    }).select('id').single();
    if (error) { setBusy(false); return setMsg(error.message); }
    const { error: optErr } = await supabase.from('poll_options').insert(filled.map((o, i) => ({
      poll_id: poll.id, project_id: project.id, label: o.label.trim(), description: o.description.trim() || null,
      estimate_cents: o.estimate ? parseDollarsToCents(o.estimate) : null, image_url: o.imageUrl, sort_order: i,
    })));
    setBusy(false);
    if (optErr) { await supabase.from('polls').delete().eq('id', poll.id); return setMsg(optErr.message); }
    setForm({ question: '', description: '', closes: '' });
    setOptions([blankOption(), blankOption()]);
    setMsg('Vote published on the Community page.');
    onSaved();
  };
  return (
    <form onSubmit={create} className="admin-poll-new">
      <div className="form-grid">
        <label className="field"><span>Question</span><input required minLength={3} maxLength={200} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="Which wheels should come next?" /></label>
        <label className="field"><span>Closes (optional)</span><input type="date" value={form.closes} onChange={(e) => setForm({ ...form, closes: e.target.value })} /></label>
      </div>
      <label className="field"><span>Details (optional)</span><textarea rows={2} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      <ol className="admin-poll-options">
        {options.map((o, i) => (
          <li key={o.key} className="form-grid">
            <label className="field"><span>Option {i + 1}</span><input maxLength={80} value={o.label} onChange={(e) => setOpt(o.key, { label: e.target.value })} /></label>
            <label className="field"><span>Estimate ({(project.currency ?? 'usd').toUpperCase()}, needed to become a part)</span><input inputMode="decimal" value={o.estimate} onChange={(e) => setOpt(o.key, { estimate: e.target.value })} /></label>
            <label className="field"><span>Short note</span><input maxLength={500} value={o.description} onChange={(e) => setOpt(o.key, { description: e.target.value })} /></label>
            <label className="field"><span>Photo {o.imageUrl ? '✓' : ''}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => upload(o.key, e.target.files[0])} /></label>
            {options.length > 2 && <button type="button" className="icon-btn" aria-label={`Remove option ${i + 1}`} onClick={() => setOptions((l) => l.filter((x) => x.key !== o.key))}><X aria-hidden="true" /></button>}
          </li>
        ))}
      </ol>
      <div className="dialog-actions">
        <button type="button" className="btn btn--ghost btn--sm" disabled={options.length >= 8} onClick={() => setOptions((l) => [...l, blankOption()])}><Plus aria-hidden="true" /> Option</button>
        <span className="fine" role="status">{msg}</span>
        <button className="btn btn--primary" disabled={busy}><Vote aria-hidden="true" /> Publish vote</button>
      </div>
    </form>
  );
}

function PollRow({ poll, currency, onSaved }) {
  const leader = [...poll.options].sort((a, b) => b.votes - a.votes)[0];
  const [winner, setWinner] = useState(leader?.id ?? '');
  const [createPart, setCreatePart] = useState(true);
  const [msg, setMsg] = useState(null);
  const close = async () => {
    const { data, error } = await supabase.rpc('close_poll', { p_poll_id: poll.id, p_winner_option_id: winner || null, p_create_part: createPart });
    if (error) return setMsg(error.message.includes('estimate_required') ? 'Give the winning option an estimate first (edit it in Supabase, or recreate the vote).' : error.message);
    setMsg(data ? `Closed. New part card: /parts/${data}` : 'Closed.');
    onSaved();
  };
  const remove = async () => {
    if (!window.confirm(`Delete the vote “${poll.question}” and its results?`)) return;
    const { error } = await supabase.from('polls').delete().eq('id', poll.id);
    if (error) return setMsg(error.message);
    onSaved();
  };
  return (
    <li className="panel admin-poll">
      <strong>{poll.question}</strong> <span className="fine">· {poll.status} · {poll.totalVotes} votes</span>
      <ul>
        {poll.options.map((o) => (
          <li key={o.id}>{poll.winnerOptionId === o.id && <Trophy aria-label="Winner" />} {o.label} — {o.votes} vote{o.votes === 1 ? '' : 's'}{o.estimateCents ? ` · ${formatCents(o.estimateCents, currency)}` : ''}</li>
        ))}
      </ul>
      {poll.status === 'open' && (
        <div className="form-grid">
          <label className="field"><span>Winner</span>
            <select value={winner} onChange={(e) => setWinner(e.target.value)}>
              <option value="">No winner</option>
              {poll.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={createPart} onChange={(e) => setCreatePart(e.target.checked)} /> <span>Turn the winner into an open part card</span></label>
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={remove}><Trash2 aria-hidden="true" /> Delete</button>
        <span className="fine" role="status">{msg}</span>
        {poll.status === 'open' && <button type="button" className="btn btn--primary btn--sm" onClick={close}>Close vote</button>}
      </div>
    </li>
  );
}

/** Owner: create supporter votes, close them, and turn the winner into a part card. */
export default function PollsAdmin({ project, onPartsChanged }) {
  const [polls, setPolls] = useState([]);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try { setPolls(await fetchPolls(project.slug, project.id)); setError(null); }
    catch (err) { setError(err.message); }
  }, [project.slug, project.id]);
  useEffect(() => { load(); }, [load]);
  const saved = () => { load(); onPartsChanged?.(); };
  return (
    <section className="panel admin-section" aria-labelledby="admin-polls-title">
      <h2 id="admin-polls-title">Supporter votes</h2>
      <p className="fine">Ask supporters to choose between options (one vote per signed-in email). Close the vote to turn the winner into an open upgrade card.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <ul className="admin-polls">{polls.map((p) => <PollRow key={p.id} poll={p} currency={project.currency ?? 'usd'} onSaved={saved} />)}</ul>
      <h3>New vote</h3>
      <NewPoll project={project} onSaved={saved} />
    </section>
  );
}
