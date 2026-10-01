/** Chrome DevTools stand-in for CDP tests: /json/list, /json/activate, /json/new and one socket per page. */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';

export type Target = { id: string; type: string; url: string };
/** What the page answers to one call: a result, DROP (the socket closes) or fail(message) (a CDP error). */
export type Answer = (method: string, params: Record<string, unknown>) => unknown;
export const DROP = Symbol('drop the socket');
const FAIL = Symbol('a CDP error');
export const fail = (message: string) => ({ [FAIL]: message });

/** Every page call, in order. */
export interface Call {
  page: string;
  method: string;
  params: Record<string, unknown>;
}

/**
 * Runs `fn` against a fake DevTools endpoint. `log` gets one line per HTTP request and one per page
 * call (`describe` words it; default `<page> <method>`); `calls` keeps the page calls with their params.
 */
export async function withDevtools(
  targets: Target[],
  answer: Answer,
  fn: (port: number, log: string[], calls: Call[]) => Promise<void>,
  describe: (page: string, method: string, params: Record<string, unknown>) => string = (page, method) => `${page} ${method}`
) {
  const log: string[] = [];
  const calls: Call[] = [];
  let port = 0;
  const server = createServer((req, res) => {
    log.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/json/list') {
      res.end(JSON.stringify(targets.map((t) => ({ ...t, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${t.id}` }))));
    } else if (req.url?.startsWith('/json/new')) {
      res.end(JSON.stringify({ id: 'NEW', url: decodeURIComponent(req.url.split('?')[1] ?? '') }));
    } else {
      res.end('{}');
    }
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket, req) => {
    const page = req.url?.split('/').pop() ?? '';
    socket.on('message', (raw) => {
      const { id, method, params } = JSON.parse(String(raw));
      calls.push({ page, method, params });
      log.push(describe(page, method, params));
      const result = answer(method, params);
      if (result === DROP) return socket.close();
      if (result && typeof result === 'object' && FAIL in result) {
        return socket.send(JSON.stringify({ id, error: { message: (result as Record<symbol, string>)[FAIL] } }));
      }
      socket.send(JSON.stringify({ id, result: result ?? {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  try {
    await fn(port, log, calls);
  } finally {
    for (const c of wss.clients) c.terminate();
    wss.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
