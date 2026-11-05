import { afterEach, describe, expect, it, vi } from 'vitest';
import { generationInputSchema } from '@studio/contracts';
import { readConfig } from '../../../config.js';
import { DeepSeekProvider } from './deepseek.provider.js';

const config = readConfig({ PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-deepseek-key' });
const input = generationInputSchema.parse({ kind: 'html', prompt: '连接测试' });
const signal = () => new AbortController().signal;
const completed = (text: string) =>
  Response.json({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  });
afterEach(() => vi.unstubAllGlobals());

describe('DeepSeek adapter (mocked HTTP)', () => {
  it('sends only DeepSeek credentials to its Responses endpoint without inheriting the OpenAI proxy', async () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
      completed('<html><body>已连接</body></html>'),
    );
    vi.stubGlobal('fetch', fetch);
    const provider = new DeepSeekProvider({
      ...config,
      OPENAI_API_KEY: 'test-openai-key',
      OPENAI_PROXY_URL: 'http://127.0.0.1:7897',
    });
    const result = await provider.generate(input, signal());
    expect(result.mime).toBe('text/html');
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/responses');
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-deepseek-key' });
    expect(options).not.toHaveProperty('dispatcher');
    expect(JSON.parse(options!.body as string)).toMatchObject({
      model: 'deepseek-flash',
      store: false,
      reasoning: { effort: 'none' },
    });
    await provider.onModuleDestroy();
  });

  it.each([
    [401, 'AUTH_FAILED'],
    [402, 'INSUFFICIENT_QUOTA'],
    [429, 'RATE_LIMIT'],
  ])('maps HTTP %s without exposing upstream secrets', async (status, code) => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { message: 'test-deepseek-key' } }, { status }),
    );
    const error = await new DeepSeekProvider(config)
      .generate(input, signal())
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).not.toContain('test-deepseek-key');
    if (status === 402) expect((error as Error).message).toContain('DeepSeek');
  });
});
