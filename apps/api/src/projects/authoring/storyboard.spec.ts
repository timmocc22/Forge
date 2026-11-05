import { describe, expect, it } from 'vitest';
import { parseStoryboard } from './storyboard.js';

const plan = {
  title: '红楼梦赏析',
  scenes: [
    { title: '主要人物', objective: '认识人物', content: '宝玉与黛玉', layout: '人物关系图' },
  ],
};

describe('model storyboard validation', () => {
  it('accepts GLM schema metadata while returning only validated storyboard data', () => {
    expect(
      parseStoryboard({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        ...plan,
      }),
    ).toEqual(plan);
    expect(parseStoryboard(plan)).toEqual(plan);
  });

  it.each([
    { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    { ...plan, scenes: [{ title: '缺少内容' }] },
    { ...plan, scenes: [{ ...plan.scenes[0], layout: 'x'.repeat(501) }] },
    { ...plan, unexpected: true },
    { ...plan, scenes: [{ ...plan.scenes[0], unexpected: true }] },
  ])('still rejects schemas, incomplete scenes and invalid content: %j', (value) => {
    expect(() => parseStoryboard(value)).toThrow();
  });
});
