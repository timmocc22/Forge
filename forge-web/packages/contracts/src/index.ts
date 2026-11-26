import { z } from 'zod';
import {
  modelIdSchema,
  modelSelectionSchema,
  providerSchema,
  reasoningEffortSchema,
} from './model-selection.js';
export * from './model-selection.js';
export * from './html-project.js';
export const generationInputSchema = z
  .object({
    kind: z.literal('html'),
    prompt: z.string().trim().min(3, '至少输入 3 个字符').max(24000),
    aspect: z.enum(['square', 'landscape', 'portrait']).default('landscape'),
    style: z.enum(['editorial', 'cinematic', 'minimal']).default('editorial'),
    slides: z.number().int().min(3).max(12).default(5),
    modelSelection: modelSelectionSchema.optional(),
  })
  .strict();
export type GenerationInput = z.infer<typeof generationInputSchema>;
export type GenerationKind = GenerationInput['kind'];
export const providerCatalogSchema = z.object({
  defaultProvider: providerSchema,
  defaults: z.object({ html: modelSelectionSchema.optional() }),
  providers: z.array(
    z.object({
      id: providerSchema,
      name: z.string(),
      capabilities: z.array(
        z.object({
          kind: z.literal('html'),
          available: z.boolean(),
          unavailableReason: z.string().optional(),
          defaultModel: modelIdSchema.optional(),
          models: z.array(modelIdSchema),
          reasoningEfforts: z.array(reasoningEffortSchema).optional(),
          defaultReasoningEffort: reasoningEffortSchema.optional(),
        }),
      ),
    }),
  ),
});
export type ProviderCatalog = z.infer<typeof providerCatalogSchema>;
export interface Artifact {
  mime: 'text/html';
  content: string;
  filename: string;
}
export interface GenerationExecution {
  htmlMode?: 'scene';
  operation: 'create' | 'revise';
  instructions: string;
  baseArtifact?: Artifact;
}

export * from './project-command.js';

export type { paths as ForgeApiPaths, operations as ForgeApiOperations } from './api.generated.js';
