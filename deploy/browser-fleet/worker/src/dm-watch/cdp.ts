/**
 * The DM watch's view of a slot's Chrome, over its DevTools port on 127.0.0.1 (the same one the
 * login screen uses). Its tab lives in a window of its own: the bridge extension only ever leases
 * tabs it created in its own automation window and never adopts, reuses or closes other tabs.
 */
import { browserSocketUrl, listTargets, openPageSession, withPageSocket } from '../cdp.ts';
import type { FetchLike } from '../cdp.ts';
import { HttpError } from '../errors.ts';
import type { WatchBrowser, WatchPage } from './manager.ts';
import { BINDING, OBSERVER } from './page.ts';

async function browserCall(cdpPort: number, method: string, params: Record<string, unknown>, fetchImpl: FetchLike) {
  return withPageSocket(await browserSocketUrl(cdpPort, fetchImpl), (call) => call(method, params));
}

export function createCdpWatchBrowser({ fetchImpl = fetch, observer = OBSERVER }: { fetchImpl?: FetchLike; observer?: string } = {}): WatchBrowser {
  return {
    async pages(cdpPort) {
      return (await listTargets(cdpPort, fetchImpl)).filter((t) => t.type === 'page').map(({ id, url }) => ({ id, url }));
    },

    async openWindow(cdpPort, url) {
      const created = await browserCall(cdpPort, 'Target.createTarget', { url, newWindow: true, background: true }, fetchImpl);
      if (typeof created?.targetId !== 'string') throw new HttpError(502, 'CHROME_ERROR', 'Chrome DevTools returned no target id');
      return created.targetId;
    },

    async closeTab(cdpPort, targetId) {
      await browserCall(cdpPort, 'Target.closeTarget', { targetId }, fetchImpl);
    },

    async attach(cdpPort, targetId, onReport) {
      const target = (await listTargets(cdpPort, fetchImpl)).find((t) => t.id === targetId && t.type === 'page');
      if (!target?.webSocketDebuggerUrl) throw new HttpError(502, 'CHROME_ERROR', 'the watcher tab is gone');
      const session = await openPageSession(target.webSocketDebuggerUrl, (method, params) => {
        if (method === 'Runtime.bindingCalled' && params.name === BINDING && typeof params.payload === 'string') onReport(params.payload);
      });
      try {
        // binding calls are delivered to a session with the runtime enabled
        await session.call('Runtime.enable');
        await session.call('Page.enable');
        await session.call('Runtime.addBinding', { name: BINDING });
        await session.call('Page.addScriptToEvaluateOnNewDocument', { source: observer });
        await session.call('Runtime.evaluate', { expression: observer, returnByValue: true });
      } catch (err) {
        session.close();
        throw err;
      }
      const page: WatchPage = {
        targetId,
        closed: session.closed,
        isOpen: session.isOpen,
        async evaluate(expression) {
          const res = await session.call('Runtime.evaluate', { expression, returnByValue: true });
          return res?.result?.value;
        },
        async navigate(url) {
          await session.call('Page.navigate', { url });
        },
        close: session.close,
      };
      return page;
    },
  };
}
