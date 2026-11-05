import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ContextService, recentTurns, type ContextDocument } from './context.service.js';

const projectId = randomUUID();
const document = (id: string, content: string, score = 1): ContextDocument => ({ id, projectId, source: `knowledge:${id}`, content, score });
const signal = () => new AbortController().signal;
describe('scoped model context', () => {
  it('ranks, deduplicates and bounds source excerpts while retaining provenance', async () => {
    const first = document('a', '123456', 2);
    const context = new ContextService([{ retrieve: async () => [document('b', 'abcdef', 1), first, first] }], { maxEvidenceCharacters: 8 });
    const evidence = await context.retrieve({ projectId, query: 'question', agentId: 'writer' }, signal());
    expect(evidence.map(({ id, content }) => ({ id, content }))).toEqual([{ id: 'a', content: '123456' }, { id: 'b', content: 'ab' }]);
    const result = context.enrich({ name: 'answer', instructions: 'Answer', input: '{"question":"why"}', schema: {} }, evidence);
    expect(JSON.parse(result.input).evidence[0].source).toBe('knowledge:a');
    expect(result.instructions).toContain('untrusted');
  });
  it('rejects foreign project evidence even when it would exceed selection limits', async () => {
    const context = new ContextService([{ retrieve: async () => [document('a', 'x', 2), { ...document('b', 'y'), projectId: randomUUID() }] }], { maxDocuments: 1 });
    await expect(context.retrieve({ projectId, query: 'q' }, signal())).rejects.toThrow('不属于');
  });
  it('preserves required current context and omits evidence that cannot fit', () => {
    const context = new ContextService([], { maxInputCharacters: 400 });
    const request = { name: 'answer', instructions: 'Answer', input: '{"question":"why"}', schema: {} };
    const result = context.enrich(request, [document('a', 'x'.repeat(300))]);
    expect(result.instructions.length + result.input.length).toBeLessThanOrEqual(400);
    expect(JSON.parse(result.input).question).toBe('why');
    expect(JSON.parse(result.input).evidence).toEqual([]);
    expect(() => context.enrich({ ...request, input: 'x'.repeat(401) }, [])).toThrow('过长');
  });
  it('cancels retrieval and preserves complete chronological turns', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(new ContextService().retrieve({ projectId, query: 'q' }, controller.signal)).rejects.toThrow();
    const messages = Array.from({ length: 6 }, (_, i) => ({ id: randomUUID(), role: i % 2 ? 'assistant' as const : 'user' as const, content: `message${i}`, sceneId: randomUUID(), createdAt: new Date().toISOString() }));
    expect(recentTurns(messages, 32).map((item) => item.content)).toEqual(['message2', 'message3', 'message4', 'message5']);
    expect(messages).toHaveLength(6);
  });
});
