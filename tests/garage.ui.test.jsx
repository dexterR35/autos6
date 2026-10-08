// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from '../src/App.jsx';
import { ProjectDataProvider } from '../src/hooks/useProjectData.jsx';
import { GarageStateProvider } from '../src/hooks/useGarageState.jsx';

// jsdom has no layout or image loading: give the stage a desktop size and make images load.
beforeAll(() => {
  const real = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (this.classList?.contains('viewer')) return { left: 0, top: 0, x: 0, y: 0, width: 1590, height: 793, right: 1590, bottom: 793 };
    return real.call(this);
  };
  globalThis.Image = class {
    set src(v) {
      this._src = v;
      setTimeout(() => this.onload?.(), 0);
    }
    get src() {
      return this._src;
    }
  };
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

// jsdom covers the explicit image fallback; the actual WebGL renderer is exercised
// in scripts/verify-orbit.mjs with a browser and the exported Blender models.
function renderApp(path = '/?viewer=image') {
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <ProjectDataProvider mode="demo">
        <GarageStateProvider>
          <App />
        </GarageStateProvider>
      </ProjectDataProvider>
    </MemoryRouter>,
  );
  const img = document.querySelector('.viewer__img');
  if (img) fireEvent.load(img);
  return utils;
}

const layer = () => document.querySelector('.hotspot-layer');
const dotParts = () => [...document.querySelectorAll('.hotspot')].map((b) => b.dataset.partId).sort();

async function switchView(label) {
  const strip = screen.getByRole('group', { name: 'Camera angles' });
  await act(async () => {
    fireEvent.click(within(strip).getByRole('button', { name: new RegExp(`^${label}( \\(shows selected part\\))?$`) }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('garage image fallback dashboard (demo mode)', () => {
  it('renders the reference content from data', () => {
    renderApp();
    expect(screen.getByRole('button', { name: 'All (10)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needed (7)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bought (1)' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Campaign funding' })).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getAllByText(/Demo data/i).length).toBeGreaterThan(0);
    expect(layer().dataset.view).toBe('exterior-a');
    expect(dotParts()).toEqual(['brake-kit', 'front-bumper', 'hood', 'roof-box', 'side-skirts', 'wheels']);
    expect(document.querySelectorAll('.callout').length).toBeGreaterThan(0);
  });

  it('never renders missing angles as buttons', () => {
    renderApp();
    const strip = screen.getByRole('group', { name: 'Camera angles' });
    expect(within(strip).queryByRole('button', { name: /Interior|Engine|Top View/ })).toBeNull();
  });

  it('switching to Front swaps the image and the hotspot map together', async () => {
    renderApp();
    await switchView('Front');
    await waitFor(() => expect(layer().dataset.view).toBe('front'));
    expect(document.querySelector('.viewer__img:not(.is-leaving)').getAttribute('src')).toContain('/front.webp');
    expect(dotParts()).toEqual(['front-bumper', 'hood', 'roof-box']);
    await switchView('Rear');
    await waitFor(() => expect(layer().dataset.view).toBe('rear'));
    expect(dotParts()).toEqual(['exhaust', 'rear-bumper', 'roof-box']);
    expect(document.querySelectorAll('.hotspot-layer')).toHaveLength(1); // no stale dots from the previous view
  });

  it('clicking a dot selects the same part in the list and opens details', async () => {
    renderApp();
    fireEvent.click(document.querySelector('.hotspot[data-part-id="hood"]'));
    expect(document.querySelector('[data-part-row="hood"]')).toHaveAttribute('aria-current', 'true');
    expect(document.querySelector('.hotspot[data-part-id="hood"]')).toHaveAttribute('aria-pressed', 'true');
    const drawer = screen.getByRole('complementary', { name: 'Hood' });
    expect(within(drawer).getByRole('button', { name: /Fund this part/i })).toBeInTheDocument();
  });

  it('selecting an off-camera part from the list moves to a view that shows it', async () => {
    renderApp();
    await switchView('Front');
    await waitFor(() => expect(layer().dataset.view).toBe('front'));
    await act(async () => {
      fireEvent.click(document.querySelector('[data-part-row="rear-bumper"]'));
      await new Promise((r) => setTimeout(r, 20));
    });
    await waitFor(() => expect(document.querySelector('.hotspot[data-part-id="rear-bumper"]')).not.toBeNull());
    expect(document.querySelector('.hotspot[data-part-id="rear-bumper"]')).toHaveAttribute('aria-pressed', 'true');
  });

  it('a part with no available view keeps the camera and explains why there is no dot', () => {
    renderApp();
    fireEvent.click(document.querySelector('[data-part-row="coilovers"]'));
    expect(layer().dataset.view).toBe('exterior-a');
    expect(screen.getByText(/No view shows this part yet/)).toBeInTheDocument();
  });

  it('shows "Not visible in this angle" when the selected part leaves the frame', async () => {
    renderApp();
    fireEvent.click(document.querySelector('.hotspot[data-part-id="hood"]'));
    await switchView('Rear');
    await waitFor(() => expect(layer().dataset.view).toBe('rear'));
    expect(screen.getByText('Not visible in this angle.')).toBeInTheDocument();
    expect(document.querySelector('[data-part-row="hood"]')).toHaveAttribute('aria-current', 'true');
  });

  it('search filters rows, counts and hotspots consistently', () => {
    renderApp();
    fireEvent.change(screen.getAllByPlaceholderText('Search parts...')[0], { target: { value: 'bumper' } });
    expect(document.querySelectorAll('.part-row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'All (2)' })).toBeInTheDocument();
    expect(dotParts()).toEqual(['front-bumper']);
    fireEvent.change(screen.getAllByPlaceholderText('Search parts...')[0], { target: { value: 'zzz' } });
    expect(screen.getByText(/No parts match/)).toBeInTheDocument();
  });

  it('Bought tab filters to purchased parts', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Bought (1)' }));
    expect([...document.querySelectorAll('.part-row')].map((r) => r.dataset.partRow)).toEqual(['roof-box']);
    expect(dotParts()).toEqual(['roof-box']);
  });
});

describe('donation dialog (demo mode)', () => {
  it('validates custom amounts and never pretends to charge in demo mode', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '$50' }));
    fireEvent.click(screen.getByRole('button', { name: /Donate now/i }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    const custom = within(dialog).getByPlaceholderText('Other');
    fireEvent.change(custom, { target: { value: '0.5' } });
    expect(within(dialog).getByText(/minimum contribution is \$1/i)).toBeInTheDocument();
    fireEvent.change(custom, { target: { value: '12.34' } });
    fireEvent.submit(dialog.querySelector('form'));
    expect(await within(dialog).findByText('No payment was taken')).toBeInTheDocument();
    expect(within(dialog).getByText('$12.34')).toBeInTheDocument();
  });

  it('"Fund this part" preselects the part', async () => {
    renderApp();
    fireEvent.click(document.querySelector('.hotspot[data-part-id="hood"]'));
    fireEvent.click(screen.getByRole('button', { name: /Fund this part/i }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    expect(within(dialog).getByRole('combobox', { hidden: true })).toHaveValue('hood');
    expect(within(dialog).getByText(/isn’t a parts purchase/)).toBeInTheDocument();
  });
});

describe('routes', () => {
  it.each([
    ['/parts', /Parts/],
    ['/donations', /Donations/],
    ['/progress', /Progress/],
    ['/about', /PROJECT S6/],
    ['/admin', /Owner admin/],
    ['/donation/cancel?part=hood&amount=25.00', /Checkout cancelled/],
    ['/nope', /Page not found/],
  ])('%s renders', async (path, heading) => {
    renderApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('demo donations page shows no invented supporters', () => {
    renderApp('/donations');
    expect(screen.getByText(/Demo mode has no supporter records/)).toBeInTheDocument();
  });
});
