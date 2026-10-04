// Live-mode reads from Supabase using the publishable key. Only public tables and the
// security-definer summary functions are touched; private donation rows are never read.
// supabase-js is loaded on demand so demo mode doesn't ship it in the initial bundle.
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
});

const mapUpdate = (r) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  imageUrls: r.image_urls ?? [],
  publishedAt: r.published_at,
  costCents: r.cost_cents,
});

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchLiveProject(slug) {
  const supabase = await client();
  const project = mapProject(check(await supabase.from('projects').select('*').eq('slug', slug).single()));
  const [parts, updates, summary] = await Promise.all([
    supabase.from('parts').select('*').eq('project_id', project.id).order('sort_order').then(check),
    supabase.from('restoration_updates').select('*').eq('project_id', project.id).not('published_at', 'is', null).order('published_at', { ascending: false }).then(check),
    fetchLiveSummary(slug),
  ]);
  return { project, parts: parts.map(mapPart), updates: updates.map(mapUpdate), summary };
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
