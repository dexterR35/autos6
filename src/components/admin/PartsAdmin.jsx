import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Box, Copy, ImagePlus, PackageCheck, Plus, Save, Target, Trash2, Upload, X } from 'lucide-react';
import { parsePartsCsv } from '../../lib/partsCsv.js';
import { supabase } from '../../lib/supabase.js';
import { formatCents, parseDollarsToCents } from '../../lib/money.js';
import { isOpen, partKind, remainingCents, STATUS_LABELS } from '../../lib/parts.js';
import { GALLERY_MAX, imageProblem, modelProblem, uploadImage, uploadModel } from '../../lib/adminMedia.js';
import { safeMediaUrl } from '../../lib/safeMedia.js';
import PartThumb from '../PartThumb.jsx';
import StatusChip from '../StatusChip.jsx';
import FundMeter from '../FundMeter.jsx';

const SLUG_RE = /^[a-z0-9-]{1,60}$/;
const slugify = (name) => name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);
const toInput = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));
// Database status for "open for funding" depends on the part's kind.
const openStatus = (kind) => (kind === 'upgrade' ? 'upgrade' : 'needed');
const stageOf = (status) => (status === 'needed' || status === 'upgrade' ? 'open' : status);

// ---------------------------------------------------------------- one image (before / after / receipt)
function ImageField({ label, value, onChange, projectId, folder, disabled }) {
  const [msg, setMsg] = useState(null);
  const pick = async (file) => {
    if (!file) return;
    setMsg('Uploading…');
    try { onChange(await uploadImage(supabase, projectId, folder, file)); setMsg('Uploaded — save to publish.'); }
    catch (err) { setMsg(err.message); }
  };
  return (
    <div className="image-field">
      <span className="image-field__label">{label}</span>
      {value && safeMediaUrl(value) && <img src={safeMediaUrl(value)} alt="" />}
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} aria-label={`${label}: choose image`} onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
      {value && <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(null)}><X aria-hidden="true" /> Remove</button>}
      {msg && <span className="fine" role="status">{msg}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- media fields
function MediaFields({ projectId, slug, value, onChange, busy }) {
  const [msg, setMsg] = useState(null);
  const [working, setWorking] = useState(false);
  const run = async (fn) => {
    setWorking(true); setMsg(null);
    try { await fn(); } catch (err) { setMsg(err.message); } finally { setWorking(false); }
  };
  const addImages = (files) => run(async () => {
    const list = [...files];
    const problem = list.map(imageProblem).find(Boolean);
    if (problem) throw new Error(problem);
    if (value.imageUrls.length + list.length > GALLERY_MAX) throw new Error(`A part can have up to ${GALLERY_MAX} photos.`);
    const urls = [];
    for (const f of list) urls.push(await uploadImage(supabase, projectId, `parts/${slug}`, f));
    const imageUrls = [...value.imageUrls, ...urls];
    onChange({ imageUrls, thumbnailUrl: value.thumbnailUrl || imageUrls[0] || null });
    setMsg(`${urls.length} photo${urls.length === 1 ? '' : 's'} uploaded — save to publish.`);
  });
  const setModel = (file) => run(async () => {
    const problem = modelProblem(file);
    if (problem) throw new Error(problem);
    onChange({ modelUrl: await uploadModel(supabase, projectId, slug, file) });
    setMsg('3D model uploaded — save to publish.');
  });
  const remove = (url) => {
    const imageUrls = value.imageUrls.filter((u) => u !== url);
    onChange({ imageUrls, thumbnailUrl: value.thumbnailUrl === url ? imageUrls[0] ?? null : value.thumbnailUrl });
  };
  const disabled = busy || working || !SLUG_RE.test(slug);

  return (
    <fieldset className="admin-media" disabled={disabled}>
      <legend>Photos &amp; 3D</legend>
      {!SLUG_RE.test(slug) && <p className="fine">Enter a valid slug first; files are stored under it.</p>}
      <ul className="admin-media__grid">
        {value.imageUrls.map((url) => (
          <li key={url} className={value.thumbnailUrl === url ? 'is-cover' : ''}>
            {safeMediaUrl(url) && <img src={safeMediaUrl(url)} alt="" />}
            <span className="admin-media__actions">
              <button type="button" className="btn btn--ghost btn--sm" aria-pressed={value.thumbnailUrl === url} onClick={() => onChange({ thumbnailUrl: url })}>{value.thumbnailUrl === url ? 'Cover' : 'Make cover'}</button>
              <button type="button" className="icon-btn" aria-label="Remove photo" onClick={() => remove(url)}><X aria-hidden="true" /></button>
            </span>
          </li>
        ))}
      </ul>
      <div className="form-grid">
        <label className="field"><span><ImagePlus aria-hidden="true" /> Add photos (JPG, PNG, WebP · 5 MB each)</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => { addImages(e.target.files); e.target.value = ''; }} />
        </label>
        <label className="field"><span><Box aria-hidden="true" /> 3D model (.glb · 25 MB)</span>
          <input type="file" accept=".glb,model/gltf-binary" onChange={(e) => { setModel(e.target.files[0]); e.target.value = ''; }} />
        </label>
      </div>
      <label className="field"><span>3D model URL (or upload above)</span>
        <input value={value.modelUrl ?? ''} placeholder="https://…/part.glb" onChange={(e) => onChange({ modelUrl: e.target.value || null })} />
      </label>
      {value.modelUrl && <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ modelUrl: null })}><Trash2 aria-hidden="true" /> Remove 3D model</button>}
      <p className="fine" role="status">{working ? 'Uploading…' : msg}</p>
    </fieldset>
  );
}

// ---------------------------------------------------------------- record purchase
function RecordProgress({ part, projectId, onSaved }) {
  const next = { needed: 'bought', upgrade: 'bought', funded: 'ordered', ordered: 'bought', bought: 'installed' }[part.status] ?? 'bought';
  const titleFor = (stage) => `${STATUS_LABELS[stage]}: ${part.name}`;
  const [form, setForm] = useState({ stage: next, cost: toInput(part.actualCostCents), title: titleFor(next), body: '', publish: true, post: true });
  const [files, setFiles] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v, ...(k === 'stage' && f.title === titleFor(f.stage) ? { title: titleFor(v) } : {}) }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const costInput = form.cost.trim();
    const cost = costInput ? parseDollarsToCents(costInput) : null;
    if (costInput && cost == null) return setMsg('Enter the price as an amount like 612.50, or leave it empty.');
    if (form.post && !form.title.trim()) return setMsg('Give the update a title, or untick “Post an update”.');
    const problem = files.map(imageProblem).find(Boolean);
    if (problem) return setMsg(problem);
    if (files.length > 10) return setMsg('Choose up to 10 photos.');
    setBusy(true); setMsg('Saving…');
    try {
      const urls = [];
      if (form.post) for (const f of files) urls.push(await uploadImage(supabase, projectId, 'updates', f));
      const { error } = await supabase.rpc('record_part_progress', {
        p_part_id: part.dbId,
        p_status: form.stage,
        p_actual_cost_cents: cost,
        p_title: form.post ? form.title.trim() : null,
        p_body: form.post ? form.body : null,
        p_image_urls: urls,
        p_publish: form.publish,
      });
      if (error) throw new Error(error.message);
      setMsg(`${part.name} marked ${STATUS_LABELS[form.stage].toLowerCase()}.`);
      setFiles([]);
      onSaved();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="admin-record" onSubmit={submit}>
      <h4><PackageCheck aria-hidden="true" /> Record purchase / progress</h4>
      <div className="form-grid">
        <label className="field"><span>New stage</span>
          <select value={form.stage} onChange={set('stage')}>
            <option value="ordered">Ordered</option>
            <option value="bought">Bought</option>
            <option value="installed">Installed</option>
          </select>
        </label>
        <label className="field"><span>What you paid ({(part.currency ?? 'usd').toUpperCase()}, optional)</span><input inputMode="decimal" value={form.cost} onChange={set('cost')} placeholder="e.g. 612.50" /></label>
      </div>
      <label className="check"><input type="checkbox" checked={form.post} onChange={set('post')} /> <span>Post an update on the Progress page</span></label>
      {form.post && (
        <>
          <label className="field"><span>Update title</span><input value={form.title} onChange={set('title')} maxLength={140} /></label>
          <label className="field"><span>Update text</span><textarea rows={3} maxLength={10000} value={form.body} onChange={set('body')} placeholder="Where you bought it, receipt total, what happens next…" /></label>
          <label className="field"><span>Photos (receipt, box, fitted part)</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles([...e.target.files])} /></label>
          <label className="check"><input type="checkbox" checked={form.publish} onChange={set('publish')} /> <span>Publish now (supporters following this part are emailed)</span></label>
        </>
      )}
      <div className="dialog-actions">
        <span className="fine" role="status">{msg}</span>
        <button className="btn btn--primary" disabled={busy}><PackageCheck aria-hidden="true" /> Save progress</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- one part
function PartEditor({ part, projectId, currency, onSaved, onMove, onDuplicate, isFirst, isLast }) {
  const initial = () => ({
    name: part.name, goal: toInput(part.estimateCents), kind: partKind(part), stage: stageOf(part.status),
    condition: part.condition ?? '', priority: part.priority ?? 'standard', description: part.description ?? '',
    sortOrder: String(part.sortOrder ?? 0), imageUrls: part.imageUrls ?? [], thumbnailUrl: part.thumbnailUrl ?? null, modelUrl: part.modelUrl ?? null,
    isNextUp: Boolean(part.isNextUp), carPlacement: part.carPlacement ?? 'fit',
    beforeImageUrl: part.beforeImageUrl ?? null, afterImageUrl: part.afterImageUrl ?? null, receiptUrl: part.receiptUrl ?? null,
  });
  const [p, setP] = useState(initial);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  // Reset the form only when the saved values change (not on the 60 s background refresh).
  const saved = JSON.stringify([part.name, part.estimateCents, part.status, part.kind, part.condition, part.priority, part.description, part.sortOrder, part.imageUrls, part.thumbnailUrl, part.modelUrl, part.isNextUp, part.carPlacement, part.beforeImageUrl, part.afterImageUrl, part.receiptUrl]);
  useEffect(() => { setP(initial()); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));
  const raised = Number.isFinite(part.raisedCents) ? part.raisedCents : 0;
  const left = remainingCents(part);

  const save = async (e) => {
    e?.preventDefault();
    const estimate_cents = parseDollarsToCents(p.goal);
    if (estimate_cents == null || estimate_cents <= 0) return setMsg('Enter a positive goal.');
    if (p.modelUrl && !safeMediaUrl(p.modelUrl)) return setMsg('The 3D model URL must start with https://');
    setBusy(true);
    const { error } = await supabase.from('parts').update({
      name: p.name.trim(), estimate_cents, kind: p.kind,
      status: p.stage === 'open' ? openStatus(p.kind) : p.stage,
      condition: p.condition || null, priority: p.priority, description: p.description || null,
      image_urls: p.imageUrls, thumbnail_url: p.thumbnailUrl, model_url: p.modelUrl || null,
      is_next_up: p.isNextUp && p.stage === 'open', car_placement: p.carPlacement,
      before_image_url: p.beforeImageUrl, after_image_url: p.afterImageUrl, receipt_url: p.receiptUrl,
    }).eq('id', part.dbId);
    setBusy(false);
    setMsg(error ? (error.message.includes('next_up_limit') ? 'Only three parts can be “next up” at once. Untick another one first.' : error.message) : 'Saved.');
    if (!error) onSaved();
  };

  const remove = async () => {
    if (raised > 0) return setMsg('This part has received money, so it can’t be deleted. Mark it bought or change its goal instead.');
    if (!window.confirm(`Delete “${part.name}”? This can’t be undone.`)) return;
    const { error } = await supabase.from('parts').delete().eq('id', part.dbId);
    setMsg(error ? error.message : 'Deleted.');
    if (!error) onSaved();
  };

  return (
    <li className="admin-part panel">
      <details>
        <summary>
          <PartThumb part={part} size="sm" />
          <span className="admin-part__name">{part.name}<small>/{part.id}</small></span>
          <StatusChip status={part.status} size="sm" />
          <span className="admin-part__money">{part.isNextUp && <Target aria-label="Next up" className="admin-part__next" />}{formatCents(raised, currency)} / {formatCents(part.estimateCents, currency)}</span>
          <span className="admin-part__move">
            <button type="button" className="icon-btn" aria-label={`Move ${part.name} up`} disabled={isFirst} onClick={(e) => { e.preventDefault(); onMove(-1); }}><ArrowUp aria-hidden="true" /></button>
            <button type="button" className="icon-btn" aria-label={`Move ${part.name} down`} disabled={isLast} onClick={(e) => { e.preventDefault(); onMove(1); }}><ArrowDown aria-hidden="true" /></button>
          </span>
        </summary>

        <FundMeter label={part.name} raisedCents={part.raisedCents} goalCents={part.estimateCents} currency={currency} />
        <p className="fine">
          {isOpen(part) ? (left > 0 ? `${formatCents(left, currency)} to go. It becomes “Funded” automatically at the goal.` : 'Goal reached.') : `Closed to new part contributions (${STATUS_LABELS[part.status]}).`}
          {Number.isFinite(part.supporterCount) && ` ${part.supporterCount} contribution${part.supporterCount === 1 ? '' : 's'}.`}
        </p>

        <form onSubmit={save}>
          <div className="form-grid">
            <label className="field"><span>Name</span><input value={p.name} onChange={set('name')} maxLength={80} required /></label>
            <label className="field"><span>Goal ({currency.toUpperCase()})</span><input inputMode="decimal" value={p.goal} onChange={set('goal')} required /></label>
            <label className="field"><span>Type</span>
              <select value={p.kind} onChange={set('kind')}><option value="repair">Repair / needed</option><option value="upgrade">Upgrade</option></select>
            </label>
            <label className="field"><span>Stage</span>
              <select value={p.stage} onChange={set('stage')}>
                <option value="open">Open for funding</option>
                {part.status === 'funded' && <option value="funded">Funded (automatic)</option>}
                <option value="ordered">Ordered</option>
                <option value="bought">Bought</option>
                <option value="installed">Installed</option>
              </select>
            </label>
            <label className="field"><span>Condition</span><input value={p.condition} onChange={set('condition')} maxLength={80} /></label>
            <label className="field"><span>Priority</span><select value={p.priority} onChange={set('priority')}><option value="standard">Standard</option><option value="important">Important</option></select></label>
            <label className="field"><span>Show on 3D car when installed</span>
              <select value={p.carPlacement} onChange={set('carPlacement')}>
                <option value="fit">Fit into the original part</option>
                <option value="car">Exported in car coordinates</option>
                <option value="off">Don’t show on the car</option>
              </select>
            </label>
          </div>
          <label className="check"><input type="checkbox" checked={p.isNextUp} disabled={p.stage !== 'open'} onChange={(e) => setP((x) => ({ ...x, isNextUp: e.target.checked }))} /> <span>Next up — show at the top of the Parts page (max 3, open parts only)</span></label>
          <label className="field"><span>Description</span><textarea rows={3} maxLength={2000} value={p.description} onChange={set('description')} /></label>
          <MediaFields projectId={projectId} slug={part.id} value={p} busy={busy} onChange={(patch) => setP((x) => ({ ...x, ...patch }))} />
          <fieldset className="admin-media">
            <legend>Before / after &amp; receipt</legend>
            <div className="image-fields">
              <ImageField label="Before photo" value={p.beforeImageUrl} projectId={projectId} folder={`parts/${part.id}`} disabled={busy} onChange={(v) => setP((x) => ({ ...x, beforeImageUrl: v }))} />
              <ImageField label="After photo" value={p.afterImageUrl} projectId={projectId} folder={`parts/${part.id}`} disabled={busy} onChange={(v) => setP((x) => ({ ...x, afterImageUrl: v }))} />
              <ImageField label="Receipt (public — hide personal details first)" value={p.receiptUrl} projectId={projectId} folder={`parts/${part.id}/receipts`} disabled={busy} onChange={(v) => setP((x) => ({ ...x, receiptUrl: v }))} />
            </div>
          </fieldset>
          <div className="dialog-actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={remove}><Trash2 aria-hidden="true" /> Delete</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onDuplicate}><Copy aria-hidden="true" /> Duplicate</button>
            <span className="fine" role="status">{msg}</span>
            <button className="btn btn--primary" disabled={busy}><Save aria-hidden="true" /> Save part</button>
          </div>
        </form>

        <RecordProgress key={part.status} part={part} projectId={projectId} onSaved={onSaved} />
      </details>
    </li>
  );
}

// ---------------------------------------------------------------- new part
function NewPart({ projectId, nextOrder, onSaved, currency = 'usd' }) {
  const blank = { slug: '', name: '', goal: '', kind: 'upgrade', condition: '', priority: 'standard', description: '', imageUrls: [], thumbnailUrl: null, modelUrl: null };
  const [p, setP] = useState(blank);
  const [slugEdited, setSlugEdited] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => {
    const v = e.target.value;
    setP((x) => ({ ...x, [k]: v, ...(k === 'name' && !slugEdited ? { slug: slugify(v) } : {}) }));
    if (k === 'slug') setSlugEdited(true);
  };
  const add = async (e) => {
    e.preventDefault();
    const estimate_cents = parseDollarsToCents(p.goal);
    if (!SLUG_RE.test(p.slug)) return setMsg('Slug: lowercase letters, numbers and dashes only.');
    if (estimate_cents == null || estimate_cents <= 0) return setMsg('Enter a positive goal.');
    if (p.modelUrl && !safeMediaUrl(p.modelUrl)) return setMsg('The 3D model URL must start with https://');
    setBusy(true);
    const { error } = await supabase.from('parts').insert({
      project_id: projectId, slug: p.slug, name: p.name.trim(), estimate_cents, kind: p.kind, status: openStatus(p.kind),
      condition: p.condition || null, priority: p.priority, description: p.description || null, sort_order: nextOrder,
      image_urls: p.imageUrls, thumbnail_url: p.thumbnailUrl, model_url: p.modelUrl || null,
    });
    setBusy(false);
    if (error) return setMsg(error.code === '23505' ? 'A part with this slug already exists.' : error.message);
    setMsg(`Added ${p.name}.`);
    setP(blank); setSlugEdited(false);
    onSaved();
  };
  return (
    <form className="admin-new-part" onSubmit={add}>
      <div className="form-grid">
        <label className="field"><span>Name</span><input value={p.name} onChange={set('name')} maxLength={80} required placeholder="e.g. RS6 front grille" /></label>
        <label className="field"><span>Slug (URL and hotspot id)</span><input value={p.slug} onChange={set('slug')} pattern="[a-z0-9-]+" maxLength={60} required /></label>
        <label className="field"><span>Goal ({currency.toUpperCase()})</span><input inputMode="decimal" value={p.goal} onChange={set('goal')} required placeholder="e.g. 450" /></label>
        <label className="field"><span>Type</span><select value={p.kind} onChange={set('kind')}><option value="upgrade">Upgrade</option><option value="repair">Repair / needed</option></select></label>
        <label className="field"><span>Condition</span><input value={p.condition} onChange={set('condition')} maxLength={80} placeholder="e.g. Optional upgrade" /></label>
        <label className="field"><span>Priority</span><select value={p.priority} onChange={set('priority')}><option value="standard">Standard</option><option value="important">Important</option></select></label>
      </div>
      <label className="field"><span>Description</span><textarea rows={2} maxLength={2000} value={p.description} onChange={set('description')} /></label>
      <MediaFields projectId={projectId} slug={p.slug} value={p} busy={busy} onChange={(patch) => setP((x) => ({ ...x, ...patch }))} />
      <div className="dialog-actions">
        <span className="fine" role="status">{msg}</span>
        <button className="btn btn--primary" disabled={busy}><Plus aria-hidden="true" /> Add part</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- CSV import
function CsvImport({ projectId, existing, nextOrder, onSaved, currency }) {
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const read = async (file) => {
    setMsg(null);
    if (!file) return;
    if (file.size > 200_000) return setMsg('That file is too large for a parts list (200 KB max).');
    setPreview(parsePartsCsv(await file.text(), { existingSlugs: existing }));
  };
  const importRows = async () => {
    if (!preview?.rows.length) return;
    setBusy(true);
    const { error } = await supabase.from('parts').insert(preview.rows.map((r, i) => ({
      project_id: projectId, slug: r.slug, name: r.name, estimate_cents: r.goalCents, kind: r.kind,
      status: r.kind === 'upgrade' ? 'upgrade' : 'needed', priority: r.priority, condition: r.condition, description: r.description,
      sort_order: nextOrder + i,
    })));
    setBusy(false);
    if (error) return setMsg(error.code === '23505' ? 'One of the slugs already exists. Nothing was imported.' : error.message);
    setMsg(`Imported ${preview.rows.length} part${preview.rows.length === 1 ? '' : 's'}.`);
    setPreview(null);
    onSaved();
  };
  return (
    <details className="admin-csv">
      <summary><Upload aria-hidden="true" /> Import parts from a CSV file</summary>
      <p className="fine">Columns (header row required): <code>name,goal,type,priority,condition,description</code>. <code>type</code> is <code>upgrade</code> or <code>repair</code>; <code>priority</code> is <code>important</code> or <code>standard</code>; goal in {currency.toUpperCase()} like <code>450</code> or <code>612.50</code>. Export from Excel or Google Sheets as CSV.</p>
      <input type="file" accept=".csv,text/csv" aria-label="Choose CSV file" onChange={(e) => { read(e.target.files[0]); e.target.value = ''; }} />
      {preview && (
        <>
          {preview.errors.length > 0 && <ul className="form-error">{preview.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          {preview.rows.length > 0 && (
            <div className="table-wrap"><table className="admin-table">
              <thead><tr><th>Name</th><th>Slug</th><th>Goal</th><th>Type</th><th>Priority</th></tr></thead>
              <tbody>{preview.rows.map((r) => <tr key={r.slug}><td>{r.name}</td><td>{r.slug}</td><td>{formatCents(r.goalCents, currency)}</td><td>{r.kind}</td><td>{r.priority}</td></tr>)}</tbody>
            </table></div>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setPreview(null)}>Cancel</button>
            <button type="button" className="btn btn--primary" disabled={busy || !preview.rows.length || preview.errors.length > 0} onClick={importRows}>Import {preview.rows.length} part{preview.rows.length === 1 ? '' : 's'}</button>
          </div>
        </>
      )}
      {msg && <p className="fine" role="status">{msg}</p>}
    </details>
  );
}

/** Owner view of every part card: goals, media, lifecycle and purchase records. */
export default function PartsAdmin({ project, parts, onSaved }) {
  const currency = project.currency ?? 'usd';
  const raised = parts.reduce((s, p) => s + Math.max(0, p.raisedCents ?? 0), 0);
  const goals = parts.reduce((s, p) => s + p.estimateCents, 0);
  const ready = parts.filter((p) => p.status === 'funded');
  const nextOrder = parts.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0) + 1;
  const [orderMsg, setOrderMsg] = useState(null);
  const move = async (index, dir) => {
    const slugs = parts.map((p) => p.id);
    const j = index + dir;
    if (j < 0 || j >= slugs.length) return;
    [slugs[index], slugs[j]] = [slugs[j], slugs[index]];
    const { error } = await supabase.rpc('reorder_parts', { p_project_id: project.id, p_slugs: slugs });
    setOrderMsg(error ? error.message : null);
    if (!error) onSaved();
  };
  const duplicate = async (part) => {
    const taken = new Set(parts.map((p) => p.id));
    let slug = `${part.id}-copy`.slice(0, 60);
    for (let n = 2; taken.has(slug); n += 1) slug = `${part.id.slice(0, 54)}-copy-${n}`;
    const { error } = await supabase.from('parts').insert({
      project_id: project.id, slug, name: `${part.name} (copy)`.slice(0, 80), estimate_cents: part.estimateCents, kind: partKind(part),
      status: partKind(part) === 'upgrade' ? 'upgrade' : 'needed', condition: part.condition ?? null, priority: part.priority ?? 'standard',
      description: part.description ?? null, sort_order: nextOrder, image_urls: part.imageUrls ?? [], thumbnail_url: part.thumbnailUrl ?? null,
      model_url: part.modelUrl ?? null, car_placement: part.carPlacement ?? 'fit',
    });
    setOrderMsg(error ? error.message : `Duplicated as “${part.name} (copy)”. Open it to rename.`);
    if (!error) onSaved();
  };
  return (
    <section className="panel admin-section" aria-labelledby="admin-parts-title">
      <h2 id="admin-parts-title">Parts &amp; goals</h2>
      <p className="fine">
        Each part is its own goal. When paid contributions reach it, the part turns <strong>Funded</strong> and stops taking part
        contributions (the general fund stays open). Then buy it and use “Record purchase / progress” — that marks it Ordered,
        Bought or Installed and posts the update in one step. {formatCents(raised, currency)} raised across {formatCents(goals, currency)} of goals.
      </p>
      {ready.length > 0 && (
        <p className="note note--ok" role="status">Ready to buy: {ready.map((p) => p.name).join(', ')}.</p>
      )}
      <ul className="admin-parts">
        {parts.map((p, i) => <PartEditor key={p.dbId} part={{ ...p, currency }} projectId={project.id} currency={currency} onSaved={onSaved}
          onMove={(dir) => move(i, dir)} onDuplicate={() => duplicate(p)} isFirst={i === 0} isLast={i === parts.length - 1} />)}
      </ul>
      {orderMsg && <p className="fine" role="status">{orderMsg}</p>}
      <h3>Add a part</h3>
      <NewPart projectId={project.id} nextOrder={nextOrder} onSaved={onSaved} currency={currency} />
      <CsvImport projectId={project.id} existing={parts.map((p) => p.id)} nextOrder={nextOrder} onSaved={onSaved} currency={currency} />
    </section>
  );
}
