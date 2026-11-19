import { describe, expect, it } from 'vitest';
import { countByStatus, filterParts, isOpen, remainingCents } from '../src/lib/parts.js';
import { demoParts } from '../src/data/demoProject.js';

describe('parts filtering', () => {
  it('computes reference counts from data: 10 total, 7 needed, 2 upgrade, 1 bought', () => {
    expect(countByStatus(demoParts)).toEqual({ all: 10, needed: 7, upgrade: 2, funded: 0, bought: 1 });
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
  it('groups the lifecycle into tabs: funded + ordered, bought + installed', () => {
    const staged = demoParts.map((p) => ({ hood: { ...p, status: 'funded' }, exhaust: { ...p, status: 'ordered' }, 'side-skirts': { ...p, status: 'installed' } }[p.id] ?? p));
    expect(countByStatus(staged)).toEqual({ all: 10, needed: 4, upgrade: 2, funded: 2, bought: 2 });
    expect(filterParts(staged, { status: 'funded' }).map((p) => p.id)).toEqual(['hood', 'exhaust']);
    expect(filterParts(staged, { status: 'bought' }).map((p) => p.id)).toEqual(['side-skirts', 'roof-box']);
  });
  it('reports what is left of a part goal', () => {
    expect(remainingCents({ estimateCents: 1000, raisedCents: 250 })).toBe(750);
    expect(remainingCents({ estimateCents: 1000, raisedCents: 5000 })).toBe(0);
    expect(remainingCents({ estimateCents: 1000, raisedCents: null })).toBeNull();
    expect(isOpen({ status: 'upgrade' })).toBe(true);
    expect(isOpen({ status: 'funded' })).toBe(false);
  });
});
