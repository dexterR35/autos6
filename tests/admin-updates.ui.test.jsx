// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const sb = vi.hoisted(() => {
  // Chainable query double: every filter returns the query, awaiting it yields no rows.
  const query = () => {
    const q = { then: (resolve) => resolve({ data: [], error: null }) };
    for (const method of ['select', 'eq', 'order', 'limit', 'is', 'not', 'range', 'update', 'delete']) q[method] = () => q;
    return q;
  };
  const insert = vi.fn(async () => ({ error: null }));
  const upload = vi.fn(async () => ({ error: null }));
  return {
    insert, upload,
    client: {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: { user: { id: 'owner-1' } } } })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        signOut: vi.fn(),
      },
      rpc: vi.fn(async () => ({ data: true, error: null })),
      from: vi.fn(() => Object.assign(query(), { insert })),
      storage: { from: () => ({ upload, getPublicUrl: (path) => ({ data: { publicUrl: `https://media.example/${path}` } }) }) },
    },
  };
});
vi.mock('../src/lib/supabase.js', () => ({ supabase: sb.client }));
vi.mock('../src/hooks/useProjectData.jsx', () => ({ useProjectData: () => ({ isDemo: false, status: 'ready', project: { id: 'project-1', title: 'Project S6' }, parts: [], reload: vi.fn() }) }));
import Admin from '../src/pages/Admin.jsx';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('rejects an unreadable cost before uploading any photo, then saves a valid one', async () => {
  render(<Admin />);
  const section = (await screen.findByRole('heading', { name: 'Restoration updates' })).closest('section');
  fireEvent.change(within(section).getByLabelText('Title'), { target: { value: 'Brakes done' } });
  fireEvent.change(within(section).getByLabelText('Body'), { target: { value: 'New discs and pads.' } });
  fireEvent.change(within(section).getByLabelText(/Photos/), { target: { files: [new File(['x'], 'disc.jpg', { type: 'image/jpeg' })] } });
  const cost = within(section).getByLabelText(/Cost/);
  fireEvent.change(cost, { target: { value: 'about 300' } });
  fireEvent.submit(within(section).getByRole('button', { name: /Add update/ }).closest('form'));
  expect(await within(section).findByText(/Enter the cost as an amount like 120/)).toBeInTheDocument();
  expect(sb.upload).not.toHaveBeenCalled();
  expect(sb.insert).not.toHaveBeenCalled();

  fireEvent.change(cost, { target: { value: '120.50' } });
  fireEvent.submit(within(section).getByRole('button', { name: /Add update/ }).closest('form'));
  await waitFor(() => expect(sb.insert).toHaveBeenCalledTimes(1));
  expect(sb.upload).toHaveBeenCalledTimes(1);
  expect(sb.insert.mock.calls[0][0]).toMatchObject({ cost_cents: 12050, title: 'Brakes done', image_urls: [expect.stringMatching(/^https:\/\/media\.example\/project-1\/updates\//)] });
});

it('saves an update without a cost', async () => {
  render(<Admin />);
  const section = (await screen.findByRole('heading', { name: 'Restoration updates' })).closest('section');
  fireEvent.change(within(section).getByLabelText('Title'), { target: { value: 'Wash day' } });
  fireEvent.change(within(section).getByLabelText('Body'), { target: { value: 'Clean and tidy.' } });
  fireEvent.change(within(section).getByLabelText(/Cost/), { target: { value: '   ' } });
  fireEvent.submit(within(section).getByRole('button', { name: /Add update/ }).closest('form'));
  await waitFor(() => expect(sb.insert).toHaveBeenCalledTimes(1));
  expect(sb.insert.mock.calls[0][0]).toMatchObject({ cost_cents: null, image_urls: [] });
});
