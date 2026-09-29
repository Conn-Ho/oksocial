import { connect } from 'node:net';

/** True when 127.0.0.1:<port> accepts a TCP connection within `timeoutMs`. Never rejects. */
export function tcpProbe(port: number, { host = '127.0.0.1', timeoutMs = 1_000 }: { host?: string; timeoutMs?: number } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}
