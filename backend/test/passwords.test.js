import test from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword } from '../src/services/passwords.js'

test('account passwords are salted and verified without storing plaintext', async () => {
  const a = await hashPassword('correct horse battery staple')
  const b = await hashPassword('correct horse battery staple')
  assert.notEqual(a, b)
  assert.equal(await verifyPassword('correct horse battery staple', a), true)
  assert.equal(await verifyPassword('wrong password', a), false)
  assert.equal(await verifyPassword('correct horse battery staple', 'invalid'), false)
})
