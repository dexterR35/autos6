// Live-mode reads from Supabase using the publishable key. Only public tables and the
// security-definer summary functions are touched; private donation rows are never read.
// supabase-js is loaded on demand so demo mode doesn't ship it in the initial bundle.
import { aggregateGarageSupporters, mapGarageSupporters } from './garageSupportersData.js';
const client = async () => {
  const { supabase } = await import('./supabase.js');
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
};

const mapProject = (r) => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  vehicleDisplayName: r.vehicle_display_name,
  tagline: r.tagline,
  currency: r.currency,
  goalCents: r.goal_cents,
  description: r.description,
});

export const mapPart = (r) => ({
  id: r.slug, // domain id shared with views.js hotspots
  dbId: r.id,
  name: r.name,
  estimateCents: r.estimate_cents,
  status: r.status,
  condition: r.condition,
  description: r.description,
  thumbnailUrl: r.thumbnail_url,
  sortOrder: r.sort_order,
  priority: r.priority ?? 'standard',
  kind: r.kind ?? (r.status === 'upgrade' ? 'upgrade' : 'repair'),
  modelUrl: r.model_url ?? null,
  imageUrls: r.image_urls ?? [],
  actualCostCents: r.actual_cost_cents ?? null,
  fundedAt: r.funded_at ?? null,
  orderedAt: r.ordered_at ?? null,
  boughtAt: r.bought_at ?? null,
  installedAt: r.installed_at ?? null,
  isNextUp: Boolean(r.is_next_up),
  carPlacement: r.car_placement ?? 'fit',
  beforeImageUrl: r.before_image_url ?? null,
  afterImageUrl: r.after_image_url ?? null,
  receiptUrl: r.receipt_url ?? null,
  raisedCents: null,
  supporterCount: null,
});

const mapUpdate = (r) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  imageUrls: r.image_urls ?? [],
  publishedAt: r.published_at,
  costCents: r.cost_cents,
  partId: r.part_id ?? null,
});

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchLiveProject(slug) {
  const supabase = await client();
  const project = mapProject(check(await supabase.from('projects').select('*').eq('slug', slug).single()));
  const [parts, updates, summary, funding, monthly] = await Promise.all([
    supabase.from('parts').select('*').eq('project_id', project.id).order('sort_order').then(check),
    supabase.from('restoration_updates').select('*').eq('project_id', project.id).not('published_at', 'is', null).order('published_at', { ascending: false }).then(check),
    fetchLiveSummary(slug),
    fetchPartFunding(slug),
    fetchRecurringSummary(slug),
  ]);
  const slugById = Object.fromEntries(parts.map((p) => [p.id, p.slug]));
  return {
    project,
    parts: parts.map((p) => ({ ...mapPart(p), raisedCents: funding[p.slug]?.raisedCents ?? 0, supporterCount: funding[p.slug]?.count ?? 0 })),
    // Updates refer to parts by their public slug, like everything else in the UI.
    updates: updates.map((u) => ({ ...mapUpdate(u), partId: u.part_id ? slugById[u.part_id] ?? null : null })),
    summary: { ...summary, monthly },
  };
}

/** Active monthly supporters (count and monthly total only). Null before the migration. */
export async function fetchRecurringSummary(slug) {
  const supabase = await client();
  const { data, error } = await supabase.rpc('get_recurring_summary', { p_slug: slug });
  if (error) return null;
  const r = Array.isArray(data) ? data[0] : data;
  return r ? { activeCount: Number(r.active_count ?? 0), monthlyCents: Number(r.monthly_cents ?? 0) } : null;
}

/** Public names behind one part ("funded by"). */
export async function fetchPartSupporters(slug, partSlug, limit = 30) {
  const supabase = await client();
  const rows = check(await supabase.rpc('get_part_supporters', { p_slug: slug, p_part_slug: partSlug, p_limit: limit }));
  return rows.map((r) => ({ name: r.display_name, totalCents: Number(r.total_cents), count: Number(r.contribution_count) }));
}

/** Polls with options and vote counts; plus the signed-in member's own votes. */
export async function fetchPolls(slug, projectId, userId = null) {
  const supabase = await client();
  const [polls, options, results, mine] = await Promise.all([
    supabase.from('polls').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).then(check),
    supabase.from('poll_options').select('*').eq('project_id', projectId).order('sort_order').then(check),
    supabase.rpc('get_poll_results', { p_slug: slug }).then(check),
    userId ? supabase.from('poll_votes').select('poll_id,option_id').then(check) : Promise.resolve([]),
  ]);
  return mapPolls(polls, options, results, mine);
}

export function mapPolls(polls, options, results, mine = []) {
  const votes = Object.fromEntries(results.map((r) => [r.option_id, Number(r.votes)]));
  const myVote = Object.fromEntries(mine.map((v) => [v.poll_id, v.option_id]));
  return polls.map((p) => {
    const opts = options.filter((o) => o.poll_id === p.id).map((o) => ({
      id: o.id, label: o.label, description: o.description, imageUrl: o.image_url, estimateCents: o.estimate_cents,
      partDbId: o.part_id, sortOrder: o.sort_order, votes: votes[o.id] ?? 0,
    }));
    const closed = p.status === 'closed' || (p.closes_at && Date.parse(p.closes_at) <= Date.now());
    return {
      id: p.id, question: p.question, description: p.description, status: closed ? 'closed' : 'open', closesAt: p.closes_at,
      winnerOptionId: p.winner_option_id, options: opts, totalVotes: opts.reduce((s, o) => s + o.votes, 0), myVote: myVote[p.id] ?? null,
    };
  });
}

export async function fetchPartFunding(slug) {
  const supabase = await client();
  const rows = check(await supabase.rpc('get_part_funding', { p_slug: slug }));
  return Object.fromEntries(rows.map((r) => [r.part_slug, { raisedCents: Number(r.raised_cents), count: Number(r.donation_count ?? 0) }]));
}

export async function fetchLiveSummary(slug) {
  const supabase = await client();
  const rows = check(await supabase.rpc('get_campaign_summary', { p_slug: slug }));
  const r = Array.isArray(rows) ? rows[0] : rows;
  return { raisedCents: Number(r?.raised_cents ?? 0), goalCents: Number(r?.goal_cents ?? 0), donationCount: Number(r?.donation_count ?? 0) };
}

export async function fetchPublicContributions(slug, limit = 50) {
  const supabase = await client();
  const rows = check(await supabase.rpc('get_public_contributions', { p_slug: slug, p_limit: limit }));
  return rows.map((r) => ({ displayName: r.display_name, amountCents: r.amount_cents, partName: r.part_name, createdAt: r.created_at }));
}

/** Full public donor wall, paged on the server without exposing donor identities. */
export async function fetchGarageSupporters(slug, { currency = 'usd', signal } = {}) {
  const supabase = await client();
  const rows = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    signal?.throwIfAborted();
    let request = supabase.rpc('get_garage_supporters', { p_slug: slug, p_limit: pageSize, p_offset: offset });
    if (signal) request = request.abortSignal(signal);
    const result = await request;
    if (result.error && offset === 0 && ['PGRST202', '42883'].includes(result.error.code)) {
      // Deployments awaiting the new migration retain a truthful recent-only wall.
      const recent = await fetchPublicContributions(slug, pageSize);
      signal?.throwIfAborted();
      return { rows: aggregateGarageSupporters(recent, { currency }), scope: 'recent' };
    }
    const page = check(result) ?? [];
    rows.push(...mapGarageSupporters(page, { currency, offset }));
    if (page.length < pageSize) break;
  }
  return { rows, scope: 'all' };
}
