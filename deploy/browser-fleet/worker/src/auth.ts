import { createHash, timingSafeEqual } from 'node:crypto';

export const TOKEN_HEADER = 'x-worker-token';

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Constant-time token comparison. Both sides are hashed first so the comparison length never
 * depends on the caller's input (timingSafeEqual itself requires equal lengths). Pure.
 */
export function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string' || given.length === 0 || expected.length === 0) return false;
  return timingSafeEqual(digest(expected), digest(given));
}
