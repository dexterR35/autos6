// Provider callback descriptions are untrusted. Display our own fixed copy.
export function authCallbackError(hash = '') {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('error') && !params.has('error_code')) return null;
  return params.get('error_code') === 'otp_expired'
    ? 'This sign-in link is invalid, expired, or already used. Use the newest email, or request a fresh link below.'
    : 'The email sign-in could not be completed. Please request a fresh link below.';
}
