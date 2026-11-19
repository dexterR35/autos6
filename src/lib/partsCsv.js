// Parse a parts list exported from Excel / Google Sheets.
// Header row required: name, goal, type, priority, condition, description (any order,
// case-insensitive; only name and goal are required). Comma or semicolon separated
// (Excel with Romanian/European regional settings uses ";").
import { parseDollarsToCents } from './money.js';

const MAX_ROWS = 200;

export function splitCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

export const slugify = (name) => name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export function parsePartsCsv(text, { existingSlugs = [] } = {}) {
  const clean = String(text ?? '').replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const table = splitCsv(clean, delimiter);
  const errors = [];
  if (!table.length) return { rows: [], errors: ['The file is empty.'] };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (name, ...aliases) => [name, ...aliases].map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const idx = { name: col('name', 'part'), goal: col('goal', 'estimate', 'price', 'amount'), type: col('type', 'kind'), priority: col('priority'), condition: col('condition'), description: col('description', 'notes') };
  if (idx.name < 0 || idx.goal < 0) return { rows: [], errors: ['The first row must be a header with at least "name" and "goal" columns.'] };
  const body = table.slice(1);
  if (body.length > MAX_ROWS) errors.push(`Only ${MAX_ROWS} parts can be imported at once.`);
  const taken = new Set(existingSlugs);
  const rows = [];
  body.slice(0, MAX_ROWS).forEach((cells, i) => {
    const line = i + 2;
    const get = (k) => (idx[k] >= 0 ? (cells[idx[k]] ?? '').trim() : '');
    const name = get('name').slice(0, 80);
    if (!name) { errors.push(`Row ${line}: missing name.`); return; }
    // "1.200,50" (European) or "1,200.50" both work; currency symbols are ignored.
    let goalText = get('goal').replace(/[^\d.,]/g, '');
    if (/,\d{1,2}$/.test(goalText)) goalText = goalText.replace(/\./g, '').replace(',', '.');
    const goalCents = parseDollarsToCents(goalText);
    if (!goalCents || goalCents <= 0) { errors.push(`Row ${line} (${name}): goal "${get('goal')}" is not an amount.`); return; }
    const type = get('type').toLowerCase();
    if (type && !['upgrade', 'repair', 'needed'].includes(type)) { errors.push(`Row ${line} (${name}): type must be "upgrade" or "repair".`); return; }
    const priority = get('priority').toLowerCase() || 'standard';
    if (!['important', 'standard'].includes(priority)) { errors.push(`Row ${line} (${name}): priority must be "important" or "standard".`); return; }
    const base = slugify(name) || 'part';
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base.slice(0, 56)}-${n}`;
    taken.add(slug);
    rows.push({ name, slug, goalCents, kind: type === 'upgrade' ? 'upgrade' : 'repair', priority, condition: get('condition').slice(0, 80) || null, description: get('description').slice(0, 2000) || null });
  });
  return { rows, errors };
}
