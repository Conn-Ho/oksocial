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

  it('says okcli, never opencli, in what a failed run tells the user', async () => {
    const failure = { ok: false, code: 'FAILED', message: 'Run "opencli browser bind" again (OpenCLI bridge)', help: 'see opencli doctor', durationMs: 1 };
    const client = new BrowserFleetClient('http://w', 't', (() => reply(200, failure)) as any);
    expect(await client.run('s1', ['x', 'y'])).toEqual({ ...failure, message: 'Run "okcli browser bind" again (okcli bridge)', help: 'see okcli doctor' });
  });

  it('sets the DM-watched accounts with PUT and long-polls their changes with a deadline past the wait', async () => {
    const fetchImpl = jest.fn((url: string) =>
      url.includes('/changes')
        ? reply(200, { ok: true, cursor: 'b1:4', changes: [{ slot: 's1', key: 'i1', at: '2026-10-03T06:00:00.000Z' }] })
        : reply(200, { ok: true, watchers: [{ slot: 's1', key: 'i1', healthy: true, phase: 'watching', page: 'list', reason: null }] })
    );
    const client = new BrowserFleetClient('http://w', 't', fetchImpl as any);
    expect(await client.dmWatch([{ slot: 's1', key: 'i1' }])).toEqual({
      ok: true,
      watchers: [{ slot: 's1', key: 'i1', healthy: true, phase: 'watching', page: 'list', reason: null }],
    });
    const [url, init] = fetchImpl.mock.calls[0] as any;
    expect([url, init.method, JSON.parse(init.body)]).toEqual(['http://w/dm-watch', 'PUT', { accounts: [{ slot: 's1', key: 'i1' }] }]);
    expect(await client.dmWatchChanges('b1:3', 50_000)).toEqual({ ok: true, cursor: 'b1:4', changes: [{ slot: 's1', key: 'i1', at: '2026-10-03T06:00:00.000Z' }] });
    expect((fetchImpl.mock.calls[1] as any)[0]).toBe('http://w/dm-watch/changes?waitMs=50000&cursor=b1%3A3');
    await client.dmWatchChanges(null, 0);
    expect((fetchImpl.mock.calls[2] as any)[0]).toBe('http://w/dm-watch/changes?waitMs=0');
  });

  it('a worker without the DM watch is a 404 BrowserFleetError', async () => {
    const client = new BrowserFleetClient('http://w', 't', (() => reply(404, { ok: false, code: 'NOT_FOUND', error: 'route not found' })) as any);
    await expect(client.dmWatch([])).rejects.toEqual(expect.objectContaining({ status: 404, code: 'NOT_FOUND' }));
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

  it('reads the login form with its hints in the query, and posts a step with the value in the body only', async () => {
    const state = { step: 'password', prompt: 'Enter your password', detail: null, error: null, field: null };
    const fetchImpl = jest.fn(() => reply(200, state));
    const client = new BrowserFleetClient('http://w', 't', fetchImpl as any);
    const hints = { loginUrls: ['x.com/i/flow/'], submit: '[data-testid="LoginForm_Login_Button"]' };
    expect(await client.loginForm('s1', hints)).toEqual(state);
    const [readUrl, readInit] = fetchImpl.mock.calls[0] as any;
    expect(readInit.method).toBe('GET');
    expect(JSON.parse(new URL(readUrl).searchParams.get('hints') as string)).toEqual(hints);

    const secret = 'p@ss word/?&#';
    await client.loginFormSubmit('s1', 'password', secret, hints);
    const [url, init] = fetchImpl.mock.calls[1] as any;
    expect(url).toBe('http://w/slots/s1/login-form');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ step: 'password', value: secret, hints });
    expect(url).not.toContain('ss');
  });

  it("keeps the worker's error code on a failure", async () => {
    const client = new BrowserFleetClient('http://w', 't', (() => reply(409, { ok: false, code: 'BUSY', error: 'still typing' })) as any);
    await expect(client.loginFormSubmit('s1', 'code', '123456', {})).rejects.toEqual(
      expect.objectContaining({ status: 409, code: 'BUSY', message: 'still typing' })
    );
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
