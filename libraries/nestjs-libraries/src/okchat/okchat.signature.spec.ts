import {
  OKCHAT_SIGNATURE_HEADER,
  OKCHAT_TIMESTAMP_HEADER,
  SIGNATURE_TOLERANCE_SECONDS,
  signOkchat,
  signedHeaders,
  verifyOkchat,
} from '@gitroom/nestjs-libraries/okchat/okchat.signature';

// Fixed vectors both sides check against (okchat contract §4). The first is the shared one.
const VECTORS = [
  {
    secret: 'test-partner-secret',
    ts: 1759400000,
    body: '{"a":1}',
    signature: 'sha256=6f9ea36869b10d2c27d5bef050146e2dce0d7db7773adc530a5c9c10e88fc2ab',
  },
  {
    secret: 'test-partner-secret',
    ts: 1759400000,
    body: '',
    signature: 'sha256=1ecdf5f16e86399aca1389cf7d193c7b1f39138a12321e9e8412b6a1f4de07fd',
  },
  {
    // UTF-8 bytes of the body, not UTF-16 units
    secret: 'test-partner-secret',
    ts: 1759400000,
    body: '{"text":"你好"}',
    signature: 'sha256=57b680bddbd508d12fccc6f78fe529f8bd6af8a36df2ceaecd3fd70a1a8250d0',
  },
];

describe('okchat partner signature', () => {
  it('matches the fixed vectors (printed for the okchat side)', () => {
    for (const v of VECTORS) {
      const signature = signOkchat(v.secret, v.ts, v.body);
      // eslint-disable-next-line no-console
      console.log(`okchat signature vector: secret=${v.secret} ts=${v.ts} body=${JSON.stringify(v.body)} -> ${signature}`);
      expect(signature).toBe(v.signature);
      expect(signOkchat(v.secret, String(v.ts), Buffer.from(v.body, 'utf8'))).toBe(v.signature);
    }
  });

  it('verifies the raw bytes within the 300 second window', () => {
    const [v] = VECTORS;
    const at = (now: number) =>
      verifyOkchat({ secret: v.secret, timestamp: String(v.ts), signature: v.signature, rawBody: Buffer.from(v.body), now: now * 1000 });
    expect(SIGNATURE_TOLERANCE_SECONDS).toBe(300);
    expect(at(v.ts)).toBe(true);
    expect(at(v.ts + 300)).toBe(true);
    expect(at(v.ts - 300)).toBe(true);
    expect(at(v.ts + 301)).toBe(false);
    expect(at(v.ts - 301)).toBe(false);
  });

  it('refuses a tampered body, a wrong secret, a malformed or missing header', () => {
    const [v] = VECTORS;
    const base = { secret: v.secret, timestamp: String(v.ts), signature: v.signature, rawBody: Buffer.from(v.body), now: v.ts * 1000 };
    expect(verifyOkchat(base)).toBe(true);
    // re-serialized JSON is other bytes: signatures are over what was sent
    expect(verifyOkchat({ ...base, rawBody: Buffer.from('{ "a": 1 }') })).toBe(false);
    expect(verifyOkchat({ ...base, rawBody: Buffer.from('{"a":2}') })).toBe(false);
    expect(verifyOkchat({ ...base, secret: 'other-secret' })).toBe(false);
    expect(verifyOkchat({ ...base, signature: v.signature.replace('sha256=', '') })).toBe(false);
    expect(verifyOkchat({ ...base, signature: v.signature.slice(0, -2) })).toBe(false);
    expect(verifyOkchat({ ...base, signature: v.signature.toUpperCase() })).toBe(false);
    expect(verifyOkchat({ ...base, signature: undefined })).toBe(false);
    expect(verifyOkchat({ ...base, timestamp: undefined })).toBe(false);
    expect(verifyOkchat({ ...base, timestamp: '1759400000.5' })).toBe(false);
    expect(verifyOkchat({ ...base, timestamp: 'abc' })).toBe(false);
    expect(verifyOkchat({ ...base, rawBody: undefined })).toBe(false);
    // no secret configured: nothing verifies
    expect(verifyOkchat({ ...base, secret: '' })).toBe(false);
  });

  it('signedHeaders gives the two headers for a body sent now', () => {
    const headers = signedHeaders('test-partner-secret', '{"a":1}', 1759400000 * 1000);
    expect(headers).toEqual({
      'content-type': 'application/json',
      [OKCHAT_TIMESTAMP_HEADER]: '1759400000',
      [OKCHAT_SIGNATURE_HEADER]: VECTORS[0].signature,
    });
    expect(OKCHAT_TIMESTAMP_HEADER).toBe('x-okchat-timestamp');
    expect(OKCHAT_SIGNATURE_HEADER).toBe('x-okchat-signature');
  });
});
