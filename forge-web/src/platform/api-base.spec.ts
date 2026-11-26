import { describe, expect, it } from 'vitest';
import { resolveApiBase } from './api-base';

describe('API endpoint selection', () => {
  it('keeps the Vite proxy on web and uses loopback for packaged desktop assets', () => {
    expect(resolveApiBase(undefined, false)).toBe('/api');
    expect(resolveApiBase(undefined, true)).toBe('http://127.0.0.1:3009/api');
    expect(resolveApiBase('  ', true)).toBe('http://127.0.0.1:3009/api');
    expect(resolveApiBase(' https://studio.example.com/api/ ', true)).toBe(
      'https://studio.example.com/api',
    );
    expect(resolveApiBase('http://localhost:3008/api', true)).toBe('http://localhost:3008/api');
  });
  it.each([
    'http://remote.example.com/api',
    'file:///tmp/api',
    'https://key:secret@example.com/api',
    'https://example.com/api?key=secret',
    'https://example.com/api#token',
    '/api',
  ])('rejects invalid or credential-bearing endpoints: %s', (value) => {
    expect(() => resolveApiBase(value, true)).toThrow();
  });
});
