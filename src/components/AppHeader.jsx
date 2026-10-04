import { forwardRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Heart, Menu, Search, User, X } from 'lucide-react';
import { useGarageState } from '../hooks/useGarageState.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';

const NAV = [
  { to: '/', label: 'Garage', end: true },
  { to: '/parts', label: 'Parts' },
  { to: '/donations', label: 'Donations' },
  { to: '/progress', label: 'Progress' },
  { to: '/about', label: 'About' },
];

function Brand({ project }) {
  const title = project?.title ?? 'PROJECT S6';
  // Highlight a trailing "S6"-style token in red, as in the reference.
  const m = title.match(/^(.*?)(\s*\S*\d\S*)$/);
  return (
    <NavLink to="/" className="brand" aria-label={`${title} — garage`}>
      <span className="brand__title">
        {m ? (
          <>
            {m[1]}
            <span className="brand__accent">{m[2]}</span>
          </>
        ) : (
          title
        )}
      </span>
      {project?.vehicleDisplayName && <span className="brand__sub">{project.vehicleDisplayName}</span>}
    </NavLink>
  );
}

const AppHeader = forwardRef(function AppHeader(_props, ref) {
  const { project } = useProjectData();
  const { search, setSearch, openDonation } = useGarageState();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const onSearch = (e) => {
    setSearch(e.target.value);
    // Search drives the garage rail and the parts catalogue; elsewhere, jump to the catalogue.
    if (location.pathname !== '/' && location.pathname !== '/parts') navigate('/parts');
  };

  return (
    <header ref={ref} className="app-header">
      <Brand project={project} />

      <button
        type="button"
        className="icon-btn nav-toggle"
        aria-expanded={menuOpen}
        aria-controls="primary-nav"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        onClick={() => setMenuOpen((o) => !o)}
      >
        {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>

      <nav id="primary-nav" className={`primary-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Primary">
        <ul>
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} end={n.end} onClick={() => setMenuOpen(false)}>
                {n.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="header-actions">
        <label className="search">
          <Search aria-hidden="true" />
          <span className="visually-hidden">Search parts</span>
          <input type="search" placeholder="Search parts..." value={search} onChange={onSearch} autoComplete="off" />
        </label>
        <button type="button" className="btn btn--donate" onClick={() => openDonation()}>
          <Heart aria-hidden="true" fill="currentColor" />
          <span>Donate</span>
        </button>
        <NavLink to="/admin" className="icon-btn account-btn" aria-label="Owner sign in">
          <User aria-hidden="true" />
        </NavLink>
      </div>
    </header>
  );
});

export default AppHeader;
