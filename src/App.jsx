import { lazy, Suspense, useRef } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import AppHeader from './components/AppHeader.jsx';
import DonationDialog from './components/DonationDialog.jsx';
import ConsentBanner from './components/ConsentBanner.jsx';
import { useSeo } from './seo/useSeo.js';
import Garage from './pages/Garage.jsx';
import Parts from './pages/Parts.jsx';
import Donations from './pages/Donations.jsx';
import Progress from './pages/Progress.jsx';
import About from './pages/About.jsx';
import { DonationCancel, DonationSuccess } from './pages/DonationReturn.jsx';
import NotFound from './pages/NotFound.jsx';
import Legal from './pages/Legal.jsx';
import SubscriptionReturn from './pages/SubscriptionReturn.jsx';
import AppFooter from './components/AppFooter.jsx';
import { ShellContext } from './hooks/useShell.js';
import { useProjectData } from './hooks/useProjectData.jsx';

const Admin = lazy(() => import('./pages/Admin.jsx'));
const Community = lazy(() => import('./pages/Community.jsx'));

function ModeBanner() {
  const { mode, status, error } = useProjectData();
  if (mode === 'live' && (status === 'unconfigured' || status === 'error')) {
    return (
      <div className="mode-banner mode-banner--warn" role="alert">
        {error || 'Live data is unavailable.'} No sample figures are shown in live mode.
      </div>
    );
  }
  return null;
}

export default function App() {
  const headerRef = useRef(null);
  useSeo();
  const { pathname } = useLocation();
  const route = pathname === '/' ? 'garage' : pathname.split('/')[1];
  return (
    <ShellContext.Provider value={{ headerRef }}>
      <div className="app" data-route={route}>
        <a className="skip-link" href="#main">Skip to content</a>
        <AppHeader ref={headerRef} />
        <ModeBanner />
        <main id="main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Garage />} />
            <Route path="/parts" element={<Parts />} />
            <Route path="/donations" element={<Donations />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/about" element={<About />} />
            <Route path="/community" element={<Suspense fallback={<p className="page muted">Loading community…</p>}><Community /></Suspense>} />
            <Route path="/terms" element={<Legal />} />
            <Route path="/privacy" element={<Legal />} />
            <Route path="/subscription/confirm" element={<SubscriptionReturn />} />
            <Route path="/subscription/unsubscribe" element={<SubscriptionReturn />} />
            <Route path="/admin" element={<Suspense fallback={<p className="page muted">Loading…</p>}><Admin /></Suspense>} />
            <Route path="/donation/success" element={<DonationSuccess />} />
            <Route path="/donation/cancel" element={<DonationCancel />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        {route !== 'garage' && <AppFooter />}
        <DonationDialog />
        <ConsentBanner />
      </div>
    </ShellContext.Provider>
  );
}
