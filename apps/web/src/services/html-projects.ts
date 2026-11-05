import { z } from 'zod';
import {
  askHtmlSceneResponseSchema, projectCommandsSchema, type EnqueueProjectCommand,
  conversationSchema,
  type AskHtmlScene,
  htmlProjectSchema,
  type CreateHtmlProject,
  type HtmlProjectContent,
  type RunHtmlProject,
} from '@studio/contracts';
import { apiBase, ApiError } from './api';

export const projectSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  brief: z.string(),
  revision: z.number(),
  sceneCount: z.number(),
  builtCount: z.number(),
  updatedAt: z.string(),
  running: z.boolean(),
  archived: z.boolean().default(false),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
async function request(
  path = '',
  method = 'GET',
  body?: unknown,
  timeout = 15000,
  signal?: AbortSignal,
) {
  const response = await fetch(`${apiBase}/html-projects${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
  });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error?.message ?? '项目请求失败', response.status);
  return result;
}
export const htmlProjectsApi = {
  storageStatus: async () => z.object({ issues: z.array(z.object({ file: z.string(), reason: z.string() })) }).parse(await request('/storage/status')),
  commands: async (id: string) => projectCommandsSchema.parse(await request(`/${id}/commands`)),
  enqueue: async (id: string, command: EnqueueProjectCommand) => projectCommandsSchema.parse(await request(`/${id}/commands`, 'POST', command)),
  changeCommand: async (id: string, commandId: string, action: 'remove' | 'retry' | 'interrupt') => projectCommandsSchema.parse(await request(`/${id}/commands/${commandId}`, 'PATCH', { action })),
  clearCommands: async (id: string) => projectCommandsSchema.parse(await request(`/${id}/commands`, 'DELETE')),
  list: async () => z.array(projectSummarySchema).parse(await request()),
  archive: async (id: string, archived: boolean, expectedRevision: number) =>
    htmlProjectSchema.parse(
      await request(`/${id}/archive`, 'POST', { archived, expectedRevision }),
    ),
  remove: async (id: string, expectedRevision: number) =>
    request(`/${id}`, 'DELETE', { expectedRevision }),
  duplicate: async (id: string, expectedRevision: number) =>
    htmlProjectSchema.parse(
      await request(`/${id}/duplicate`, 'POST', {
        requestId: crypto.randomUUID(),
        expectedRevision,
      }),
    ),
  get: async (id: string) => htmlProjectSchema.parse(await request(`/${id}`)),
  create: async (input: CreateHtmlProject) =>
    htmlProjectSchema.parse(await request('', 'POST', input)),
  save: async (
    id: string,
    expectedRevision: number,
    operationId: string,
    content: HtmlProjectContent,
  ) =>
    htmlProjectSchema.parse(
      await request(`/${id}`, 'PATCH', { expectedRevision, operationId, content }),
    ),
  run: async (id: string, input: RunHtmlProject) =>
    htmlProjectSchema.parse(await request(`/${id}/runs`, 'POST', input)),
  conversation: async (id: string) =>
    conversationSchema.parse(await request(`/${id}/conversation`)),
  stopConversation: async (id: string) =>
    conversationSchema.parse(await request(`/${id}/conversation/stop`, 'POST')),
  ask: async (id: string, input: AskHtmlScene, signal?: AbortSignal) =>
    askHtmlSceneResponseSchema.parse(
      await request(`/${id}/questions`, 'POST', input, input.multiStep ? 615000 : 135000, signal),
    ),
  cancel: async (id: string) => htmlProjectSchema.parse(await request(`/${id}/cancel`, 'POST')),
  undo: async (id: string, expectedRevision: number, operationId: string) =>
    htmlProjectSchema.parse(
      await request(`/${id}/undo`, 'POST', { expectedRevision, operationId }),
    ),
};
