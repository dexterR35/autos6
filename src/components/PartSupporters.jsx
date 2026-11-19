import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { fetchPartSupporters } from '../lib/liveData.js';
import { demoPartSupporters } from '../data/demoProject.js';
import { useProjectData } from '../hooks/useProjectData.jsx';

/** "Funded by": public names behind this part (only people who chose to be shown). */
export default function PartSupporters({ part }) {
  const { project, isDemo, status } = useProjectData();
  const [rows, setRows] = useState(isDemo ? demoPartSupporters[part.id] ?? [] : null);
  useEffect(() => {
    if (isDemo) { setRows(demoPartSupporters[part.id] ?? []); return undefined; }
    if (status !== 'ready' || !project.slug) return undefined;
    let live = true;
    setRows(null);
    fetchPartSupporters(project.slug, part.id).then((r) => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [isDemo, status, project.slug, part.id, part.raisedCents]);
  if (!rows?.length) return null;
  return (
    <section className="funded-by" aria-labelledby={`funded-by-${part.id}`}>
      <h3 id={`funded-by-${part.id}`}><Heart aria-hidden="true" /> Funded by</h3>
      <ul>
        {rows.map((r) => <li key={r.name}>{r.name}</li>)}
      </ul>
    </section>
  );
}
