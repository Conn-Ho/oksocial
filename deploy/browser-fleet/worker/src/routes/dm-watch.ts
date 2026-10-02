import type { FastifyInstance } from 'fastify';
import type { DmWatch } from '../dm-watch/manager.ts';
import { DmWatchBody, DmWatchChangesQuery, parseOrThrow } from '../schemas.ts';

/**
 * Real-time DM watch: PUT the accounts to watch (all of them; the answer says how each watcher is
 * doing), long-poll their changes. See dm-watch/manager.ts.
 */
export function registerDmWatchRoutes(app: FastifyInstance, dmWatch: DmWatch): void {
  app.put('/dm-watch', async (req) => {
    const { accounts } = parseOrThrow(DmWatchBody, req.body);
    return { ok: true, watchers: await dmWatch.setDesired(accounts) };
  });

  app.get('/dm-watch', async () => ({ ok: true, watchers: dmWatch.statuses() }));

  app.get('/dm-watch/changes', async (req, reply) => {
    const { cursor, waitMs } = parseOrThrow(DmWatchChangesQuery, req.query);
    // a caller that gives up stops waiting here too
    const gone = new AbortController();
    reply.raw.once('close', () => {
      if (!reply.raw.writableFinished) gone.abort();
    });
    return { ok: true, ...(await dmWatch.changes(cursor, waitMs, gone.signal)) };
  });

  // shutting down: long polls answer now instead of holding the close for up to a minute
  app.addHook('preClose', async () => {
    await dmWatch.stop();
  });
}
