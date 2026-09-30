import {
  BrowserFleetClient,
  BrowserFleetError,
  isRunFailure,
} from '@gitroom/nestjs-libraries/browser/browser.fleet.client';

const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(body === undefined ? '' : JSON.stringify(body), { status }));

describe('BrowserFleetClient', () => {
  it('sends the worker token and the run request for a slot', async () => {
    const fetchImpl = jest.fn(() => reply(200, { ok: true, data: [{ a: 1 }], durationMs: 5 }));
    const client = new BrowserFleetClient('http://worker:7788', 'secret', fetchImpl as any);

    const res = await client.run('s1', ['xhs2', 'me'], 60_000);

    expect(res).toEqual({ ok: true, data: [{ a: 1 }], durationMs: 5 });
    const [url, init] = fetchImpl.mock.calls[0] as any;
    expect(url).toBe('http://worker:7788/slots/s1/run');
    expect(init.method).toBe('POST');
    expect(init.headers['x-worker-token']).toBe('secret');
    expect(JSON.parse(init.body)).toEqual({ args: ['xhs2', 'me'], timeoutMs: 60_000 });
  });

  it('throws BrowserFleetError with the worker message on a non-2xx reply', async () => {
    const client = new BrowserFleetClient(
      'http://worker:7788',
      'secret',
      (() => reply(404, { message: 'no such slot' })) as any
    );
    await expect(client.getSlot('nope')).rejects.toEqual(
      expect.objectContaining({ message: 'no such slot', status: 404 })
    );
    await expect(client.getSlot('nope')).rejects.toBeInstanceOf(BrowserFleetError);
  });

  it('adds purge only when asked and posts proxy changes', async () => {
    const fetchImpl = jest.fn(() => reply(200, { ok: true }));
    const client = new BrowserFleetClient('http://w', 't', fetchImpl as any);
    await client.removeSlot('s1', true);
    await client.removeSlot('s2');
    await client.setProxy('s1', null);
    expect((fetchImpl.mock.calls[0] as any)[0]).toBe('http://w/slots/s1?purge=1');
    expect((fetchImpl.mock.calls[1] as any)[0]).toBe('http://w/slots/s2');
    expect(JSON.parse((fetchImpl.mock.calls[2] as any)[1].body)).toEqual({ proxy: null });
  });

  it('asks for the login QR code, with the selector that reveals it', async () => {
    const fetchImpl = jest.fn(() => reply(200, { image: 'data:image/png;base64,UE5H' }));
    const client = new BrowserFleetClient('http://w', 't', fetchImpl as any);
    expect(await client.qr('s1', '.sso-login-wrapper img')).toBe('data:image/png;base64,UE5H');
    expect(await client.qr('s1')).toBe('data:image/png;base64,UE5H');
    expect((fetchImpl.mock.calls as any)[0][0]).toBe('http://w/slots/s1/qr?reveal=.sso-login-wrapper+img');
    expect((fetchImpl.mock.calls as any)[1][0]).toBe('http://w/slots/s1/qr');
  });

  it('is only configured with a token', () => {
    expect(new BrowserFleetClient('http://w', '').configured).toBe(false);
    expect(new BrowserFleetClient('http://w', 'x').configured).toBe(true);
  });

  it('isRunFailure tells failures from successes', () => {
    expect(isRunFailure({ ok: true, data: 1, durationMs: 1 })).toBe(false);
    expect(
      isRunFailure({ ok: false, code: 'TIMEOUT', exitCode: 75, message: '', durationMs: 1 })
    ).toBe(true);
  });
});
