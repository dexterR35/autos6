import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="page page--narrow">
      <h1>Page not found</h1>
      <p className="muted">That page isn’t in the garage.</p>
      <Link className="btn btn--primary" to="/">Back to the garage</Link>
    </div>
  );
}
