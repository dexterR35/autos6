import { describe, expect, it } from 'vitest';
import { formatCents, parseDollarsToCents, percentOf, validateAmountCents } from '../src/lib/money.js';

describe('money', () => {
  it('formats integer cents', () => {
    expect(formatCents(265000)).toBe('$2,650');
    expect(formatCents(1550)).toBe('$15.50');
    expect(formatCents(NaN)).toBe('—');
  });
  it('parses custom amounts without float drift', () => {
    expect(parseDollarsToCents('25')).toBe(2500);
    expect(parseDollarsToCents('$1,200.5')).toBe(120050);
    expect(parseDollarsToCents('0.29')).toBe(29);
    expect(parseDollarsToCents('19.99')).toBe(1999);
    expect(parseDollarsToCents('1.234')).toBeNull();
    expect(parseDollarsToCents('-5')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents('')).toBeNull();
  });
  it('validates limits', () => {
    expect(validateAmountCents(500)).toBeNull();
    expect(validateAmountCents(99)).toMatch(/minimum/);
    expect(validateAmountCents(1_000_001)).toMatch(/maximum/);
    expect(validateAmountCents(10.5)).toMatch(/valid/);
  });
  it('rounds campaign percentage like the reference (2650/8000 → 33%)', () => {
    expect(percentOf(265000, 800000)).toBe(33);
    expect(percentOf(900000, 800000)).toBe(100);
    expect(percentOf(100, 0)).toBe(0);
  });
});
