import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.ts';
import { HttpError } from '../errors.ts';
import { CreateSlotBody, OpenBody, parseOrThrow, ProxyBody, slotParam } from '../schemas.ts';

type SlotParams = { Params: { slot: string } };

export function registerSlotRoutes(app: FastifyInstance, { slots, openTab }: AppDeps): void {
  app.get('/slots', async () => slots.list());

  app.get<SlotParams>('/slots/:slot', async (req) => slots.require(slotParam(req.params.slot)));

  app.post('/slots', async (req, reply) => {
    const body = parseOrThrow(CreateSlotBody, req.body);
    const { slot, created } = await slots.ensure(body.slot, body.proxy);
    return reply.code(created ? 201 : 200).send(slot);
  });

  app.post<SlotParams>('/slots/:slot/proxy', async (req) => {
    const name = slotParam(req.params.slot);
    const { proxy } = parseOrThrow(ProxyBody, req.body);
    return slots.setProxy(name, proxy);
  });

  app.post<SlotParams>('/slots/:slot/start', async (req) => slots.start(slotParam(req.params.slot)));
  app.post<SlotParams>('/slots/:slot/stop', async (req) => slots.stop(slotParam(req.params.slot)));

  app.delete<SlotParams & { Querystring: { purge?: string } }>('/slots/:slot', async (req) => {
    const name = slotParam(req.params.slot);
    const purge = req.query.purge === '1' || req.query.purge === 'true';
    await slots.remove(name, purge);
    return { ok: true, slot: name, purged: purge };
  });

  app.post<SlotParams>('/slots/:slot/open', async (req) => {
    const name = slotParam(req.params.slot);
    const { url } = parseOrThrow(OpenBody, req.body);
    const slot = await slots.require(name);
    if (slot.chrome !== 'active') throw new HttpError(409, 'CHROME_NOT_RUNNING', `slot ${name}: chrome is ${slot.chrome}`);
    const tab = await openTab(slot.cdp, url);
    return { ok: true, targetId: tab.id, url: tab.url };
  });
}
