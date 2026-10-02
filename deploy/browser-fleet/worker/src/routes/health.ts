import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.ts';

export function registerHealthRoutes(app: FastifyInstance, { slots, daemonUp, runQueue, dmWatch }: AppDeps): void {
  app.get('/health', async (req, reply) => {
    const [listed, up] = await Promise.all([
      slots.list().then(
        (all) => ({ ok: true as const, count: all.length }),
        (err: Error) => ({ ok: false as const, error: err.message }),
      ),
      daemonUp(),
    ]);
    const daemon = up ? 'up' : 'down';
    if (!listed.ok) {
      req.log.warn({ err: listed.error }, 'health: account-ctl list failed');
      return reply.code(503).send({ ok: false, slots: null, daemon, error: 'account-ctl list failed' });
    }
    const watchers = dmWatch?.statuses();
    return {
      ok: true,
      slots: listed.count,
      daemon,
      runs: runQueue.stats(),
      ...(watchers ? { dmWatch: { watchers: watchers.length, healthy: watchers.filter((w) => w.healthy).length } } : {}),
    };
  });
}
