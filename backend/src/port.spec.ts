import { resolvePort } from './port.js';

describe('resolvePort', () => {
  it('defaults to 3001 when PORT is unset', () => {
    expect(resolvePort(undefined)).toBe(3001);
  });

  it.each(['1', '3002', '65535'])('accepts valid PORT %s', (value) => {
    expect(resolvePort(value)).toBe(Number(value));
  });

  it.each([
    '',
    ' ',
    '0',
    '-1',
    '65536',
    '3001.5',
    '3e3',
    '0xBB9',
    '3001abc',
    ' 3001 ',
  ])(
    'rejects invalid PORT %j',
    (value) => {
      expect(() => resolvePort(value)).toThrow(
        'PORT must be a decimal integer between 1 and 65535.',
      );
    },
  );
});
