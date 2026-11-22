/* TUPC bridge: the browser never forwards a local session token directly to TUPC.
 * The production exchange must happen through the Central backend after its
 * contract and trust boundary are approved. */
import { TUPC_BASE_URL } from './config.js';
export const tupcEnabled = () => Boolean(TUPC_BASE_URL);
export async function syncIdentity({ user }) {
  if (!tupcEnabled() || !user) return { ok: false, skipped: true };
  return { ok: false, skipped: true, reason: 'server_exchange_required' };
}
