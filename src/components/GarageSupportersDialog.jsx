import Modal from './Modal.jsx';
import { formatSupporterAmount } from '../lib/garageSupportersData.js';

export default function GarageSupportersDialog({ open, onClose, supporters }) {
  const { rows, state, scope, isDemo, reload } = supporters;
  return (
    <Modal open={open} onClose={onClose} title="The people behind the build" labelledBy="garage-supporters-title" className="supporter-wall-dialog">
      <p className="kicker">Project S6 · Garage supporters</p>
      <p className="muted">Every contribution helps bring the S6 back. Repeat contributions appear as 2× Name, 3× Name, with the total donated.</p>
      {scope === 'recent' && <p className="note">Showing the latest 100 public contributions. Matching display names are combined in this recent list.</p>}
      {state === 'loading' && <p role="status">Loading supporters…</p>}
      {state === 'error' && <div role="status"><p>The supporter wall is temporarily unavailable.</p><button className="btn btn--ghost" onClick={reload}>Try again</button></div>}
      {state === 'ready' && rows.length === 0 && <div className="empty"><p>{isDemo ? 'Demo mode has no supporter records.' : 'Your name belongs on this wall.'}</p><p className="fine">Names appear after confirmed contributions from supporters who chose to be listed.</p></div>}
      {rows.length > 0 && <div className="supporter-wall-table-scroll" tabIndex={0} role="region" aria-label="Supporter table">
        <table className="supporter-wall-table">
          <caption>{scope === 'recent' ? 'Recent public supporters' : 'All public supporters'}</caption>
          <thead><tr><th scope="col">Supporter</th><th scope="col">Email</th><th scope="col">Donated</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><th scope="row">{row.label}</th><td className="muted">Hidden</td><td>{formatSupporterAmount(row)}</td></tr>)}</tbody>
        </table>
      </div>}
      <p className="fine">Only supporters who opted into the public list appear here. Email addresses stay private.</p>
    </Modal>
  );
}
