/**
 * noVNC per slot: start/stop routes and the /screen/:slot/* HTTP + WebSocket proxy to the slot's
 * loopback websockify (web port 6080+DISP-10). Caddy authenticates the user and injects the token.
 */
import httpProxy from '@fastify/http-proxy';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app.ts';
import { TOKEN_HEADER } from '../auth.ts';
import { HttpError, notFound } from '../errors.ts';
import { slotParam } from '../schemas.ts';
import { simulatedSlotError } from '../sim.ts';

type SlotParams = { Params: { slot: string } };

/** A screen that was just stopped keeps being served for at most this long (cache age). */
const SCREEN_STATE_MAX_AGE_MS = 5_000;

/** The URL (path + query) the app embeds for a slot's screen. Pure. */
export const screenPath = (slot: string): string => `/screen/${slot}/vnc.html?autoconnect=1&resize=scale&reconnect=1&path=screen/${slot}/websockify`;

export async function registerScreenRoutes(app: FastifyInstance, { slots }: AppDeps): Promise<void> {
  app.post<SlotParams>('/slots/:slot/screen', async (req) => {
    const name = slotParam(req.params.slot);
    await slots.startScreen(name);
    return { path: screenPath(name) };
  });

  app.delete<SlotParams>('/slots/:slot/screen', async (req) => {
    const name = slotParam(req.params.slot);
    await slots.stopScreen(name);
    return { ok: true, slot: name };
  });

  const upstreamPort = new WeakMap<FastifyRequest, number>();
  await app.register(httpProxy, {
    prefix: '/screen/:slot',
    upstream: '',
    websocket: true,
    httpMethods: ['GET', 'HEAD'],
    disableRequestLogging: true,
    preHandler: async (req: FastifyRequest) => {
      const name = slotParam((req.params as { slot?: string }).slot);
      if (slots.isSimulated(name)) throw simulatedSlotError(name);
      const slot = await slots.get(name, SCREEN_STATE_MAX_AGE_MS);
      if (!slot) throw notFound(`slot ${name}`);
      if (!slot.screen) throw new HttpError(502, 'SCREEN_NOT_RUNNING', `screen for slot ${name} is not running (POST /slots/${name}/screen)`);
      upstreamPort.set(req, slot.screenPort);
    },
    replyOptions: {
      getUpstream: (req: FastifyRequest) => `http://127.0.0.1:${upstreamPort.get(req) ?? 0}`,
      rewriteRequestHeaders: (_req: FastifyRequest, headers: Record<string, unknown>) => Object.fromEntries(Object.entries(headers).filter(([k]) => k !== TOKEN_HEADER)),
      onError: (reply: FastifyReply) => {
        void reply.code(502).send({ ok: false, code: 'SCREEN_UNREACHABLE', error: 'screen upstream is not reachable' });
      },
    },
    // websockify needs nothing from the client's headers (the default would forward Caddy's session cookie).
    wsClientOptions: { rewriteRequestHeaders: () => ({}) },
  } as Parameters<typeof httpProxy>[1]);
}
