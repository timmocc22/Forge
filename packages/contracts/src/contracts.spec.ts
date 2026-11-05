import { describe, expect, it } from 'vitest';
import {
  generationInputSchema,
  createHtmlProjectSchema,
  runHtmlProjectSchema,
  conversationSchema,
} from './index';
import { randomUUID } from 'node:crypto';
describe('HTML input contract', () => {
  it('normalizes prompts and supplies consistent defaults', () => {
    expect(generationInputSchema.parse({ kind: 'html', prompt: '  hello  ' })).toEqual({
      kind: 'html',
      prompt: 'hello',
      style: 'editorial',
      slides: 5,
      aspect: 'landscape',
    });
  });
  it('accepts optional personal prompts and rejects invalid or oversized values', () => {
    const base = { requestId: randomUUID(), brief: 'hello' };
    expect(createHtmlProjectSchema.parse(base)).not.toHaveProperty('customPrompt');
    expect(
      createHtmlProjectSchema.parse({ ...base, customPrompt: '  暖白底色  ' }).customPrompt,
    ).toBe('暖白底色');
    for (const customPrompt of ['x'.repeat(4001), 42, null]) {
      expect(createHtmlProjectSchema.safeParse({ ...base, customPrompt }).success).toBe(false);
    }
  });
  it('distinguishes delegated choices from legacy fixed defaults', () => {
    const base = { requestId: randomUUID(), brief: 'hello' };
    expect(createHtmlProjectSchema.parse(base)).not.toHaveProperty('creativeOptions');
    expect(createHtmlProjectSchema.parse({ ...base, creativeOptions: {} }).creativeOptions).toEqual(
      {},
    );
    expect(
      createHtmlProjectSchema.parse({ ...base, creativeOptions: { sceneCount: 8 } })
        .creativeOptions,
    ).toEqual({ sceneCount: 8 });
    for (const creativeOptions of [
      { sceneCount: 0 },
      { sceneCount: 13 },
      { style: 'unknown' },
      { template: 'invented' },
    ])
      expect(createHtmlProjectSchema.safeParse({ ...base, creativeOptions }).success).toBe(false);
  });
  it.each([
    { kind: 'image', prompt: 'hello' },
    { kind: 'mindmap', prompt: 'hello' },
    { kind: 'html', prompt: 'hi' },
    { kind: 'html', prompt: '  ' },
    { kind: 'shell', prompt: 'hello' },
    { kind: 'html', prompt: 'hello', slides: 100 },
    { kind: 'html', prompt: 'hello', apiKey: 'secret' },
    { kind: 'html', prompt: 'hello', modelSelection: { provider: 'unknown', model: 'test' } },
    { kind: 'html', prompt: 'hello', modelSelection: { provider: 'openai', model: '' } },
    {
      kind: 'html',
      prompt: 'hello',
      modelSelection: { provider: 'zhipu', model: 'glm-5.3', reasoningEffort: 'none' },
    },
    {
      kind: 'html',
      prompt: 'hello',
      modelSelection: { provider: 'openai', model: 'test', apiKey: 'secret' },
    },
  ])('rejects unsupported capabilities and invalid input', (input) => {
    expect(generationInputSchema.safeParse(input).success).toBe(false);
  });
  it.each(['low', 'high', 'max'] as const)(
    'retains %s reasoning across generation and project requests',
    (reasoningEffort) => {
      const modelSelection = { provider: 'zhipu', model: 'glm-5.3', reasoningEffort };
      expect(
        generationInputSchema.parse({ kind: 'html', prompt: 'hello', modelSelection })
          .modelSelection,
      ).toEqual(modelSelection);
      expect(
        createHtmlProjectSchema.parse({ requestId: randomUUID(), brief: 'hello', modelSelection })
          .modelSelection,
      ).toEqual(modelSelection);
      expect(
        runHtmlProjectSchema.parse({
          requestId: randomUUID(),
          expectedRevision: 0,
          action: 'plan',
          modelSelection,
        }).modelSelection,
      ).toEqual(modelSelection);
    },
  );
});

describe('persisted conversation contract', () => {
  const projectId = randomUUID();
  const sceneId = randomUUID();
  const turn = [
    {
      id: randomUUID(),
      role: 'user',
      content: '这页适合小学生吗？',
      sceneId,
      createdAt: new Date().toISOString(),
    },
    {
      id: randomUUID(),
      role: 'assistant',
      content: '可以补充生活中的例子。',
      sceneId,
      createdAt: new Date().toISOString(),
    },
  ];
  const parse = (messages: typeof turn) =>
    conversationSchema.safeParse({ id: projectId, projectId, messages });

  it('accepts empty conversations and complete turns referring to different pages', () => {
    expect(parse([]).success).toBe(true);
    const nextScene = randomUUID();
    expect(
      parse([
        ...turn,
        ...turn.map((message) => ({ ...message, id: randomUUID(), sceneId: nextScene })),
      ]).success,
    ).toBe(true);
  });

  it.each([
    ['a question without its reply', turn.slice(0, 1)],
    ['a reply before its question', [...turn].reverse()],
    ['a reply attached to a different page', [turn[0]!, { ...turn[1]!, sceneId: randomUUID() }]],
    ['duplicate message identifiers', [turn[0]!, { ...turn[1]!, id: turn[0]!.id }]],
  ])('rejects %s before the transcript reaches storage or the UI', (_reason, messages) => {
    expect(parse(messages).success).toBe(false);
  });
});
