// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.jsx';
import { ProjectDataProvider } from '../src/hooks/useProjectData.jsx';
import { GarageStateProvider } from '../src/hooks/useGarageState.jsx';
import { setConsent, trackPurchaseOnce } from '../src/lib/analytics.js';

beforeAll(() => {
  const real = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (this.classList?.contains('viewer')) return { left: 0, top: 0, x: 0, y: 0, width: 1590, height: 793, right: 1590, bottom: 793 };
    return real.call(this);
  };
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  window.dataLayer = [];
  localStorage.clear();
});
afterEach(cleanup);

const events = (name) => window.dataLayer.filter((e) => e && e.event === name);

function renderApp(path = '/') {
  render(
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
}

describe('SEO head on client navigation', () => {
  it('updates title, description and robots per route and records a virtual page view', async () => {
    renderApp('/');
    expect(document.title).toBe('Project S6 — Help Restore an Audi S6 C5 Avant');
    fireEvent.click(screen.getByRole('link', { name: 'Parts' }));
    expect(document.title).toBe('Parts Needed for the Audi S6 Restoration | Project S6');
    expect(document.head.querySelector('meta[name="description"]').content).toMatch(/^Every part/);
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    const views = events('virtual_page_view');
    expect(views.map((v) => v.page_path)).toEqual(['/', '/parts']);
  });

  it('marks the success page noindex and never sends its session id to analytics', () => {
    renderApp('/donation/success?session_id=cs_test_secretsession123');
    expect(document.head.querySelector('meta[name="robots"]').content).toBe('noindex, nofollow');
    expect(JSON.stringify(window.dataLayer)).not.toContain('cs_test_secretsession123');
  });
});

describe('funnel events', () => {
  it('records part selection and angle changes', async () => {
    renderApp('/');
    fireEvent.click(document.querySelector('.hotspot[data-part-id="hood"]'));
    const sel = events('select_item').at(-1);
    expect(sel.selection_source).toBe('hotspot');
    expect(sel.ecommerce.items[0]).toMatchObject({ item_id: 'hood', item_name: 'Hood', price: 650 });
    expect(window.dataLayer[window.dataLayer.indexOf(sel) - 1]).toEqual({ ecommerce: null }); // cleared first
    await act(async () => {
      fireEvent.click(document.querySelector('.angle[data-angle="rear"]'));
    });
    expect(events('select_angle').at(-1).angle_id).toBe('rear');
  });

  it('demo donations are not reported as checkouts and never include the donor’s name', async () => {
    renderApp('/');
    fireEvent.click(screen.getByRole('button', { name: /Donate now/i }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    fireEvent.change(within(dialog).getByLabelText(/Display name/), { target: { value: 'Secret Supporter' } });
    fireEvent.submit(dialog.querySelector('form'));
    expect(events('donate_dialog_open')).toHaveLength(1);
    expect(events('donation_demo_preview')).toHaveLength(1);
    expect(events('begin_checkout')).toHaveLength(0);
    expect(JSON.stringify(window.dataLayer)).not.toContain('Secret Supporter');
  });

  it('search is debounced and records the settled term once', () => {
    vi.useFakeTimers();
    try {
      renderApp('/');
      const input = screen.getAllByPlaceholderText('Search parts...')[0];
      for (const v of ['b', 'bu', 'bum', 'bumper']) fireEvent.change(input, { target: { value: v } });
      act(() => vi.advanceTimersByTime(1500));
      expect(events('search').map((e) => e.search_term)).toEqual(['bumper']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('purchase & consent', () => {
  it('purchase fires once per confirmed session and hashes the session id', async () => {
    const args = { sessionId: 'cs_test_abcdefghijklmnop', amountCents: 2500, currency: 'usd', partName: 'Hood' };
    expect(await trackPurchaseOnce(args)).toBe(true);
    expect(await trackPurchaseOnce(args)).toBe(false);
    const p = events('purchase');
    expect(p).toHaveLength(1);
    expect(p[0].ecommerce).toMatchObject({ currency: 'USD', value: 25 });
    expect(p[0].ecommerce.transaction_id).toMatch(/^s6-[0-9a-f]{24}$/);
    expect(JSON.stringify(window.dataLayer)).not.toContain('cs_test_abcdefghijklmnop');
  });

  it('consent updates use Consent Mode commands and keep ad signals denied', () => {
    setConsent('granted');
    const cmd = window.dataLayer.find((e) => e && e[0] === 'consent');
    expect(Array.from(cmd)).toEqual(['consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
    expect(localStorage.getItem('project-s6:analytics-consent')).toBe('granted');
  });

  it('the consent banner only appears when GTM is configured', async () => {
    renderApp('/');
    expect(screen.queryByRole('region', { name: /Analytics cookies/ })).toBeNull();
    cleanup();
    vi.resetModules();
    vi.stubEnv('VITE_GTM_ID', 'GTM-TEST123');
    try {
      const { default: Banner } = await import('../src/components/ConsentBanner.jsx');
      render(<Banner />);
      const region = screen.getByRole('region', { name: /Analytics cookies/ });
      fireEvent.click(within(region).getByRole('button', { name: 'Reject' }));
      expect(screen.queryByRole('region', { name: /Analytics cookies/ })).toBeNull();
      expect(localStorage.getItem('project-s6:analytics-consent')).toBe('denied');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
