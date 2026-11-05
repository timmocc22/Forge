import { afterEach, describe, expect, it, vi } from 'vitest';
import { generationInputSchema } from '@studio/contracts';
import { readConfig } from '../../../config.js';
import { ZhipuProvider } from './zhipu.provider.js';
const config = readConfig({ ZHIPU_API_KEY: 'test-zhipu-key' });
const providers: ZhipuProvider[] = [];
const fixture = () => {
  const provider = new ZhipuProvider(config);
  providers.push(provider);
  return provider;
};
const signal = () => new AbortController().signal;
const completed = (text: string) =>
  Response.json({
    status: 'completed',
    output: [{ type: 'message', content: { type: 'output_text', text } }],
  });
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(providers.splice(0).map((provider) => provider.onModuleDestroy()));
});
describe('Zhipu text adapter (mocked HTTP)', () => {
  it.each(['low', 'high', 'max'] as const)(
    'generates HTML with selected %s reasoning and independent credentials',
    async (reasoningEffort) => {
      const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
        completed('<html><body>智谱</body></html>'),
      );
      vi.stubGlobal('fetch', fetch);
      const result = await fixture().generate(
        generationInputSchema.parse({
          kind: 'html',
          prompt: '智谱测试',
          modelSelection: { provider: 'zhipu', model: 'custom-glm', reasoningEffort },
        }),
        signal(),
      );
      expect(result.mime).toBe('text/html');
      expect(fetch.mock.calls[0]?.[0]).toBe('https://open.bigmodel.cn/api/v1/responses');
      expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
        Authorization: 'Bearer test-zhipu-key',
      });
      expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('dispatcher');
      expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toMatchObject({
        model: 'custom-glm',
        store: false,
        reasoning: { effort: reasoningEffort },
      });
    },
  );
  it.each(['low', 'high', 'max'] as const)(
    'plans JSON with selected %s reasoning and carries the schema in instructions',
    async (reasoningEffort) => {
      const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
        completed('{"title":"分镜","scenes":[]}'),
      );
      vi.stubGlobal('fetch', fetch);
      const result = await fixture().complete(
        'custom-glm',
        {
          name: 'html_storyboard',
          reasoningEffort,
          instructions: 'Plan HTML scenes.',
          input: '主题',
          schema: { type: 'object', properties: { scenes: { type: 'array' } } },
        },
        signal(),
      );
      expect(result).toEqual({ title: '分镜', scenes: [] });
      const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
      expect(body.reasoning).toEqual({ effort: reasoningEffort });
      expect(body.text).toEqual({ format: { type: 'json_object' } });
      expect(body.instructions).toContain('"scenes"');
    },
  );
  it('identifies HTTP 400 as a request error without suggesting a top-up or leaking upstream text', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json(
        { error: { code: 'invalid_request', message: 'contains test-zhipu-key' } },
        { status: 400 },
      ),
    );
    const error = await fixture()
      .generate(generationInputSchema.parse({ kind: 'html', prompt: '错误测试' }), signal())
      .catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: 'INVALID_REQUEST',
      message: '模型请求参数有误或不受支持，请检查模型与接口配置（HTTP 400）',
    });
    expect((error as Error).message).not.toContain('test-zhipu-key');
  });
  it.each([
    [401, 'AUTH_FAILED'],
    [402, 'INSUFFICIENT_QUOTA'],
    [429, 'RATE_LIMIT'],
  ] as const)('maps HTTP %s without disclosing credentials', async (status, code) => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { message: 'test-zhipu-key' } }, { status }),
    );
    const error = await fixture()
      .generate(generationInputSchema.parse({ kind: 'html', prompt: '错误测试' }), signal())
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).not.toContain('test-zhipu-key');
  });
});
