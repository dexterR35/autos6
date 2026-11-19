import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Trophy, Vote } from 'lucide-react';
import { fetchPolls } from '../lib/liveData.js';
import { demoPolls } from '../data/demoProject.js';
import { supabase } from '../lib/supabase.js';
import { formatCents } from '../lib/money.js';
import { safeMediaUrl } from '../lib/safeMedia.js';
import { useProjectData } from '../hooks/useProjectData.jsx';

const ERRORS = {
  sign_in_required: 'Sign in to vote.',
  email_unconfirmed: 'Confirm your email first, then vote.',
  poll_closed: 'This vote has closed.',
};

/** Supporters vote between part options; the owner turns the winner into a part card. */
export default function PollsSection({ session, onNeedSignIn }) {
  const { project, parts, isDemo, status: projectStatus } = useProjectData();
  const [polls, setPolls] = useState(isDemo ? demoPolls : []);
  const [state, setState] = useState(isDemo ? 'ready' : 'loading');
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState('');
  const currency = project.currency ?? 'usd';
  const userId = session?.user?.id ?? null;

  const load = useCallback(async () => {
    if (isDemo) return;
    if (projectStatus !== 'ready' || !project.id) return;
    try {
      setPolls(await fetchPolls(project.slug, project.id, userId));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [isDemo, projectStatus, project.id, project.slug, userId]);
  useEffect(() => { load(); }, [load]);

  const vote = async (poll, optionId) => {
    setMessage('');
    if (isDemo) {
      setPolls((list) => list.map((p) => (p.id !== poll.id ? p : {
        ...p, myVote: optionId,
        options: p.options.map((o) => ({ ...o, votes: o.votes + (o.id === optionId ? 1 : 0) - (o.id === p.myVote ? 1 : 0) })),
        totalVotes: p.totalVotes + (p.myVote ? 0 : 1),
      })));
      setMessage('Demo mode: votes are not saved.');
      return;
    }
    if (!session) { onNeedSignIn?.(); return; }
    setBusy(poll.id);
    const { error } = await supabase.rpc('cast_poll_vote', { p_poll_id: poll.id, p_option_id: optionId });
    setBusy(null);
    if (error) { setMessage(Object.entries(ERRORS).find(([k]) => error.message.includes(k))?.[1] ?? 'Your vote could not be saved. Please try again.'); return; }
    setMessage('Vote saved. You can change it until the vote closes.');
    load();
  };

  if (state === 'error' || (state === 'ready' && polls.length === 0)) return null;
  if (state === 'loading') return null;
  const partByDbId = Object.fromEntries(parts.map((p) => [p.dbId, p]));

  return (
    <section className="polls" aria-labelledby="polls-title">
      <h2 id="polls-title"><Vote aria-hidden="true" /> Vote on what comes next</h2>
      {message && <p className="form-note" role="status">{message}</p>}
      {polls.map((poll) => {
        const showResults = poll.status === 'closed' || poll.myVote;
        const max = Math.max(1, ...poll.options.map((o) => o.votes));
        return (
          <article key={poll.id} className="panel poll">
            <header className="poll__head">
              <h3>{poll.question}</h3>
              <p className="fine">
                {poll.status === 'closed' ? 'Closed' : poll.closesAt ? `Closes ${new Date(poll.closesAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : 'Open'}
                {' · '}{poll.totalVotes} vote{poll.totalVotes === 1 ? '' : 's'}
              </p>
              {poll.description && <p className="muted">{poll.description}</p>}
            </header>
            <ul className="poll__options">
              {poll.options.map((o) => {
                const pct = poll.totalVotes ? Math.round((o.votes / poll.totalVotes) * 100) : 0;
                const winner = poll.winnerOptionId === o.id;
                const created = o.partDbId ? partByDbId[o.partDbId] : null;
                const mine = poll.myVote === o.id;
                return (
                  <li key={o.id} className={`poll__option ${mine ? 'is-mine' : ''} ${winner ? 'is-winner' : ''}`}>
                    {safeMediaUrl(o.imageUrl) && <img src={safeMediaUrl(o.imageUrl)} alt="" loading="lazy" />}
                    <div className="poll__text">
                      <strong>{o.label}{winner && <span className="poll__winner"><Trophy aria-hidden="true" /> Winner</span>}</strong>
                      {o.description && <span className="muted">{o.description}</span>}
                      {o.estimateCents && <span className="fine">About {formatCents(o.estimateCents, currency)}</span>}
                      {created && <Link to={`/parts/${created.id}`} className="fine">Now a part card: {created.name} →</Link>}
                      {showResults && (
                        <span className="poll__bar" style={{ '--w': `${(o.votes / max) * 100}%` }}>
                          <span className="visually-hidden">{o.votes} votes, </span>{pct}%
                        </span>
                      )}
                    </div>
                    {poll.status === 'open' && (
                      <button type="button" className={`btn btn--sm ${mine ? 'btn--primary' : 'btn--ghost'}`} disabled={busy === poll.id}
                        aria-pressed={mine} aria-label={`Vote for ${o.label}`} onClick={() => vote(poll, o.id)}>
                        {mine ? <><Check aria-hidden="true" /> Your vote</> : 'Vote'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {poll.status === 'open' && !session && !isDemo && <p className="fine">Sign in with your email to vote — one vote per person.</p>}
          </article>
        );
      })}
    </section>
  );
}
