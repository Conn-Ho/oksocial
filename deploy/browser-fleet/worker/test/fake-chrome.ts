/**
 * A Chrome DevTools stand-in for the DM watch: /json/list, /json/version, the browser socket
 * (Target.createTarget / closeTarget) and one socket per page that records every call. Tests answer
 * page calls with `answer` and push events (Runtime.bindingCalled) with `emit`.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

export interface FakeTarget {
  id: string;
  type: string;
  url: string;
}

export interface Call {
  target: string;
  method: string;
  params: Record<string, unknown>;
}

export interface FakeChrome {
  port: number;
  targets: FakeTarget[];
  calls: Call[];
  /** What a page answers to a call (default `{}`); throw to answer a CDP error. */
  answer: (target: string, method: string, params: Record<string, unknown>) => unknown;
  /** Sends an event on every socket of a page. */
  emit(target: string, method: string, params: Record<string, unknown>): void;
  /** Chrome goes away: every socket closes and every tab is gone. */
  kill(): void;
  close(): Promise<void>;
}

export async function startFakeChrome(initial: FakeTarget[] = []): Promise<FakeChrome> {
  const sockets = new Map<string, Set<WebSocket>>();
  let created = 0;
  let port = 0;
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/json/list') {
      res.end(JSON.stringify(chrome.targets.map((t) => ({ ...t, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${t.id}` }))));
    } else if (req.url === '/json/version') {
      res.end(JSON.stringify({ Browser: 'Chrome/140', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/B` }));
    } else {
      res.end('{}');
    }
  });
  const wss = new WebSocketServer({ server });
  const browserCall = (method: string, params: Record<string, unknown>): unknown => {
    if (method === 'Target.createTarget') {
      created += 1;
      const id = `NEW${created}`;
      chrome.targets = [...chrome.targets, { id, type: 'page', url: String(params.url) }];
      return { targetId: id };
    }
    if (method === 'Target.closeTarget') {
      chrome.targets = chrome.targets.filter((t) => t.id !== params.targetId);
      for (const s of sockets.get(String(params.targetId)) ?? []) s.close();
      return { success: true };
    }
    return {};
  };
  wss.on('connection', (socket, req) => {
    const [, , kind, target = ''] = (req.url ?? '').split('/');
    if (kind === 'page' && !chrome.targets.some((t) => t.id === target)) return socket.close();
    sockets.set(target, new Set([...(sockets.get(target) ?? []), socket]));
    socket.on('close', () => sockets.get(target)?.delete(socket));
    socket.on('message', (raw) => {
      const { id, method, params = {} } = JSON.parse(String(raw));
      chrome.calls.push({ target: kind === 'browser' ? 'browser' : target, method, params });
      try {
        const result = kind === 'browser' ? browserCall(method, params) : chrome.answer(target, method, params);
        socket.send(JSON.stringify({ id, result: result ?? {} }));
      } catch (err) {
        socket.send(JSON.stringify({ id, error: { message: (err as Error).message } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  const chrome: FakeChrome = {
    port,
    targets: initial,
    calls: [],
    answer: () => ({}),
    emit(target, method, params) {
      for (const s of sockets.get(target) ?? []) s.send(JSON.stringify({ method, params }));
    },
    kill() {
      chrome.targets = [];
      for (const set of sockets.values()) for (const s of set) s.terminate();
    },
    async close() {
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  return chrome;
}

/** Waits until `check` holds (a socket event to arrive), at most `ms`. */
export async function until(check: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
