import { z } from 'zod';
import { contextDocumentSchema } from '../../context/context.service.js';
import {
  conversationSchema,
  htmlProjectSchema,
  htmlProjectContentSchema,
  multiStepTaskSchema,
  projectCommandsSchema,
} from '@studio/contracts';

/** Internal execution data never appears in project/conversation HTTP responses. */
export const executionCheckpointSchema = z.object({
  requestId: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  evidence: z.array(contextDocumentSchema).max(8).optional(),
  baseRevision: z.number().int().nonnegative(),
  draftRevision: z.number().int().nonnegative(),
  content: htmlProjectContentSchema,
  task: multiStepTaskSchema,
});
export const projectRecordSchema = z
  .object({
    project: htmlProjectSchema,
    conversation: conversationSchema.optional(),
    history: z.array(htmlProjectContentSchema).max(20),
    createRequestId: z.string().uuid(),
    commands: projectCommandsSchema.optional(),
    checkpoint: executionCheckpointSchema.optional(),
    operations: z.array(z.string().uuid()).max(100),
  })
  .superRefine(({ project, conversation, commands }, context) => {
    if (
      commands?.some((command) => command.projectId !== project.id) ||
      new Set(commands?.map((command) => command.id)).size !== (commands?.length ?? 0)
    )
      context.addIssue({
        code: 'custom',
        path: ['commands'],
        message: '任务队列标识或项目归属不正确',
      });
    if (conversation && conversation.projectId !== project.id)
      context.addIssue({
        code: 'custom',
        path: ['conversation', 'projectId'],
        message: '对话必须属于当前项目',
      });
  });
export type ProjectRecord = z.infer<typeof projectRecordSchema>;
