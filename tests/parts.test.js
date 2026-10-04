import { describe, expect, it } from 'vitest';
import { countByStatus, filterParts } from '../src/lib/parts.js';
import { demoParts } from '../src/data/demoProject.js';

describe('parts filtering', () => {
  it('computes reference counts from data: 10 total, 7 needed, 2 upgrade, 1 bought', () => {
    expect(countByStatus(demoParts)).toEqual({ all: 10, needed: 7, upgrade: 2, bought: 1 });
  });
  it('search matches names and conditions', () => {
    expect(filterParts(demoParts, { query: 'bumper' }).map((p) => p.id)).toEqual(['front-bumper', 'rear-bumper']);
    expect(filterParts(demoParts, { query: 'missing' }).map((p) => p.id)).toEqual(['side-skirts']);
    expect(filterParts(demoParts, { query: 'zzz' })).toHaveLength(0);
  });
  it('status filter combines with search', () => {
    expect(filterParts(demoParts, { status: 'bought' }).map((p) => p.id)).toEqual(['roof-box']);
    expect(filterParts(demoParts, { status: 'needed', query: 'replacement' }).map((p) => p.id)).toEqual(['exhaust', 'coilovers']);
  });
  it('counts follow the current data, not hard-coded numbers', () => {
    const changed = demoParts.map((p) => (p.id === 'hood' ? { ...p, status: 'bought' } : p));
    expect(countByStatus(changed)).toMatchObject({ needed: 6, bought: 2 });
  });
});
