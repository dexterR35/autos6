// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const sb = vi.hoisted(() => {
  const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
  const insert = vi.fn(async () => ({ error: null }));
  const upload = vi.fn(async () => ({ error: null }));
  const rpc = vi.fn(async () => ({ data: 'update-1', error: null }));
  return {
    update, insert, upload, rpc,
    client: {
      rpc,
      from: vi.fn(() => ({ update, insert, delete: () => ({ eq: async () => ({ error: null }) }) })),
      storage: { from: (bucket) => ({ upload, getPublicUrl: (path) => ({ data: { publicUrl: `https://media.example/${bucket}/${path}` } }) }) },
    },
  };
});
vi.mock('../src/lib/supabase.js', () => ({ supabase: sb.client }));
import PartsAdmin from '../src/components/admin/PartsAdmin.jsx';

const hood = { id: 'hood', dbId: 'db-hood', name: 'Hood', estimateCents: 65000, raisedCents: 65000, supporterCount: 4, status: 'funded', kind: 'repair', priority: 'standard', sortOrder: 1, imageUrls: [], thumbnailUrl: null, modelUrl: null, actualCostCents: null };
const project = { id: '00000000-0000-4000-8000-000000000001', currency: 'usd' };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('flags funded parts and records a purchase with its update in one call', async () => {
  const onSaved = vi.fn();
  render(<PartsAdmin project={project} parts={[hood]} onSaved={onSaved} />);
  expect(screen.getByText(/Ready to buy: Hood/)).toBeInTheDocument();
  const form = screen.getByRole('button', { name: /Save progress/ }).closest('form');
  fireEvent.change(within(form).getByLabelText('New stage'), { target: { value: 'bought' } });
  expect(within(form).getByLabelText('Update title')).toHaveValue('Bought: Hood');
  fireEvent.change(within(form).getByLabelText(/What you paid/), { target: { value: '612.50' } });
  fireEvent.submit(form);
  await waitFor(() => expect(sb.rpc).toHaveBeenCalledTimes(1));
  expect(sb.rpc).toHaveBeenCalledWith('record_part_progress', expect.objectContaining({ p_part_id: 'db-hood', p_status: 'bought', p_actual_cost_cents: 61250, p_title: 'Bought: Hood', p_publish: true }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it('rejects a non-.glb model before uploading and uploads a real one to project-models', async () => {
  render(<PartsAdmin project={project} parts={[hood]} onSaved={vi.fn()} />);
  const inputs = screen.getAllByLabelText(/3D model \(.glb/);
  fireEvent.change(inputs[0], { target: { files: [new File(['x'], 'hood.obj')] } });
  expect(await screen.findByText(/Choose a .glb file/)).toBeInTheDocument();
  expect(sb.upload).not.toHaveBeenCalled();
  fireEvent.change(inputs[0], { target: { files: [new File(['glTF'], 'hood.glb')] } });
  await waitFor(() => expect(sb.upload).toHaveBeenCalledTimes(1));
  expect(sb.upload.mock.calls[0][0]).toMatch(new RegExp(`^${project.id}/parts/hood/.+\\.glb$`));
  expect(sb.upload.mock.calls[0][2]).toEqual({ contentType: 'model/gltf-binary' });
});

it('creates a new upgrade card with a generated slug and the next sort order', async () => {
  render(<PartsAdmin project={project} parts={[hood]} onSaved={vi.fn()} />);
  const form = screen.getByRole('button', { name: /Add part/ }).closest('form');
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'RS6 Front Grille' } });
  expect(within(form).getByLabelText(/Slug/)).toHaveValue('rs6-front-grille');
  fireEvent.change(within(form).getByLabelText('Goal (USD)'), { target: { value: '450' } });
  fireEvent.submit(form);
  await waitFor(() => expect(sb.insert).toHaveBeenCalledTimes(1));
  expect(sb.insert.mock.calls[0][0]).toMatchObject({ slug: 'rs6-front-grille', estimate_cents: 45000, kind: 'upgrade', status: 'upgrade', sort_order: 2 });
});

const second = { ...hood, id: 'exhaust', dbId: 'db-exhaust', name: 'Exhaust', status: 'needed', raisedCents: 0, sortOrder: 2 };

it('reorders with one call and duplicates a card with a free slug', async () => {
  const onSaved = vi.fn();
  render(<PartsAdmin project={{ ...project, slug: 'project-s6' }} parts={[hood, second]} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move Exhaust up' }));
  await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith('reorder_parts', { p_project_id: project.id, p_slugs: ['exhaust', 'hood'] }));
  expect(screen.getByRole('button', { name: 'Move Hood up' })).toBeDisabled();
  fireEvent.click(screen.getAllByRole('button', { name: /Duplicate/ })[0]);
  await waitFor(() => expect(sb.insert).toHaveBeenCalledTimes(1));
  expect(sb.insert.mock.calls[0][0]).toMatchObject({ slug: 'hood-copy', name: 'Hood (copy)', status: 'needed', estimate_cents: 65000 });
});

it('saves "next up", car placement and before/after fields', async () => {
  render(<PartsAdmin project={project} parts={[second]} onSaved={vi.fn()} />);
  const form = screen.getByRole('button', { name: /Save part/ }).closest('form');
  fireEvent.click(within(form).getByLabelText(/Next up/));
  fireEvent.change(within(form).getByLabelText(/Show on 3D car/), { target: { value: 'car' } });
  fireEvent.submit(form);
  await waitFor(() => expect(sb.update).toHaveBeenCalledTimes(1));
  expect(sb.update.mock.calls[0][0]).toMatchObject({ is_next_up: true, car_placement: 'car', before_image_url: null, after_image_url: null, receipt_url: null });
  expect(sb.update.mock.calls[0][0]).not.toHaveProperty('sort_order');
});

it('previews a CSV and imports only when every row is valid', async () => {
  render(<PartsAdmin project={project} parts={[hood]} onSaved={vi.fn()} />);
  const input = screen.getByLabelText('Choose CSV file');
  const file = (text) => Object.assign(new File([text], 'parts.csv', { type: 'text/csv' }), { text: async () => text });
  fireEvent.change(input, { target: { files: [file('name,goal\nBad,abc')] } });
  expect(await screen.findByText(/goal "abc" is not an amount/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Import 0 parts/ })).toBeDisabled();
  fireEvent.change(input, { target: { files: [file('name,goal,type\nHood,100,repair\nRS6 grille,450,upgrade')] } });
  const go = await screen.findByRole('button', { name: 'Import 2 parts' });
  fireEvent.click(go);
  await waitFor(() => expect(sb.insert).toHaveBeenCalledTimes(1));
  expect(sb.insert.mock.calls[0][0].map((r) => [r.slug, r.status, r.sort_order])).toEqual([['hood-2', 'needed', 2], ['rs6-grille', 'upgrade', 3]]);
});
