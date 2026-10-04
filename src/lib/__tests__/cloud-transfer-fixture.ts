// Existing transport tests now exercise an explicitly scoped workspace transfer,
// rather than granting persisted/background local sync any upload authority.
import { withCloudTransfer } from "../cloudTransfer";
import { syncNow, pullNow, syncCycle, pushCollection, pushFileBlobs, resolveSyncConflicts } from "../sync";
import { syncProfile } from "../profileSync";

async function transfer<T>(client: any, run: (permit: any) => Promise<T>): Promise<T> {
  if (!client.auth) client.auth = { getSession: async () => ({ data: { session: { user: { id: "transfer-fixture-owner" }, expires_at: Date.now() / 1000 + 3600 } } }) };
  const session = await client.auth.getSession();
  return withCloudTransfer(client, session.data.session?.user.id || "transfer-fixture-owner", run);
}

export const transferSyncNow: typeof syncNow = (client: any, opts) => transfer(client, permit => syncNow(client, { ...opts, transfer: permit }));
export const transferPullNow: typeof pullNow = (client: any, opts) => transfer(client, permit => pullNow(client, { ...opts, transfer: permit }));
export const transferSyncCycle: typeof syncCycle = (client: any, opts) => transfer(client, permit => syncCycle(client, { ...opts, transfer: permit }));
export const transferPushCollection: typeof pushCollection = (client: any, table, rows, report, uid) => transfer(client, permit => pushCollection(client, table, rows, report, uid, permit));
export const transferPushFileBlobs: typeof pushFileBlobs = (client: any, uid, rows, report) => transfer(client, permit => pushFileBlobs(client, uid, rows, report, permit));
export const transferResolveConflicts: typeof resolveSyncConflicts = (keep, client: any, opts) => transfer(client, permit => resolveSyncConflicts(keep, client, { ...opts, transfer: permit }));
export const transferProfile: typeof syncProfile = (client: any, uid) => transfer(client, permit => syncProfile(client, uid, permit));
