import { createHmac, timingSafeEqual } from 'node:crypto';

// okchat partner requests, both ways (okchat contract §4): X-Okchat-Timestamp is unix seconds and
// X-Okchat-Signature is "sha256=" + hex(HMAC-SHA256(secret, "<ts>.<raw body>")). The receiver checks
// the bytes it got, never a re-serialized body.
export const OKCHAT_TIMESTAMP_HEADER = 'x-okchat-timestamp';
export const OKCHAT_SIGNATURE_HEADER = 'x-okchat-signature';
// a request older or newer than this is refused
export const SIGNATURE_TOLERANCE_SECONDS = 300;
const SIGNATURE_FORMAT = /^sha256=[0-9a-f]{64}$/;

/** The signature of a body sent at `ts` (unix seconds). Pure. */
export const signOkchat = (secret: string, ts: number | string, rawBody: string | Buffer) =>
  'sha256=' +
  createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${ts}.`, 'utf8'), Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8')]))
    .digest('hex');

/**
 * Whether a request's timestamp is within SIGNATURE_TOLERANCE_SECONDS of `now` and its signature is
 * the one of its raw body (compared in constant time). False without a secret. Pure.
 */
export const verifyOkchat = (input: {
  secret: string;
  timestamp?: string;
  signature?: string;
  rawBody?: Buffer | string;
  now?: number;
}) => {
  const { secret, timestamp, signature, rawBody, now = Date.now() } = input;
  if (!secret || !timestamp || !signature || rawBody === undefined || rawBody === null) {
    return false;
  }
  if (!/^\d{1,12}$/.test(timestamp) || !SIGNATURE_FORMAT.test(signature)) {
    return false;
  }
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  const expected = Buffer.from(signOkchat(secret, timestamp, rawBody), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
};

/** Headers of a JSON body oksocial sends to okchat now. */
export const signedHeaders = (secret: string, body: string, now = Date.now()) => {
  const ts = String(Math.floor(now / 1000));
  return {
    'content-type': 'application/json',
    [OKCHAT_TIMESTAMP_HEADER]: ts,
    [OKCHAT_SIGNATURE_HEADER]: signOkchat(secret, ts, body),
  };
};
