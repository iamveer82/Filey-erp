import { PublicError, UUID, workspace } from './config.mjs';

export function authenticator(config, fetchFn = fetch) {
  return async (token, org) => {
    let claims;
    try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); } catch { throw new PublicError('Sign in to Filey.', 401); }
    if (token.length > 8192 || !UUID.test(claims.sub) || claims.role !== 'authenticated' || !workspace(org))
      throw new PublicError('Sign in to your cloud workspace.', 401);
    const headers = { apikey: config.anonKey, Authorization: `Bearer ${token}` };
    async function get(path, method = 'GET') {
      let response;
      try { response = await fetchFn(`${config.base}${path}`, { method, headers, redirect: 'error', signal: AbortSignal.timeout(10_000) }); }
      catch { throw new PublicError('Your workspace is temporarily unavailable.', 503); }
      if (!response.ok) { await response.body?.cancel(); throw new PublicError('Sign in to your cloud workspace again.', response.status === 401 ? 401 : 403); }
      return response.json();
    }
    // Decoded claims above are only a reject filter; the verified Auth user is
    // the identity boundary, followed by RLS-backed profile + membership reads.
    const user = await get('/auth/v1/user');
    if (user.id !== claims.sub || !user.email_confirmed_at ||
        (user.factors !== undefined && !Array.isArray(user.factors)) ||
        (claims.aal !== 'aal2' && (user.factors ?? []).some(factor => factor.status === 'verified')))
      throw new PublicError('Verify your account and complete two-step verification.', 403);
    const profiles = await get(`/rest/v1/profiles?select=id,org_id&id=eq.${encodeURIComponent(user.id)}`);
    if (!Array.isArray(profiles) || profiles.length !== 1 || profiles[0].id !== user.id || profiles[0].org_id !== org)
      throw new PublicError('Your workspace changed. Start a new task.', 403);
    const access = await get('/rest/v1/rpc/filey_module_access', 'POST');
    if (access?.allowed !== true) throw new PublicError('Workspace access is unavailable.', 403);
    return { userId: user.id, org, token };
  };
}
