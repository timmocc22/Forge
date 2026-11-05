import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectCommandSchema, createHtmlProjectSchema } from '@studio/contracts';
import { ProjectRepository } from '../persistence/project.repository.js';
import { HtmlProjectService } from '../authoring/project.service.js';
import { ConversationService } from '../conversation/conversation.service.js';
import { ProjectTasks, TaskCapacityError } from './project-tasks.js';
import { ProjectCommands } from './project-commands.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(directory?: string) {
  directory ??= await mkdtemp(join(tmpdir(), 'forge-commands-'));
  const dir = directory;
  const repository = new ProjectRepository(dir);
  const tasks = new ProjectTasks();
  const provider = {
    resolveInput: (
      input: Parameters<import('../../generation/ports.js').GenerationGateway['resolveInput']>[0],
    ) => ({ ...input, modelSelection: { provider: 'openai' as const, model: 'test' } }),
    complete: vi.fn(async (): Promise<unknown> => ({ answer: '已回答' })),
    generate: vi.fn(async () => ({
      mime: 'text/html' as const,
      filename: 'scene.html',
      content: '<html><body>done</body></html>',
    })),
  };
  const projects = new HtmlProjectService(repository, provider, tasks);
  const conversations = new ConversationService(repository, provider, tasks);
  const commands = new ProjectCommands(repository, projects, conversations, tasks);
  await projects.onModuleInit();
  await commands.onModuleInit();
  cleanups.push(async () => {
    tasks.close();
    await commands.onModuleDestroy();
    await conversations.onModuleDestroy();
    await projects.onModuleDestroy();
    await rm(dir, { recursive: true, force: true });
  });
  const create = () =>
    projects.create(
      createHtmlProjectSchema.parse({
        requestId: randomUUID(),
        brief: 'A presentation',
        sourceHtml: '<html><body>original</body></html>',
      }),
    );
  return { directory: dir, repository, tasks, provider, projects, conversations, commands, create };
}
function command(projectId: string, question: string) {
  return projectCommandSchema.parse({
    id: randomUUID(),
    projectId,
    question,
    mode: 'ask',
    kind: 'message',
    append: false,
    timing: 'after',
  });
}
describe('durable project commands', () => {
  it('runs queued requests in order without a browser and deduplicates completed submissions', async () => {
    const { commands, create, provider, conversations } = await fixture();
    const project = await create();
    const first = command(project.id, '先解释');
    const second = command(project.id, '再举例');
    await commands.enqueue(project.id, first);
    await commands.enqueue(project.id, second);
    await vi.waitFor(() => expect(commands.list(project.id)).toEqual([]));
    expect(
      conversations
        .get(project.id)
        .messages.filter((item) => item.role === 'user')
        .map((item) => item.content),
    ).toEqual(['先解释', '再举例']);
    await commands.enqueue(project.id, first);
    expect(commands.list(project.id)).toEqual([]);
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });
  it('preserves queued work across restart and requires explicit retry before invoking a model', async () => {
    const initial = await fixture();
    const project = await initial.create();
    initial.tasks.register(randomUUID());
    initial.tasks.register(randomUUID());
    const input = command(project.id, '重启后继续');
    await initial.commands.enqueue(project.id, input);
    await initial.commands.onModuleDestroy();
    const reopened = await fixture(initial.directory);
    expect(reopened.commands.list(project.id)[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('重启'),
    });
    expect(reopened.provider.complete).not.toHaveBeenCalled();
    await reopened.commands.change(project.id, input.id, 'retry');
    await vi.waitFor(() => expect(reopened.commands.list(project.id)).toEqual([]));
    expect(reopened.provider.complete).toHaveBeenCalledTimes(1);
  });
  it('interrupts an active reply, runs its queued supplement and ignores late output', async () => {
    const { commands, create, provider, conversations } = await fixture();
    const project = await create();
    let release!: (value: { answer: string }) => void;
    provider.complete.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await commands.enqueue(project.id, command(project.id, '原任务'));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const supplement = command(project.id, '追加要求');
    await commands.enqueue(project.id, supplement);
    await commands.change(project.id, supplement.id, 'interrupt');
    await vi.waitFor(() => expect(commands.list(project.id)).toEqual([]));
    release({ answer: '迟到的旧结果' });
    expect(conversations.get(project.id).messages.map((item) => item.content)).toEqual([
      '追加要求',
      '已回答',
    ]);
  });
  it('rejects cross-project intents and changed requests reusing an active command ID', async () => {
    const { commands, create, tasks } = await fixture();
    const project = await create();
    tasks.register(randomUUID());
    tasks.register(randomUUID());
    const first = command(project.id, '原任务');
    await commands.enqueue(project.id, first);
    await expect(commands.enqueue(randomUUID(), first)).rejects.toThrow('属于');
    await expect(commands.enqueue(project.id, { ...first, question: '不同任务' })).rejects.toThrow(
      '标识',
    );
  });
  it('plans a new project through a durable command using independent save and run keys', async () => {
    const { commands, projects, provider } = await fixture();
    const project = await projects.create(
      createHtmlProjectSchema.parse({
        requestId: randomUUID(),
        brief: 'Initial brief',
        sceneCount: 1,
      }),
    );
    provider.complete.mockResolvedValueOnce({
      title: 'A plan',
      scenes: [{ title: 'Opening', objective: 'Explain', content: 'Example', layout: 'Readable' }],
    });
    await commands.enqueue(project.id, {
      ...command(project.id, '请规划一页介绍分数'),
      kind: 'plan',
    });
    await vi.waitFor(() => expect(commands.list(project.id)).toEqual([]));
    expect(projects.get(project.id).content.brief).toBe('请规划一页介绍分数');
    expect(projects.get(project.id).content.scenes).toHaveLength(1);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
  it('starts a new generation attempt on retry instead of returning the previous failed run', async () => {
    const { commands, create, provider, projects } = await fixture();
    const project = await create();
    provider.generate.mockRejectedValueOnce(new Error('upstream failure'));
    const input = {
      ...command(project.id, '改善版式'),
      interrupted: true,
      task: {
        action: 'scene' as const,
        goal: '修改当前页',
        sceneId: project.content.scenes[0]!.id,
        allowEdits: true,
        multiStep: false,
      },
    };
    await commands.enqueue(project.id, input);
    await vi.waitFor(() => expect(commands.list(project.id)[0]?.status).toBe('failed'));
    await commands.change(project.id, input.id, 'retry');
    await vi.waitFor(() => expect(commands.list(project.id)).toEqual([]));
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(projects.get(project.id).content.scenes[0]!.html).toContain('done');
  });
  it('starts the next queued command when a failed head is removed', async () => {
    const { commands, create, provider, conversations } = await fixture();
    const project = await create();
    provider.complete.mockRejectedValueOnce(new Error('upstream failure'));
    const first = command(project.id, '失败的要求');
    await commands.enqueue(project.id, first);
    await vi.waitFor(() => expect(commands.list(project.id)[0]?.status).toBe('failed'));
    await commands.enqueue(project.id, command(project.id, '下一条要求'));
    await commands.change(project.id, first.id, 'remove');
    await vi.waitFor(() => expect(commands.list(project.id)).toEqual([]));
    expect(conversations.get(project.id).messages[0]!.content).toBe('下一条要求');
  });
  it('lets an explicit retry take over planning when the initial planning request never arrived', async () => {
    const { commands, projects, provider } = await fixture();
    const project = await projects.create(
      createHtmlProjectSchema.parse({
        requestId: randomUUID(),
        brief: 'Initial brief',
        sceneCount: 1,
      }),
    );
    provider.complete.mockResolvedValueOnce({
      title: 'Recovered plan',
      scenes: [{ title: 'Opening', objective: 'Explain', content: 'Example', layout: 'Readable' }],
    });
    const input = {
      ...command(project.id, '补充要求'),
      kind: 'plan' as const,
      append: true,
      createdAt: new Date(Date.now() - 130000).toISOString(),
      task: { action: 'plan' as const, goal: '完成最初规划', allowEdits: true, multiStep: false },
    };
    await commands.enqueue(project.id, input);
    await vi.waitFor(() => expect(commands.list(project.id)[0]?.status).toBe('failed'));
    expect(provider.complete).not.toHaveBeenCalled();
    await commands.change(project.id, input.id, 'retry');
    await vi.waitFor(() => expect(commands.list(project.id)).toEqual([]));
    expect(projects.get(project.id).content.scenes).toHaveLength(1);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
  it('keeps an accepted command queued if model capacity is taken before admission', async () => {
    const { commands, create, tasks, provider } = await fixture();
    const project = await create();
    vi.spyOn(tasks, 'assertAvailable').mockImplementationOnce(() => {
      throw new TaskCapacityError('当前模型任务较多');
    });
    await commands.enqueue(project.id, command(project.id, '等待可用额度'));
    await vi.waitFor(() => expect(commands.list(project.id)).toEqual([]));
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
  it('does not admit the replacement reply until all interruption cleanup has finished', async () => {
    const { commands, create, provider, conversations } = await fixture();
    const project = await create();
    provider.complete.mockImplementationOnce(() => new Promise(() => {}));
    await commands.enqueue(project.id, command(project.id, '原任务'));
    await vi.waitFor(() => expect(provider.complete).toHaveBeenCalledTimes(1));
    let release!: () => void;
    let stopped = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stop = conversations.stop.bind(conversations);
    vi.spyOn(conversations, 'stop').mockImplementationOnce(async (id) => {
      const result = await stop(id);
      stopped = true;
      await gate;
      return result;
    });
    const next = command(project.id, '替换任务');
    await commands.enqueue(project.id, next);
    const change = commands.change(project.id, next.id, 'interrupt');
    await vi.waitFor(() => expect(stopped).toBe(true));
    expect(provider.complete).toHaveBeenCalledTimes(1);
    release();
    await change;
    await vi.waitFor(() => expect(commands.list(project.id)).toEqual([]));
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });
});
