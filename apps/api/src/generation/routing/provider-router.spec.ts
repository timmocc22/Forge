import { afterEach, describe, expect, it, vi } from 'vitest';
import { generationInputSchema } from '@studio/contracts';
import { readConfig } from '../../config.js';
import { ProviderRouter } from './provider-router.js';
const routers: ProviderRouter[] = [];
function fixture(overrides: NodeJS.ProcessEnv = {}) {
  const router = new ProviderRouter(
    readConfig({
      PROVIDER: 'demo',
      OPENAI_API_KEY: 'test-openai',
      OPENAI_TEXT_MODEL: 'test-text',
      DEEPSEEK_API_KEY: 'test-deepseek',
      ZHIPU_API_KEY: 'test-zhipu',
      ...overrides,
    }),
  );
  routers.push(router);
  return router;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(routers.splice(0).map((router) => router.onModuleDestroy()));
});
describe('HTML text provider routing', () => {
  it('publishes valid Zhipu reasoning levels and normalizes older selections to high', () => {
    const router = fixture({ PROVIDER: 'zhipu' });
    expect(
      router.catalog().providers.find((item) => item.id === 'zhipu')?.capabilities[0],
    ).toMatchObject({
      reasoningEfforts: ['low', 'high', 'max'],
      defaultReasoningEffort: 'high',
    });
    const input = generationInputSchema.parse({ kind: 'html', prompt: '思考等级' });
    expect(router.resolveInput(input).modelSelection).toEqual({
      provider: 'zhipu',
      model: 'glm-5.3',
      reasoningEffort: 'high',
    });
    expect(
      router.resolveInput({
        ...input,
        modelSelection: { provider: 'zhipu', model: 'glm-5.3' },
      }).modelSelection?.reasoningEffort,
    ).toBe('high');
    expect(() =>
      router.resolveInput({
        ...input,
        modelSelection: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'max' },
      }),
    ).toThrow('思考等级');
  });
  it('forwards the selected reasoning level to storyboard planning', async () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
      Response.json({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await fixture().complete(
      { provider: 'zhipu', model: 'glm-5.3', reasoningEffort: 'max' },
      { name: 'test', instructions: 'Return JSON.', input: 'test', schema: {} },
      new AbortController().signal,
    );
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).reasoning).toEqual({
      effort: 'max',
    });
  });
  it('publishes only HTML capabilities and text model defaults without credentials', () => {
    const router = fixture({ PROVIDER: 'deepseek' });
    const catalog = router.catalog();
    expect(catalog.defaults).toEqual({ html: { provider: 'deepseek', model: 'deepseek-flash' } });
    for (const provider of catalog.providers)
      expect(provider.capabilities.map((item) => item.kind)).toEqual(['html']);
    expect(JSON.stringify(catalog)).not.toContain('test-deepseek');
    expect(JSON.stringify(catalog)).not.toContain('https://');
    catalog.providers.length = 0;
    expect(router.catalog().providers).toHaveLength(4);
  });
  it('rejects unavailable accounts, insecure endpoints and invalid demo selections before invoking a model', () => {
    const router = fixture({ OPENAI_API_KEY: '', ZHIPU_BASE_URL: 'http://insecure.test' });
    const input = generationInputSchema.parse({ kind: 'html', prompt: '模型校验' });
    expect(() =>
      router.resolveInput({ ...input, modelSelection: { provider: 'openai', model: 'custom' } }),
    ).toThrow('OPENAI_API_KEY');
    expect(() =>
      router.resolveInput({ ...input, modelSelection: { provider: 'zhipu', model: 'custom' } }),
    ).toThrow('HTTPS');
    expect(() =>
      router.resolveInput({ ...input, modelSelection: { provider: 'demo', model: 'custom' } }),
    ).toThrow('local-sample');
  });
  it('keeps the admitted selection stable and uses the matching text endpoint and account', async () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '<html><body>完成</body></html>' }],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const router = fixture();
    const input = generationInputSchema.parse({
      kind: 'html',
      prompt: '模型路由',
      modelSelection: { provider: 'deepseek', model: 'custom-deepseek' },
    });
    const admitted = router.resolveInput(input);
    input.modelSelection!.model = 'later-selection';
    expect(admitted.modelSelection!.model).toBe('custom-deepseek');
    await router.generate(admitted, new AbortController().signal);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/responses');
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer test-deepseek',
    });
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).model).toBe('custom-deepseek');
  });
});
