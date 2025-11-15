'use strict';

const {
  __sanitizeValue: sanitizeValue,
  __safeJson: safeJson,
} = require('./logger.js');

describe('logger sanitization', () => {
  test('redacts obvious secret fields in objects', () => {
    const input = {
      password: 'supersecret',
      token: 'abcd',
      nested: { apiKey: '123456789012345678901234567890123456', other: 'ok' },
      normal: 'value',
    };

    const out = sanitizeValue(input);

    expect(out.password).toBe('**redacted**');
    expect(out.token).toBe('**redacted**');
    expect(out.nested.apiKey).toBe('**redacted**');
    expect(out.normal).toBe('value');
    expect(out.nested.other).toBe('ok');
  });

  test('redacts long string tokens', () => {
    const token = 'x'.repeat(64);
    const out = sanitizeValue(token);
    expect(out).toBe('**redacted**');
  });

  test('safeJson does not throw on circular structures', () => {
    const obj = {};
    obj.self = obj;

    const json = safeJson(obj);
    expect(typeof json).toBe('string');
  });
});
