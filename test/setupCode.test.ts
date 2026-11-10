import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSetupCode, setupCodeText } from '../src/core/setupCode';

// The same text is checked by the Apple apps (SetupCodeTests.swift).
const TEXT = 'boltwork-setup:{"v":1,"server":"https://sync.example.com","backup":"http://100.64.0.5:8787","email":"sam@example.com","secretKey":"SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123"}';
const CODE = { server: 'https://sync.example.com', backup: 'http://100.64.0.5:8787', email: 'sam@example.com', secretKey: 'SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123' };

test('a setup code round-trips and matches the shared text', () => {
  assert.equal(setupCodeText(CODE), TEXT);
  assert.deepEqual(parseSetupCode(TEXT), CODE);
  const { backup: _, ...plain } = CODE;
  assert.deepEqual(parseSetupCode(setupCodeText(plain)), plain);
});

test('a code can hold only the Secret Key', () => {
  const KEY_ONLY = 'boltwork-setup:{"v":1,"secretKey":"SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123"}';
  assert.equal(setupCodeText({ secretKey: CODE.secretKey }), KEY_ONLY);
  assert.deepEqual(parseSetupCode(KEY_ONLY), { secretKey: CODE.secretKey });
});

test('other text, newer versions and missing parts are refused', () => {
  assert.throws(() => parseSetupCode('otpauth://totp/x?secret=abc'), /isn’t a Boltwork setup code/);
  assert.throws(() => parseSetupCode('boltwork-setup:nope'), /isn’t a Boltwork setup code/);
  assert.throws(() => parseSetupCode(TEXT.replace('"v":1', '"v":2')), /newer version/);
  assert.throws(() => parseSetupCode('boltwork-setup:{"v":1,"server":"https://x","email":"a@b.c"}'), /isn’t a Boltwork setup code/);
});
