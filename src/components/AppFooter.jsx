import { Link } from 'react-router-dom';
export default function AppFooter() {
  return <footer className="app-footer"><span>PROJECT <strong>S6</strong><small>Built one part at a time.</small></span><nav aria-label="Footer"><Link to="/community">Community</Link><Link to="/terms">Donation terms</Link><Link to="/privacy">Privacy</Link><Link to="/about">About</Link></nav></footer>;
}
