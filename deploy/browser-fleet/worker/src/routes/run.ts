import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.ts';
import { HttpError } from '../errors.ts';
import { QueueAbortedError } from '../queue.ts';
import { parseOrThrow, RunBody, slotParam } from '../schemas.ts';

export function registerRunRoutes(app: FastifyInstance, { slots, runner, runAllowedSites }: AppDeps): void {
  app.post<{ Params: { slot: string } }>('/slots/:slot/run', async (req, reply) => {
    // A client that gives up while the run is still queued must not have it run later (double posts).
    const gone = new AbortController();
    reply.raw.once('close', () => {
      if (!reply.raw.writableFinished) gone.abort();
    });
    const name = slotParam(req.params.slot);
    const { args, timeoutMs } = parseOrThrow(RunBody, req.body);
    if (runAllowedSites && !runAllowedSites.has(args[0] ?? '')) throw new HttpError(403, 'SITE_NOT_ALLOWED', `"${args[0]}" is not in RUN_ALLOWED_SITES`);
    let slot = await slots.require(name);
    if (!slot.profileId) slot = await slots.require(name, 0); // the extension may have just registered
    const profileId = slot.profileId;
    if (!profileId) throw new HttpError(400, 'NO_PROFILE', `slot ${name} has no bridge profile id yet (is its Chrome running with the extension?)`);

    if (gone.signal.aborted) throw new QueueAbortedError();
    const outcome = await runner({ slot, profileId, args, timeoutMs, signal: gone.signal, log: req.log });
    // Only site + command are logged: later args carry user content.
    req.log.info({ slot: name, command: args.slice(0, 2).join(' '), ok: outcome.ok, code: outcome.ok ? undefined : outcome.code, durationMs: outcome.durationMs }, 'opencli run');
    return outcome;
  });
}
