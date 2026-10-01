import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.ts';
import { HttpError } from '../errors.ts';
import { CreateSlotBody, LoginFormBody, OpenBody, parseHintsQuery, parseOrThrow, ProxyBody, slotParam } from '../schemas.ts';
import { presentCookieNames, readCookies } from '../cdp.ts';
import { simulatedSlotError } from '../sim.ts';

const DOMAIN_RE = /^[a-z0-9.-]{3,100}$/i;
const COOKIE_NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;
const REVEAL_MAX = 200;

type SlotParams = { Params: { slot: string } };

export function registerSlotRoutes(app: FastifyInstance, { slots, openTab, captureQr, probeLoginForm, fillLoginForm }: AppDeps): void {
  // The tab each slot's login screen shows (this process): the next open reuses it.
  const screenTabs = new Map<string, string>();
  // Slots whose login page got its `reveal` click since it was opened: some are toggles (SMS ⇄ QR),
  // so a second click while the code is still rendering would switch it away again.
  const revealed = new Set<string>();
  // Slots whose login form is being typed into: one submit at a time, or two would interleave keys.
  const filling = new Set<string>();

  const activeSlot = async (name: string) => {
    if (slots.isSimulated(name)) throw simulatedSlotError(name);
    const slot = await slots.require(name);
    if (slot.chrome !== 'active') throw new HttpError(409, 'CHROME_NOT_RUNNING', `slot ${name}: chrome is ${slot.chrome}`);
    return slot;
  };

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

  // Login detection while someone scans a QR code: which of the given login cookies exist, without
  // touching any tab (opencli would navigate the page they are looking at). Names only, never values.
  app.get<SlotParams & { Querystring: { domain?: string; names?: string } }>('/slots/:slot/login-cookies', async (req) => {
    const name = slotParam(req.params.slot);
    const domain = req.query.domain ?? '';
    const names = (req.query.names ?? '').split(',').filter(Boolean).slice(0, 10);
    if (!DOMAIN_RE.test(domain) || !names.length || !names.every((n) => COOKIE_NAME_RE.test(n))) {
      throw new HttpError(400, 'BAD_REQUEST', 'domain and names are required');
    }
    // a simulated account has no Chrome: report the cookies and let whoami (the simulator) decide
    if (slots.isSimulated(name)) return { present: names };
    const slot = await slots.require(name);
    if (slot.chrome !== 'active') throw new HttpError(409, 'CHROME_NOT_RUNNING', `slot ${name}: chrome is ${slot.chrome}`);
    return { present: presentCookieNames(await readCookies(slot.cdp), domain, names) };
  });

  app.post<SlotParams>('/slots/:slot/start', async (req) => slots.start(slotParam(req.params.slot)));
  app.post<SlotParams>('/slots/:slot/stop', async (req) => slots.stop(slotParam(req.params.slot)));

  app.delete<SlotParams & { Querystring: { purge?: string } }>('/slots/:slot', async (req) => {
    const name = slotParam(req.params.slot);
    const purge = req.query.purge === '1' || req.query.purge === 'true';
    await slots.remove(name, purge);
    screenTabs.delete(name);
    revealed.delete(name);
    return { ok: true, slot: name, purged: purge };
  });

  app.post<SlotParams>('/slots/:slot/open', async (req) => {
    const name = slotParam(req.params.slot);
    const { url } = parseOrThrow(OpenBody, req.body);
    if (slots.isSimulated(name)) throw simulatedSlotError(name);
    const slot = await slots.require(name);
    if (slot.chrome !== 'active') throw new HttpError(409, 'CHROME_NOT_RUNNING', `slot ${name}: chrome is ${slot.chrome}`);
    const tab = await openTab(slot.cdp, url, screenTabs.get(name));
    screenTabs.set(name, tab.id);
    revealed.delete(name);
    return { ok: true, targetId: tab.id, url: tab.url };
  });

  // The login QR code of the screen tab as an image, for the login dialog to show it large. When
  // none is visible, `reveal` (a CSS selector) is clicked first. A simulated account has no page.
  app.get<SlotParams & { Querystring: { reveal?: string } }>('/slots/:slot/qr', async (req) => {
    const name = slotParam(req.params.slot);
    const reveal = req.query.reveal || undefined;
    if (reveal && reveal.length > REVEAL_MAX) throw new HttpError(400, 'BAD_REQUEST', 'reveal selector too long');
    if (slots.isSimulated(name)) return { image: null };
    const slot = await slots.require(name);
    if (slot.chrome !== 'active') throw new HttpError(409, 'CHROME_NOT_RUNNING', `slot ${name}: chrome is ${slot.chrome}`);
    const qr = await captureQr(slot.cdp, screenTabs.get(name), revealed.has(name) ? undefined : reveal);
    if (qr.revealed) revealed.add(name);
    return { image: qr.image };
  });

  // oksocial's own login form for password platforms: the step the screen tab's login page is on, with
  // the page's prompt and errors (GET), and one step typed in and submitted (POST). The typed value is
  // only in the POST body: it is never logged (see redact.ts), stored or answered back.
  app.get<SlotParams & { Querystring: { hints?: string } }>('/slots/:slot/login-form', async (req) => {
    const name = slotParam(req.params.slot);
    const hints = parseHintsQuery(req.query.hints);
    const slot = await activeSlot(name);
    return probeLoginForm(slot.cdp, screenTabs.get(name), hints);
  });

  app.post<SlotParams>('/slots/:slot/login-form', async (req) => {
    const name = slotParam(req.params.slot);
    const { step, value, hints } = parseOrThrow(LoginFormBody, req.body);
    const slot = await activeSlot(name);
    if (filling.has(name)) throw new HttpError(409, 'BUSY', `slot ${name}: the login form is still being filled in`);
    filling.add(name);
    try {
      return await fillLoginForm(slot.cdp, screenTabs.get(name), { step, value, hints: hints ?? {} });
    } finally {
      filling.delete(name);
    }
  });
}
