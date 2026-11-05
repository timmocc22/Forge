import { describe, expect, it } from 'vitest';
import { allowedWebOrigins, readConfig } from './config.js';

describe('Zhipu configuration', () => {
  it('requires its own key and a secure text endpoint', () => {
    expect(() => readConfig({ PROVIDER: 'zhipu' })).toThrow();
    expect(readConfig({ PROVIDER: 'zhipu', ZHIPU_API_KEY: 'test-key' })).toMatchObject({
      ZHIPU_BASE_URL: 'https://open.bigmodel.cn/api/v1',
      ZHIPU_TEXT_MODEL: 'glm-5.3',
    });
    expect(() =>
      readConfig({
        PROVIDER: 'zhipu',
        ZHIPU_API_KEY: 'test-key',
        ZHIPU_BASE_URL: 'http://insecure.test',
      }),
    ).toThrow();
    expect(() => readConfig({ ZHIPU_PROXY_URL: 'socks5://localhost:7897' })).toThrow();
  });
});

describe('local browser origins', () => {
  it('accepts both loopback names at the configured port', () => {
    expect(allowedWebOrigins('http://127.0.0.1:5177')).toEqual([
      'http://127.0.0.1:5177',
      'http://localhost:5177',
    ]);
  });
  it('does not widen a deployed origin or allow other ports', () => {
    expect(allowedWebOrigins('https://studio.example.com')).toEqual(['https://studio.example.com']);
    expect(allowedWebOrigins('http://localhost:5177')).not.toContain('http://localhost:5173');
  });
  it('adds only the two packaged desktop origins when enabled', () => {
    const origins = allowedWebOrigins('http://127.0.0.1:5177', true);
    expect(origins).toContain('tauri://localhost');
    expect(origins).toContain('http://tauri.localhost');
    expect(origins).not.toContain('null');
    expect(origins).not.toContain('https://untrusted.example.com');
    expect(origins).not.toContain('http://tauri.localhost:8080');
    expect(allowedWebOrigins('http://127.0.0.1:5177', false)).not.toContain('tauri://localhost');
    expect(readConfig({}).DESKTOP_CLIENT_ENABLED).toBe(true);
    expect(readConfig({ DESKTOP_CLIENT_ENABLED: 'false' }).DESKTOP_CLIENT_ENABLED).toBe(false);
  });
});

describe('OpenAI proxy configuration', () => {
  it('allows direct connections or HTTP CONNECT proxies and rejects unsupported protocols', () => {
    expect(readConfig({ OPENAI_PROXY_URL: '' }).OPENAI_PROXY_URL).toBe('');
    expect(readConfig({ OPENAI_PROXY_URL: 'http://127.0.0.1:7897' }).OPENAI_PROXY_URL).toBe(
      'http://127.0.0.1:7897',
    );
    expect(() => readConfig({ OPENAI_PROXY_URL: 'file:///tmp/proxy' })).toThrow();
    expect(() => readConfig({ OPENAI_PROXY_URL: 'socks5://127.0.0.1:7897' })).toThrow();
  });
});

describe('DeepSeek configuration', () => {
  it('requires its own key and defaults to the current Flash model without inheriting another provider account', () => {
    expect(() => readConfig({ PROVIDER: 'deepseek', OPENAI_API_KEY: 'other-key' })).toThrow();
    expect(
      readConfig({ PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-deepseek-key' }),
    ).toMatchObject({
      PROVIDER: 'deepseek',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
      DEEPSEEK_TEXT_MODEL: 'deepseek-flash',
    });
  });
  it('rejects insecure endpoints, empty models and unsupported proxy schemes', () => {
    const env = { PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-deepseek-key' };
    expect(() => readConfig({ ...env, DEEPSEEK_BASE_URL: 'http://example.com' })).toThrow();
    expect(() => readConfig({ ...env, DEEPSEEK_TEXT_MODEL: '' })).toThrow();
    expect(() => readConfig({ ...env, DEEPSEEK_PROXY_URL: 'socks5://localhost:7897' })).toThrow();
  });
});
