import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createTurnCredential } from '../shared/turn-credential.js';

test('coturn REST credentials use expiry:random-id and HMAC-SHA1 Base64', () => {
  const secret = 'a-test-shared-secret-that-is-at-least-32-characters';
  const now = 1_700_000_000_123;
  const result = createTurnCredential({ secret, ttlSeconds: 3600, now, id: '0123456789abcdef0123456789abcdef' });
  const [expiry, id] = result.username.split(':');

  assert.equal(Number(expiry), Math.floor(now / 1000) + 3600);
  assert.equal(id, '0123456789abcdef0123456789abcdef');
  assert.equal(result.expiresAt, Number(expiry));
  assert.equal(result.ttlSeconds, 3600);
  assert.equal(result.credential, createHmac('sha1', secret).update(result.username).digest('base64'));
});

test('coturn credentials reject weak secrets, malformed ids and unsafe lifetimes', () => {
  assert.throws(() => createTurnCredential({ secret: 'short-secret' }), /at least 32 characters/);
  assert.throws(() => createTurnCredential({ secret: 'x'.repeat(32), ttlSeconds: 30 }), /TURN_TTL_SECONDS/);
  assert.throws(() => createTurnCredential({ secret: 'x'.repeat(32), ttlSeconds: 604801 }), /TURN_TTL_SECONDS/);
  assert.throws(() => createTurnCredential({ secret: 'x'.repeat(32), id: 'user@example.com' }), /URL-safe/);
});
