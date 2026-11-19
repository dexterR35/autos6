import { describe, expect, it } from 'vitest';
import { parsePartsCsv, splitCsv } from '../src/lib/partsCsv.js';

describe('parts CSV import', () => {
  it('reads quoted fields, embedded commas/newlines and a BOM', () => {
    expect(splitCsv('a,"b, c","d ""e""\nf"\r\n1,2,3', ',')).toEqual([['a', 'b, c', 'd "e"\nf'], ['1', '2', '3']]);
    const { rows, errors } = parsePartsCsv('﻿Name,Goal,Type,Priority,Condition,Description\nRS6 Grille,450,upgrade,important,New,"Honeycomb, gloss black"\nOil service,"1,200.50",,,"",');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { name: 'RS6 Grille', slug: 'rs6-grille', goalCents: 45000, kind: 'upgrade', priority: 'important', condition: 'New', description: 'Honeycomb, gloss black' },
      { name: 'Oil service', slug: 'oil-service', goalCents: 120050, kind: 'repair', priority: 'standard', condition: null, description: null },
    ]);
  });
  it('handles European Excel exports (semicolons, decimal commas, symbols, diacritics)', () => {
    const { rows } = parsePartsCsv('nume;name;goal\nx;Bară față;1.250,00 lei\nx;Țeavă;€ 99,5');
    expect(rows.map((r) => [r.slug, r.goalCents])).toEqual([['bara-fata', 125000], ['teava', 9950]]);
  });
  it('makes slugs unique against existing parts and each other', () => {
    const { rows } = parsePartsCsv('name,goal\nHood,10\nHood,20', { existingSlugs: ['hood'] });
    expect(rows.map((r) => r.slug)).toEqual(['hood-2', 'hood-3']);
  });
  it('reports bad rows by line number and requires a header', () => {
    expect(parsePartsCsv('Hood,10').errors[0]).toMatch(/header/);
    const { rows, errors } = parsePartsCsv('name,goal,type,priority\n,10\nA,abc\nB,10,turbo\nC,10,,urgent\nD,10');
    expect(rows.map((r) => r.name)).toEqual(['D']);
    expect(errors).toEqual([
      'Row 2: missing name.', 'Row 3 (A): goal "abc" is not an amount.',
      'Row 4 (B): type must be "upgrade" or "repair".', 'Row 5 (C): priority must be "important" or "standard".',
    ]);
  });
});
