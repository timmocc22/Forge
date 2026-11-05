import { z } from 'zod';
import { modelSelectionSchema } from './model-selection.js';
import { taskContinuationSchema } from './html-project.js';

export const projectCommandSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid(),
  question: z.string().trim().min(1).max(2000),
  sceneId: z.string().uuid().optional(),
  mode: z.enum(['revise', 'ask']), kind: z.enum(['plan', 'message']),
  append: z.boolean(), brief: z.string().max(8000).optional(),
  task: taskContinuationSchema.omit({ timing: true }).extend({
    sceneId: z.string().uuid().optional(), allowEdits: z.boolean(), multiStep: z.boolean(),
  }).optional(),
  timing: z.enum(['after', 'interrupt']),
  modelSelection: modelSelectionSchema.optional(),
  attempt: z.number().int().nonnegative().default(0),
  status: z.enum(['queued', 'running', 'failed']).default('queued'),
  error: z.string().max(1000).default(''),
  interrupted: z.boolean().optional(),
}).strict();
export type ProjectCommand = z.infer<typeof projectCommandSchema>;
export const enqueueProjectCommandSchema = projectCommandSchema.omit({ status: true, error: true, interrupted: true, attempt: true });
export const projectCommandsSchema = z.array(projectCommandSchema).max(20);

export type EnqueueProjectCommand = z.infer<typeof enqueueProjectCommandSchema>;
