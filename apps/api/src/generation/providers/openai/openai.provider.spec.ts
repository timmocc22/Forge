import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { readConfig } from '../../../config.js';
import { ModelInvocationLimiter } from '../../routing/model-limiter.js';
import { OpenAIProvider } from './openai.provider.js';
const input = {
  kind: 'html',
  prompt: 'hello world',
  aspect: 'landscape',
  style: 'minimal',
  slides: 5,
} as const;
const config = {
  ...readConfig({ PROVIDER: 'demo' }),
  OPENAI_API_KEY: 'test-key',
  OPENAI_TEXT_MODEL: 'test-text',
};
afterEach(() => vi.unstubAllGlobals());
describe('HTML creation strategies', () => {
  it('generates one project scene without presentation navigation', async () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              { type: 'output_text', text: '<html><body><h1>One scene</h1></body></html>' },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await new OpenAIProvider(config).generate(input, new AbortController().signal, {
      htmlMode: 'scene',
      operation: 'create',
      instructions: 'Build a single clear visual scene.',
    });
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body.instructions).toContain('do not add pagination');
    expect(JSON.parse(body.input).requestedSlides).toBe(1);
  });
  it('provides the entire current HTML separately from the latest message', async () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '<html><body>updated</body></html>' }],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await new OpenAIProvider(config).generate(input, new AbortController().signal, {
      operation: 'revise',
      instructions: 'retain the existing content',
      baseArtifact: {
        mime: 'text/html',
        filename: 'a.html',
        content: '<html><body>original content</body></html>',
      },
    });
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(JSON.parse(body.input).currentHtml).toBe('<html><body>original content</body></html>');
  });
});
describe('OpenAI transport adapter (mocked HTTP)', () => {
  it('collects message text after reasoning and validates complete HTML', async () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
      Response.json({
        status: 'completed',
        output: [
          { type: 'reasoning' },
          { type: 'message', content: [{ type: 'output_text', text: '<html><body>one' }] },
          { type: 'message', content: [{ type: 'output_text', text: '</body></html>' }] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const artifact = await new OpenAIProvider(config).generate(input, new AbortController().signal);
    expect(artifact.content).toBe('<html><body>one\n</body></html>');
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/responses');
  });
  it('maps quota errors without leaking upstream messages', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { message: 'contains test-key' } }, { status: 429 }),
    );
    await expect(
      new OpenAIProvider(config).generate(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  });
  it('explains unavailable token-group models without forwarding upstream messages', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json(
        { error: { code: 'model_not_found', message: 'contains test-key' } },
        { status: 503 },
      ),
    );
    const error = await new OpenAIProvider(config)
      .generate(input, new AbortController().signal)
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    expect((error as Error).message).toContain('分组权限');
    expect((error as Error).message).not.toContain('test-key');
  });
  it('distinguishes exhausted credits from rate limits without forwarding upstream text', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json(
        {
          error: {
            code: 'credit_balance_exhausted',
            type: 'insufficient_quota',
            message: 'contains test-key',
          },
        },
        { status: 429 },
      ),
    );
    await expect(
      new OpenAIProvider(config).generate(input, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_QUOTA',
      message: 'OpenAI 项目 API 额度不足，请在 OpenAI 控制台补充额度后重试',
    });
  });
  it('rejects incomplete HTML', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '<html>truncated' }] }],
      }),
    );
    await expect(
      new OpenAIProvider(config).generate(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });

  it('routes real HTTP transport through the configured CONNECT proxy', async () => {
    let target: string | undefined;
    const proxy = createServer();
    proxy.on('connect', (request, socket) => {
      target = request.url;
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\n\r\n');
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const port = (proxy.address() as AddressInfo).port;
    const provider = new OpenAIProvider({
      ...config,
      OPENAI_PROXY_URL: `http://127.0.0.1:${port}`,
    });
    try {
      await expect(provider.generate(input, new AbortController().signal)).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
      });
      expect(target).toBe('api.openai.com:443');
    } finally {
      await provider.onModuleDestroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
  it('requires explicit provider credentials and model names at startup', () => {
    expect(() => readConfig({ PROVIDER: 'openai' })).toThrow();
  });
});

describe('Responses function calling', () => {
  it('replays call IDs and reasoning, executes tools and permits nested model calls with capacity one', async () => {
    const reasoning = { type: 'reasoning', id: 'rs_1', encrypted_content: 'encrypted' };
    const call = {
      type: 'function_call',
      call_id: 'call_1',
      id: 'fc_1',
      name: 'revise_scene',
      arguments: '{"sceneId":"page"}',
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: 'completed', output: [reasoning, call] }))
      .mockResolvedValueOnce(
        Response.json({
          output: [
            { type: 'message', content: [{ type: 'output_text', text: '{"title":"new"}' }] },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          output: [
            { type: 'message', content: [{ type: 'output_text', text: '{"answer":"已修改"}' }] },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const provider = new OpenAIProvider(config, {}, new ModelInvocationLimiter(1));
    const execute = vi.fn(async () =>
      provider.complete(
        'test-text',
        {
          instructions: 'revise',
          input: 'source',
          name: 'revision',
          schema: { type: 'object' },
        },
        new AbortController().signal,
      ),
    );
    const result = await provider.complete(
      'test-text',
      {
        instructions: 'help user',
        input: 'change title',
        name: 'answer',
        schema: { type: 'object' },
        tools: {
          definitions: [
            {
              type: 'function',
              name: 'revise_scene',
              description: 'edit page',
              parameters: { type: 'object' },
              strict: true,
            },
          ],
          execute,
        },
      },
      new AbortController().signal,
    );
    expect(result).toEqual({ answer: '已修改' });
    expect(execute).toHaveBeenCalledExactlyOnceWith('revise_scene', '{"sceneId":"page"}');
    const first = JSON.parse(fetch.mock.calls[0]![1]!.body);
    const last = JSON.parse(fetch.mock.calls[2]![1]!.body);
    expect(first).toMatchObject({
      store: false,
      parallel_tool_calls: false,
      include: ['reasoning.encrypted_content'],
    });
    expect(last.input).toEqual([
      { role: 'user', content: 'change title' },
      reasoning,
      call,
      { type: 'function_call_output', call_id: 'call_1', output: '{"title":"new"}' },
    ]);
  });
  it('bounds tool loops before executing any calls beyond the budget', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          output: [
            {
              type: 'function_call',
              call_id: `call_${calls++}`,
              name: 'list_scenes',
              arguments: '{}',
            },
          ],
        }),
      ),
    );
    const execute = vi.fn(async () => ({ scenes: [] }));
    await expect(
      new OpenAIProvider(config).complete(
        'test',
        {
          instructions: 'help',
          input: 'list pages',
          name: 'answer',
          schema: {},
          tools: { definitions: [], execute },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'TOOL_LIMIT' });
    expect(execute).toHaveBeenCalledTimes(12);
  });
  it('bounds replayed tool observations before making another paid model request', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        output: [{ type: 'function_call', call_id: '1', name: 'read_scene', arguments: '{}' }],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      new OpenAIProvider(config).complete(
        'test',
        {
          instructions: 'Answer',
          input: 'Read',
          name: 'answer',
          schema: {},
          budget: { maxHistoryCharacters: 500 },
          tools: { definitions: [], execute: async () => 'x'.repeat(600) },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CONTEXT_LIMIT' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
