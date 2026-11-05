import { z } from 'zod';

export const providerSchema = z.enum(['demo', 'openai', 'deepseek', 'zhipu']);
export const modelIdSchema = z
  .string()
  .trim()
  .min(1, '请输入模型名称')
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/, '模型名称格式不正确');
export const reasoningEffortSchema = z.enum(['low', 'high', 'max']);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export const modelSelectionSchema = z
  .object({
    provider: providerSchema,
    model: modelIdSchema,
    reasoningEffort: reasoningEffortSchema.optional(),
  })
  .strict();
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
