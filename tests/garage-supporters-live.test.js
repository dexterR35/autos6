import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../src/lib/supabase.js', () => ({ supabase: { rpc } }));
import { fetchGarageSupporters } from '../src/lib/liveData.js';

beforeEach(() => { rpc.mockReset(); });

describe('complete garage supporter feed', () => {
  it('reads beyond one page and preserves repeat counts and unrelated matching names', async () => {
    rpc.mockImplementation((_name, { p_offset }) => Promise.resolve({
      data: Array.from({ length: p_offset === 0 ? 100 : 2 }, (_, index) => ({ display_name: index < 2 ? 'Alex' : `Supporter ${p_offset + index}`, donation_count: 3, amount_cents: 2500 })),
      error: null,
    }));
    const result = await fetchGarageSupporters('project-s6', { currency: 'eur' });
    expect(result.scope).toBe('all');
    expect(result.rows).toHaveLength(102);
    expect(result.rows[0].label).toBe('3× Alex');
    expect(result.rows[1].label).toBe('3× Alex');
    expect(result.rows[100].id).toBe('supporter-100');
    expect(result.rows.every((row) => row.currency === 'eur')).toBe(true);
    expect(rpc.mock.calls.map((call) => call[1].p_offset)).toEqual([0, 100]);
  });

  it('labels the legacy fallback as recent when the migration is not deployed', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Function not found' } });
    rpc.mockResolvedValueOnce({ data: [
      { display_name: 'Mara', amount_cents: 500, created_at: '2026-10-01' },
      { display_name: 'Mara', amount_cents: 1000, created_at: '2026-10-02' },
    ], error: null });
    const result = await fetchGarageSupporters('project-s6');
    expect(result.scope).toBe('recent');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ label: '2× Mara', amountCents: 1500 });
    expect(rpc).toHaveBeenLastCalledWith('get_public_contributions', { p_slug: 'project-s6', p_limit: 100 });
  });

  it('reports genuine data errors and respects cancellation', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Permission denied' } });
    await expect(fetchGarageSupporters('project-s6')).rejects.toThrow('Permission denied');
    expect(rpc).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort(new Error('Stopped'));
    await expect(fetchGarageSupporters('project-s6', { signal: controller.signal })).rejects.toThrow('Stopped');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
