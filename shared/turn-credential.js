import { createHmac, randomBytes } from 'node:crypto';

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Build a coturn REST (long-term) credential. Coturn expects the username to
 * begin with its Unix expiry timestamp and the password to be
 * base64(HMAC-SHA1(shared-secret, username)). Keep the shared secret server-side.
 */
export function createTurnCredential({ secret, ttlSeconds = 86400, now = Date.now(), id = randomBytes(16).toString('hex') } = {}) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('TURN_SECRET must contain at least 32 characters');
  }
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error(`TURN_TTL_SECONDS must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS}`);
  }
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('now must be a non-negative millisecond timestamp');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(id)) throw new Error('TURN credential id must be 16-128 URL-safe characters');

  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiresAt}:${id}`;
  const credential = createHmac('sha1', secret).update(username, 'utf8').digest('base64');
  return { username, credential, expiresAt, ttlSeconds };
}
