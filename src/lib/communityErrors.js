// create_community_post raises short messages written for members (SQLSTATE P0001).
// Anything else, such as a check-constraint name or a network failure, gets fixed copy.
export function communityPostError(err) {
  if (err?.code === 'P0001' && typeof err.message === 'string' && err.message.length <= 120) return err.message;
  if (err?.code === '23514') return 'Check your name (2–40 characters), title (3–140) and message (10–4,000 characters), then try again.';
  return 'Could not submit. Please try again.';
}
