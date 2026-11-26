import type { Page } from '@playwright/test';
import {
  projectCommandSchema,
  type ProjectCommand,
  type Conversation,
  type HtmlProject,
} from '@studio/contracts';

/** UI fixture only: expose a controllable worker through browser routes used by model fixtures.
 * Production-worker ordering, persistence and recovery are exercised by API integration tests.
 */
export async function mockCommandWorker(page: Page) {
  const queues = new Map<string, ProjectCommand[]>();
  const transcripts = new Map<string, Conversation>();
  const workers = new Set<string>();
  const controls = new Set<string>();
  const active = new Map<string, string>();
  async function request(path: string, method = 'GET', body?: unknown, token?: string) {
    return page.evaluate(
      async ({ path, method, body, token }) => {
        const scope = globalThis as typeof globalThis & {
          commandFixtureControllers?: Record<string, AbortController>;
        };
        const controller = new AbortController();
        if (token) (scope.commandFixtureControllers ??= {})[token] = controller;
        try {
          const response = await fetch(path, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
          });
          const value = await response.json();
          if (!response.ok) throw new Error(value.error?.message ?? '请求失败');
          return value;
        } finally {
          if (token) delete scope.commandFixtureControllers?.[token];
        }
      },
      { path, method, body, token },
    );
  }
  async function abort(id: string) {
    const token = active.get(id);
    if (token)
      await page.evaluate((key) => {
        (
          globalThis as typeof globalThis & {
            commandFixtureControllers?: Record<string, AbortController>;
          }
        ).commandFixtureControllers?.[key]?.abort();
      }, token);
  }
  async function drain(id: string) {
    if (workers.has(id)) return;
    workers.add(id);
    try {
      while (queues.get(id)?.[0]?.status === 'queued') {
        if (controls.has(id)) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          continue;
        }
        const command = queues.get(id)![0]!;
        const path = `/api/html-projects/${id}`;
        let project: HtmlProject = await request(path);
        if (project.run?.status === 'running') {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
        command.status = 'running';
        const token = crypto.randomUUID();
        active.set(id, token);
        try {
          const needsPlan = !project.content.scenes.length;
          if ((command.kind === 'plan' || needsPlan) && project.run?.status !== 'awaiting_input') {
            const brief = command.append
              ? `${project.content.brief}\n\n补充要求：${command.question}`
              : command.question;
            project = await request(path, 'PATCH', {
              expectedRevision: project.revision,
              operationId: crypto.randomUUID(),
              content: { ...project.content, brief },
            });
          }
          const action =
            project.run?.status === 'awaiting_input'
              ? project.run.action
              : needsPlan
                ? 'plan'
                : command.interrupted &&
                    (command.task?.action === 'build' || command.task?.action === 'scene')
                  ? command.task.action
                  : undefined;
          if (action) {
            let value: HtmlProject = await request(
              `${path}/runs`,
              'POST',
              {
                expectedRevision: project.revision,
                requestId: crypto.randomUUID(),
                action,
                sceneId: command.task?.sceneId,
                instruction: command.task
                  ? `${command.task.goal}\n\n补充要求：${command.question}`
                  : command.question,
                modelSelection: command.modelSelection,
              },
              token,
            );
            while (value.run?.status === 'running') {
              await new Promise((resolve) => setTimeout(resolve, 50));
              value = await request(path);
            }
            if (value.run?.status === 'failed') throw new Error(value.run.message);
          } else {
            const sceneId =
              command.task?.sceneId ?? command.sceneId ?? project.content.scenes[0]!.id;
            const input = {
              expectedRevision: project.revision,
              requestId: command.id,
              sceneId,
              question: command.question,
              allowEdits: command.task?.allowEdits ?? command.mode !== 'ask',
              ...((command.task?.multiStep ?? (command.mode !== 'ask' && command.multiStep))
                ? { multiStep: true }
                : {}),
              continuation: command.task
                ? { action: command.task.action, goal: command.task.goal, timing: command.timing }
                : undefined,
              modelSelection: command.modelSelection,
            };
            const previous = transcripts.get(id) ?? (await request(`${path}/conversation`));
            transcripts.set(id, {
              ...previous,
              pending: {
                requestId: command.id,
                input,
                status: 'running',
                startedAt: new Date().toISOString(),
              },
            });
            const result = await request(`${path}/questions`, 'POST', input, token);
            transcripts.set(id, result.conversation);
          }
          queues.set(
            id,
            queues.get(id)!.filter((item) => item.id !== command.id),
          );
        } catch (error) {
          const current = queues.get(id)?.find((item) => item.id === command.id);
          if (current) {
            current.status = 'failed';
            current.error = (error instanceof Error ? error.message : '任务失败').slice(0, 1000);
            const transcript = transcripts.get(id);
            if (transcript?.pending?.requestId === command.id) {
              transcript.pending.status = 'interrupted';
              transcript.pending.error = current.error;
            }
          }
        } finally {
          active.delete(id);
        }
      }
    } finally {
      workers.delete(id);
    }
  }
  await page.route(/\/api\/html-projects\/[\da-f-]+\/conversation$/, (route) => {
    const id = route.request().url().split('/').at(-2)!;
    return transcripts.has(id) ? route.fulfill({ json: transcripts.get(id) }) : route.continue();
  });
  await page.route(/\/api\/html-projects\/[\da-f-]+\/commands(?:\/[\da-f-]+)?$/, async (route) => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const id = parts[3]!;
    const commandId = parts[5];
    const method = route.request().method();
    if (method === 'POST') {
      const command = projectCommandSchema.parse(route.request().postDataJSON());
      queues.set(id, [...(queues.get(id) ?? []), command]);
    } else if (method === 'PATCH') {
      const { action } = route.request().postDataJSON();
      const command = queues.get(id)!.find((item) => item.id === commandId)!;
      if (action === 'remove')
        queues.set(
          id,
          queues.get(id)!.filter((item) => item.id !== commandId),
        );
      else {
        command.status = 'queued';
        command.error = '';
        if (action === 'interrupt') {
          controls.add(id);
          try {
            command.timing = 'interrupt';
            command.interrupted = true;
            queues.set(id, [
              command,
              ...queues
                .get(id)!
                .filter((item) => item.id !== commandId && item.status !== 'running'),
            ]);
            await abort(id);
            await request(`/api/html-projects/${id}/cancel`, 'POST');
            transcripts.set(
              id,
              await request(`/api/html-projects/${id}/conversation/stop`, 'POST'),
            );
          } finally {
            controls.delete(id);
          }
        }
      }
    } else if (method === 'DELETE') {
      queues.set(id, []);
      await abort(id);
      await request(`/api/html-projects/${id}/cancel`, 'POST');
      transcripts.set(id, await request(`/api/html-projects/${id}/conversation/stop`, 'POST'));
    }
    await route.fulfill({ json: queues.get(id) ?? [] });
    if (method !== 'GET') void drain(id).catch(() => {});
  });
}
