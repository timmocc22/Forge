import { z } from 'zod';
import { modelSelectionSchema as model } from './model-selection.js';
// An omitted property delegates that decision to AI. Absence of the whole object
// retains the fixed options used by older clients and existing projects.
export const creativeOptionsSchema = z
  .object({
    audience: z.string().trim().min(1).max(300).optional(),
    sceneCount: z.number().int().min(1).max(12).optional(),
    style: z.enum(['editorial', 'cinematic', 'minimal']).optional(),
    aspect: z.enum(['landscape', 'portrait', 'square']).optional(),
    accent: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
  })
  .strict();
export const creationContextSchema = z
  .object({
    locale: z.string().max(80),
    timeZone: z.string().max(100),
  })
  .strict();
export const creativeDirectionSchema = z
  .object({
    design: z.string().trim().min(1).max(2000),
    rationale: z.string().trim().min(1).max(1500),
  })
  .strict();
export const htmlSceneSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(120),
    objective: z.string().max(1000),
    content: z.string().max(4000),
    layout: z.string().max(500),
    html: z.string().max(250000),
    locked: z.boolean(),
  })
  .strict();
export type HtmlScene = z.infer<typeof htmlSceneSchema>;
export const htmlProjectContentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    brief: z.string().trim().min(1).max(8000),
    audience: z.string().trim().min(1).max(300),
    customPrompt: z.string().trim().max(4000).optional(),
    creativeDirection: creativeDirectionSchema.optional(),
    style: z.enum(['editorial', 'cinematic', 'minimal']),
    aspect: z.enum(['landscape', 'portrait', 'square']),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    scenes: z.array(htmlSceneSchema).max(12),
  })
  .strict()
  .refine(
    (value) => new Set(value.scenes.map((scene) => scene.id)).size === value.scenes.length,
    '页面标识不能重复',
  );
export type HtmlProjectContent = z.infer<typeof htmlProjectContentSchema>;
export const multiStepTaskSchema = z
  .object({
    phase: z.enum(['planning', 'executing', 'checking', 'completed']),
    steps: z
      .array(
        z
          .object({
            sceneId: z.string().uuid(),
            title: z.string().min(1).max(120),
            instruction: z.string().min(1).max(2000),
            status: z.enum(['pending', 'running', 'succeeded', 'unchanged']),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export type MultiStepTask = z.infer<typeof multiStepTaskSchema>;

export const generationClarificationSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    options: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(80),
            instruction: z.string().trim().min(1).max(1800),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

export const htmlProjectRunSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  action: z.enum(['plan', 'build', 'scene']),
  sceneId: z.string().uuid().optional(),
  status: z.enum(['running', 'awaiting_input', 'succeeded', 'failed', 'cancelled']),
  instruction: z.string().max(8000).optional(),
  task: multiStepTaskSchema.optional(),
  clarification: generationClarificationSchema.optional(),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  message: z.string(),
  modelSelection: model,
  startedAt: z.string(),
});
export const htmlProjectSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  content: htmlProjectContentSchema,
  sceneCount: z.number().int().min(1).max(12),
  modelSelection: model,
  creativeOptions: creativeOptionsSchema.optional(),
  creationContext: creationContextSchema.optional(),
  run: htmlProjectRunSchema.optional(),
  archived: z.boolean().optional(),
  undoDepth: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type HtmlProject = z.infer<typeof htmlProjectSchema>;
export const createHtmlProjectSchema = z
  .object({
    requestId: z.string().uuid(),
    brief: z.string().trim().min(1).max(8000),
    audience: z.string().trim().min(1).max(300).default('普通读者'),
    customPrompt: z.string().trim().max(4000).optional(),
    creativeOptions: creativeOptionsSchema.optional(),
    creationContext: creationContextSchema.optional(),
    sceneCount: z.number().int().min(1).max(12).default(5),
    style: z.enum(['editorial', 'cinematic', 'minimal']).default('editorial'),
    aspect: z.enum(['landscape', 'portrait', 'square']).default('landscape'),
    accent: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default('#e87844'),
    modelSelection: model.optional(),
    sourceHtml: z.string().min(1).max(250000).optional(),
  })
  .strict();
export type CreateHtmlProject = z.infer<typeof createHtmlProjectSchema>;
export const saveHtmlProjectSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    operationId: z.string().uuid(),
    content: htmlProjectContentSchema,
  })
  .strict();
export const runHtmlProjectSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    requestId: z.string().uuid(),
    action: z.enum(['plan', 'build', 'scene']),
    sceneId: z.string().uuid().optional(),
    instruction: z.string().trim().max(8000).default(''),
    modelSelection: model.optional(),
  })
  .strict();
export type RunHtmlProject = z.infer<typeof runHtmlProjectSchema>;
export const htmlStoryboardSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    scenes: z
      .array(htmlSceneSchema.omit({ id: true, html: true, locked: true }))
      .min(1)
      .max(12),
  })
  .strict();
export const htmlCreativeStoryboardSchema = htmlStoryboardSchema.extend({
  audience: z.string().trim().min(1).max(300),
  style: z.enum(['editorial', 'cinematic', 'minimal']),
  aspect: z.enum(['landscape', 'portrait', 'square']),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  creativeDirection: creativeDirectionSchema,
});
export const htmlCreativePlanningSchema = z
  .object({
    question: z.string().trim().max(1000),
    options: generationClarificationSchema.shape.options,
    plan: htmlCreativeStoryboardSchema.nullable(),
  })
  .strict();

export const taskContinuationSchema = z
  .object({
    action: z.enum(['plan', 'build', 'scene', 'conversation']),
    goal: z.string().trim().min(1).max(8000),
    timing: z.enum(['interrupt', 'after']),
  })
  .strict();
export type TaskContinuation = z.infer<typeof taskContinuationSchema>;

export const conversationMessageSchema = z
  .object({
    id: z.string().uuid(),
    role: z.enum(['user', 'assistant']),
    continuation: taskContinuationSchema.optional(),
    content: z.string().trim().min(1).max(16000),
    sceneId: z.string().uuid(),
    createdAt: z.string().datetime(),
    task: multiStepTaskSchema.optional(),
  })
  .strict();
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export const askHtmlSceneSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    allowEdits: z.boolean().optional(),
    multiStep: z.boolean().optional(),
    continuation: taskContinuationSchema.optional(),
    expectedRevision: z.number().int().nonnegative(),
    sceneId: z.string().uuid(),
    question: z.string().trim().min(1).max(2000),
    modelSelection: model.optional(),
  })
  .strict();
export type AskHtmlScene = z.infer<typeof askHtmlSceneSchema>;
export const pendingConversationSchema = z
  .object({
    requestId: z.string().uuid(),
    input: askHtmlSceneSchema,
    status: z.enum(['running', 'interrupted']),
    startedAt: z.string().datetime(),
    error: z.string().optional(),
    task: multiStepTaskSchema.optional(),
  })
  .strict();

export const conversationSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    messages: z.array(conversationMessageSchema).max(1000),
    pending: pendingConversationSchema.optional(),
  })
  .strict()
  .superRefine(({ messages }, context) => {
    // Only completed user/assistant turns are persisted and rendered together.
    if (messages.length % 2 !== 0)
      context.addIssue({ code: 'custom', path: ['messages'], message: '对话必须保存完整问答' });
    const ids = new Set<string>();
    messages.forEach((message, index) => {
      if (ids.has(message.id))
        context.addIssue({
          code: 'custom',
          path: ['messages', index, 'id'],
          message: '消息标识不能重复',
        });
      ids.add(message.id);
      if (message.role !== (index % 2 === 0 ? 'user' : 'assistant'))
        context.addIssue({
          code: 'custom',
          path: ['messages', index, 'role'],
          message: '问答必须按用户、助手顺序保存',
        });
      if (index % 2 !== 0 && message.sceneId !== messages[index - 1]?.sceneId)
        context.addIssue({
          code: 'custom',
          path: ['messages', index, 'sceneId'],
          message: '同一轮问答必须关联同一页面',
        });
    });
  });
export type Conversation = z.infer<typeof conversationSchema>;

export const htmlSceneAnswerSchema = z
  .object({ answer: z.string().trim().min(1).max(16000) })
  .strict();
export const askHtmlSceneResponseSchema = htmlSceneAnswerSchema.extend({
  project: htmlProjectSchema.optional(),
  conversation: conversationSchema,
  sceneId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  modelSelection: model,
});
