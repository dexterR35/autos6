// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const { fetchGarageSupporters } = vi.hoisted(() => ({
  fetchGarageSupporters: vi.fn(async () => ({ rows: [{ id: 'supporter-0', label: 'Alex', amountCents: 2500, currency: 'usd' }], scope: 'all' })),
}));
vi.mock('../src/lib/liveData.js', () => ({ fetchGarageSupporters }));
import useGarageSupporters from '../src/hooks/useGarageSupporters.js';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// The 3D board redraws and re-uploads a large canvas texture whenever this value
// changes identity, so unrelated re-renders (hovering a part) must not create a new one.
it('returns the same object across re-renders until the supporter data changes', async () => {
  const project = { slug: 'project-s6', currency: 'usd' };
  const { result, rerender } = renderHook((props) => useGarageSupporters(props), { initialProps: { project, isDemo: false, status: 'ready' } });
  await waitFor(() => expect(result.current.state).toBe('ready'));
  const loaded = result.current;
  expect(loaded.rows).toHaveLength(1);
  rerender({ project: { ...project }, isDemo: false, status: 'ready' });
  rerender({ project: { ...project }, isDemo: false, status: 'ready' });
  expect(result.current).toBe(loaded);
  expect(fetchGarageSupporters).toHaveBeenCalledTimes(1);
});

it('keeps demo and unavailable states stable too', () => {
  const project = { slug: 'project-s6', currency: 'usd' };
  const { result, rerender } = renderHook((props) => useGarageSupporters(props), { initialProps: { project, isDemo: true, status: 'ready' } });
  const demo = result.current;
  rerender({ project, isDemo: true, status: 'ready' });
  expect(result.current).toBe(demo);
  expect(demo).toMatchObject({ isDemo: true, state: 'ready', rows: [] });
  rerender({ project, isDemo: false, status: 'error' });
  const unavailable = result.current;
  rerender({ project, isDemo: false, status: 'error' });
  expect(result.current).toBe(unavailable);
  expect(unavailable).toMatchObject({ isDemo: false, state: 'error' });
  expect(fetchGarageSupporters).not.toHaveBeenCalled();
});
