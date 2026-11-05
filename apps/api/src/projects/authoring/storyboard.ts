import { z } from 'zod';
import { htmlStoryboardSchema } from '@studio/contracts';

// JSON-object providers can echo schema metadata alongside otherwise valid data.
// Accept only these metadata fields; keep all storyboard and scene checks strict.
const modelStoryboardSchema = htmlStoryboardSchema.extend({
  $schema: z.string().url().optional(),
  type: z.literal('object').optional(),
});

export function parseStoryboard(value: unknown) {
  const { title, scenes } = modelStoryboardSchema.parse(value);
  return { title, scenes };
}
