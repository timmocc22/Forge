import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  GenerationInput,
  HtmlProject,
  GenerationExecution,
  ModelSelection,
} from '@studio/contracts';
import type { StructuredTextRequest } from '../../generation/ports.js';
import { HtmlProjectService } from '../authoring/project.service.js';
import { ConversationService } from '../conversation/conversation.service.js';
import { ProjectRepository } from '../persistence/project.repository.js';
import { ProjectTasks } from '../runtime/project-tasks.js';
import type { GenerationGateway } from '../../generation/ports.js';
import { buildConversationContext } from '../conversation/conversation-context.js';
import { createHtmlProjectSchema } from '@studio/contracts';

const directories: string[] = [];
const services: { onModuleDestroy(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.onModuleDestroy()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function setup(
  directory: string,
  provider: Pick<GenerationGateway, 'resolveInput' | 'complete' | 'generate'>,
) {
  const repository = new ProjectRepository(directory);
  const tasks = new ProjectTasks();
  const service = new HtmlProjectService(repository, provider, tasks);
  const conversations = new ConversationService(repository, provider, tasks);
  services.push(service, conversations);
  await service.onModuleInit();
  return { service, conversations, repository };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'forge-project-'));
  directories.push(directory);
  const generate = vi.fn(
    async (_input: GenerationInput, _signal: AbortSignal, execution?: GenerationExecution) => ({
      mime: 'text/html' as const,
      filename: 'scene.html',
      content:
        execution?.baseArtifact?.content.replace('</body>', '<p>AI revision</p></body>') ??
        '<html><body><h1>Generated page</h1></body></html>',
    }),
  );
  const provider = {
    resolveInput: (input: GenerationInput): GenerationInput => ({
      ...input,
      modelSelection: input.modelSelection ?? { provider: 'openai', model: 'test' },
    }),
    complete: vi.fn(
      async (
        _selection: ModelSelection,
        _request: StructuredTextRequest,
        _signal: AbortSignal,
      ): Promise<unknown> =>
        _request.name === 'forge_generation_plan'
          ? {
              question: '',
              options: [],
              steps: JSON.parse(_request.input).targetSceneIds.map((sceneId: string) => ({
                sceneId,
                instruction: '依据分镜生成页面',
              })),
            }
          : {
              title: 'A useful story',
              scenes: ['Opening', 'Example', 'Conclusion'].map((title) => ({
                title,
                objective: `Explain ${title}`,
                content: `Content for ${title}`,
                layout: 'Clear readable layout',
              })),
            },
    ),
    generate,
  };
  const { service, conversations, repository } = await setup(directory, provider);
  const project = await service.create({
    requestId: randomUUID(),
    brief: 'Explain fractions with examples',
    audience: 'Students',
    style: 'editorial',
    aspect: 'landscape',
    accent: '#e87844',
    sceneCount: 3,
  });
  return { service, conversations, repository, project, provider, directory };
}
async function settle(service: HtmlProjectService, id: string): Promise<HtmlProject> {
  await vi.waitFor(() => expect(service.get(id).run?.status).not.toBe('running'));
  return service.get(id);
}
async function planned(service: HtmlProjectService, project: HtmlProject) {
  await service.start(project.id, {
    expectedRevision: project.revision,
    requestId: randomUUID(),
    action: 'plan',
    instruction: '',
  });
  return settle(service, project.id);
}
function creativeReply(count = 7) {
  return {
    question: '',
    options: [],
    plan: {
      title: '适合课堂的分数故事',
      audience: '小学生',
      style: 'minimal',
      aspect: 'portrait',
      accent: '#336699',
      creativeDirection: {
        design: '手绘图解搭配大字和暖白底色。',
        rationale: '按课堂阅读场景拆分知识点，采用七页循序讲解。',
      },
      scenes: Array.from({ length: count }, (_, i) => ({
        title: `第 ${i + 1} 页`,
        objective: '一个知识点',
        content: '用分披萨说明分数',
        layout: '图解与讲解交替',
      })),
    },
  };
}
describe('AI creative decisions', () => {
  it('persists autonomous decisions and passes the visual direction into page generation', async () => {
    const { service, provider, directory } = await fixture();
    const project = await service.create(
      createHtmlProjectSchema.parse({
        requestId: randomUUID(),
        brief: '给小学生讲分数',
        creativeOptions: {},
        customPrompt: '多用图解',
        creationContext: { locale: 'zh-CN', timeZone: 'Asia/Shanghai' },
      }),
    );
    provider.complete.mockResolvedValueOnce(creativeReply());
    const result = await planned(service, project);
    expect(result.run?.status).toBe('succeeded');
    expect(result).toMatchObject({
      sceneCount: 7,
      content: { audience: '小学生', style: 'minimal', aspect: 'portrait', accent: '#336699' },
    });
    const request = provider.complete.mock.calls[0]![1];
    expect(request.name).toBe('forge_creative_storyboard');
    expect(JSON.parse(request.input)).toMatchObject({
      constraints: {},
      creativePreferences: '多用图解',
      environment: { locale: 'zh-CN' },
    });
    expect(JSON.parse(request.input)).not.toHaveProperty('requestedPages');
    const reloaded = new ProjectRepository(directory);
    await reloaded.initialize();
    expect(reloaded.get(project.id).project.content.creativeDirection).toEqual(
      creativeReply().plan.creativeDirection,
    );
    await service.start(project.id, {
      expectedRevision: result.revision,
      requestId: randomUUID(),
      action: 'build',
      instruction: '',
    });
    expect((await settle(service, project.id)).run?.status).toBe('succeeded');
    expect(
      JSON.parse(provider.generate.mock.calls[0]![2]!.instructions).project.creativeDirection
        .design,
    ).toContain('手绘图解');
  });
  it('honors individual fixed choices while letting AI decide other options', async () => {
    const { service, provider } = await fixture();
    const project = await service.create(
      createHtmlProjectSchema.parse({
        requestId: randomUUID(),
        brief: '分数教学',
        creativeOptions: { sceneCount: 2, style: 'cinematic' },
      }),
    );
    const reply = creativeReply(2);
    reply.plan.style = 'cinematic';
    provider.complete.mockResolvedValueOnce(reply);
    const result = await planned(service, project);
    expect(result.run?.status).toBe('succeeded');
    expect(result.content).toMatchObject({ style: 'cinematic', aspect: 'portrait' });
    expect(result.sceneCount).toBe(2);
  });
  it.each(['count', 'style', 'missing'] as const)(
    'rejects a plan that violates %s requirements without partial changes',
    async (kind) => {
      const { service, provider } = await fixture();
      const project = await service.create(
        createHtmlProjectSchema.parse({
          requestId: randomUUID(),
          brief: '分数教学',
          creativeOptions: { sceneCount: 2, style: 'minimal' },
        }),
      );
      const reply = creativeReply(kind === 'count' ? 7 : 2);
      if (kind === 'style') reply.plan.style = 'cinematic';
      provider.complete.mockResolvedValueOnce(
        kind === 'missing' ? { question: '', options: [], plan: null } : reply,
      );
      const result = await planned(service, project);
      expect(result.run?.status).toBe('failed');
      expect(result.content.scenes).toEqual([]);
      expect(result.content.creativeDirection).toBeUndefined();
    },
  );
  it('resumes a contextual planning question with the latest answer and bounded work history', async () => {
    const { service, provider, project: oldProject } = await fixture();
    await planned(service, oldProject);
    const project = await service.create(
      createHtmlProjectSchema.parse({
        requestId: randomUUID(),
        brief: '延续分数课的讲解',
        creativeOptions: {},
      }),
    );
    provider.complete.mockResolvedValueOnce({
      question: '这次给学生讲，还是给教师培训？',
      options: [{ label: '学生课堂', instruction: '给小学生讲解' }],
      plan: null,
    });
    const waiting = await planned(service, project);
    expect(waiting.run?.status).toBe('awaiting_input');
    provider.complete.mockResolvedValueOnce(creativeReply());
    await service.start(project.id, {
      expectedRevision: waiting.revision,
      requestId: randomUUID(),
      action: 'plan',
      instruction: '给小学生讲解，其余交给 AI 判断',
    });
    const result = await settle(service, project.id);
    expect(result.run?.status).toBe('succeeded');
    expect(result.run?.clarification).toBeUndefined();
    const context = JSON.parse(provider.complete.mock.calls.at(-1)![1].input);
    expect(context).toMatchObject({
      latestRequest: '给小学生讲解，其余交给 AI 判断',
      previousQuestion: '这次给学生讲，还是给教师培训？',
    });
    expect(context.recentWorks).toHaveLength(1);
    expect(context.recentWorks[0]).not.toHaveProperty('scenes');
  });
  it('retains the answer to a planning question after a failed attempt and retry', async () => {
    const { service, provider } = await fixture();
    const project = await service.create(
      createHtmlProjectSchema.parse({
        requestId: randomUUID(),
        brief: '分数课堂',
        creativeOptions: {},
      }),
    );
    provider.complete.mockResolvedValueOnce({
      question: '给哪个年级讲？',
      options: [],
      plan: null,
    });
    const waiting = await planned(service, project);
    provider.complete.mockRejectedValueOnce(new Error('temporary provider failure'));
    await service.start(project.id, {
      expectedRevision: waiting.revision,
      requestId: randomUUID(),
      action: 'plan',
      instruction: '给五年级讲',
    });
    const failed = await settle(service, project.id);
    expect(failed.run?.status).toBe('failed');
    provider.complete.mockResolvedValueOnce(creativeReply());
    expect((await planned(service, failed)).run?.status).toBe('succeeded');
    expect(JSON.parse(provider.complete.mock.calls.at(-1)![1].input)).toMatchObject({
      latestRequest: '给五年级讲',
      previousQuestion: '给哪个年级讲？',
    });
  });
});
describe('HTML project authoring', () => {
  it('persists valid GLM storyboard data without echoed JSON schema metadata', async () => {
    const { service, project, provider } = await fixture();
    const valid = await provider.complete(
      project.modelSelection,
      {} as StructuredTextRequest,
      new AbortController().signal,
    );
    provider.complete.mockResolvedValueOnce({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      ...(valid as object),
    });
    const result = await planned(service, project);
    expect(result.run?.status).toBe('succeeded');
    expect(result.content.scenes).toHaveLength(3);
    expect(result.content.scenes[0]).toMatchObject({ title: 'Opening', html: '', locked: false });
    expect(result.content).not.toHaveProperty('$schema');
    expect(result.content).not.toHaveProperty('type');
  });

  it('imports exported players as native pages and repairs previously imported players on load', async () => {
    const { service, project, provider, directory } = await fixture();
    const escape = (value: string) =>
      value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    const pages = Array.from(
      { length: 12 },
      (_, index) =>
        `<html><body><h1>Page ${index + 1} &amp; details</h1><script>const value = "<iframe>";</script></body></html>`,
    );
    const sourceHtml = `<html><body><main>${pages.map((html, index) => `<iframe title="Page ${index + 1}" srcdoc="${escape(html)}"></iframe>`).join('')}</main><nav><button id="prev"></button><span id="counter"></span><button id="next"></button></nav></body></html>`;
    const imported = await service.create({
      requestId: randomUUID(),
      brief: 'Imported player',
      audience: 'Readers',
      style: 'minimal',
      aspect: 'landscape',
      accent: '#123456',
      sceneCount: 1,
      sourceHtml,
    });
    expect(imported.sceneCount).toBe(12);
    expect(imported.content.scenes.map((scene) => scene.html)).toEqual(pages);
    expect(imported.content.scenes.map((scene) => scene.title)).toEqual(
      pages.map((_, index) => `Page ${index + 1}`),
    );
    expect(new Set(imported.content.scenes.map((scene) => scene.id)).size).toBe(12);
    expect(service.list().find((item) => item.id === imported.id)).toMatchObject({
      sceneCount: 12,
      builtCount: 12,
    });

    // Simulate an existing record from before per-page import was supported.
    const path = join(directory, `${imported.id}.json`);
    const record = new ProjectRepository(directory);
    await record.initialize();
    const legacy = record.get(imported.id);
    legacy.project.content.scenes = [{ ...imported.content.scenes[0]!, html: sourceHtml }];
    legacy.project.sceneCount = 1;
    legacy.history = [structuredClone(legacy.project.content)];
    await writeFile(path, JSON.stringify(legacy));
    const { service: reloaded } = await setup(directory, provider);
    const repaired = reloaded.get(imported.id);
    expect(repaired.content.scenes.map((scene) => scene.html)).toEqual(pages);
    expect(repaired.content.scenes[0]!.id).toBe(imported.content.scenes[0]!.id);
    expect(repaired.updatedAt).toBe(imported.updatedAt);
    expect(repaired.revision).toBe(imported.revision + 1);
    expect(reloaded.list().find((item) => item.id === imported.id)).toMatchObject({
      sceneCount: 12,
      builtCount: 12,
    });
    const { service: again } = await setup(directory, provider);
    expect(again.get(imported.id)).toEqual(repaired);
    expect(service.get(project.id)).toEqual(project);
  });
  it('persists custom preferences and forwards them to planning, generation and conversation', async () => {
    const { service, project, provider, directory } = await fixture();
    const customPrompt = '使用暖白底色和生活化教学例子';
    const saved = await service.save(project.id, {
      expectedRevision: project.revision,
      operationId: randomUUID(),
      content: { ...project.content, customPrompt },
    });
    const plan = await planned(service, saved);
    expect(JSON.parse(provider.complete.mock.calls[0]![1].input).customPrompt).toBe(customPrompt);
    await service.start(plan.id, {
      expectedRevision: plan.revision,
      requestId: randomUUID(),
      action: 'build',
      instruction: '',
    });
    const built = await settle(service, plan.id);
    expect(
      JSON.parse(provider.generate.mock.calls[0]![2]!.instructions!).project.customPrompt,
    ).toBe(customPrompt);
    const context = buildConversationContext(
      built,
      built.content.scenes[0]!,
      {
        id: randomUUID(),
        projectId: built.id,
        messages: [],
      },
      '怎么改进？',
    );
    expect(JSON.parse(context.input).project.customPrompt).toBe(customPrompt);
    const reopened = await setup(directory, provider);
    expect(reopened.service.get(built.id).content.customPrompt).toBe(customPrompt);
    const created = await service.create({
      requestId: randomUUID(),
      brief: '新作品',
      audience: '读者',
      sceneCount: 3,
      style: 'minimal',
      aspect: 'landscape',
      accent: '#e87844',
      customPrompt,
    });
    expect(created.content.customPrompt).toBe(customPrompt);
  });
  it('edits another page through tools, saves transcript and HTML together, reopens and undoes', async () => {
    const { service, conversations, project, provider, directory } = await fixture();
    let plan = await planned(service, project);
    const content = structuredClone(plan.content);
    content.scenes[1]!.html =
      '<html><body><h1>Example</h1><p id="manual">保留人工修改</p></body></html>';
    plan = await service.save(plan.id, {
      expectedRevision: plan.revision,
      operationId: randomUUID(),
      content,
    });
    const target = plan.content.scenes[1]!;
    provider.complete.mockImplementationOnce(async (_selection, request) => {
      expect(request.tools!.definitions.map((tool) => tool.name)).toEqual([
        'list_scenes',
        'read_scene',
        'revise_scene',
      ]);
      expect(await request.tools!.execute('list_scenes', '{}')).toMatchObject({
        revision: plan.revision,
        scenes: [{ pageNumber: 1 }, { pageNumber: 2, id: target.id }, { pageNumber: 3 }],
      });
      expect(
        await request.tools!.execute('read_scene', JSON.stringify({ sceneId: target.id })),
      ).toMatchObject({ scene: target });
      expect(
        await request.tools!.execute(
          'revise_scene',
          JSON.stringify({
            sceneId: target.id,
            expectedRevision: plan.revision,
            instruction: '把标题改成分数的日常应用',
          }),
        ),
      ).toMatchObject({ revision: plan.revision + 1, scene: { title: '分数的日常应用' } });
      expect(service.get(plan.id)).toEqual(plan); // No write before final answer.
      return { answer: '已修改第二页标题。' };
    });
    provider.complete.mockResolvedValueOnce({
      title: '分数的日常应用',
      objective: target.objective,
      content: target.content,
      layout: target.layout,
      html: target.html.replace('Example', '分数的日常应用'),
    });
    const result = await conversations.ask(plan.id, {
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: '把第二页标题改成分数的日常应用',
      allowEdits: true,
    });
    expect(result.project?.content.scenes[1]?.title).toBe('分数的日常应用');
    expect(result.project?.content.scenes[1]?.html).toContain(
      '<h1>分数的日常应用</h1><p id="manual">保留人工修改</p>',
    );
    expect(result.project?.undoDepth).toBe(plan.undoDepth + 1);
    expect(result.project?.content.scenes[0]).toEqual(plan.content.scenes[0]);
    const reopened = await setup(directory, provider);
    expect(reopened.service.get(plan.id)).toEqual(result.project);
    expect(reopened.conversations.get(plan.id)).toEqual(result.conversation);
    const undone = await service.undo(plan.id, result.revision, randomUUID());
    expect(undone.content).toEqual(plan.content);
  });
  it('returns tool validation errors and enforces lock, project scope, revision and read-only mode', async () => {
    const { service, conversations, project, provider } = await fixture();
    const plan = await planned(service, project);
    plan.content.scenes[0]!.locked = true;
    const saved = await service.save(plan.id, {
      expectedRevision: plan.revision,
      operationId: randomUUID(),
      content: plan.content,
    });
    provider.complete.mockImplementationOnce(async (_selection, request) => {
      const execute = request.tools!.execute;
      expect(await execute('list_scenes', '{')).toMatchObject({ error: 'INVALID_ARGUMENTS' });
      expect(await execute('list_scenes', '{"extra":true}')).toMatchObject({
        error: 'INVALID_ARGUMENTS',
      });
      expect(await execute('delete_scene', '{}')).toMatchObject({ error: 'HTTP_400' });
      expect(await execute('read_scene', JSON.stringify({ sceneId: randomUUID() }))).toMatchObject({
        error: 'HTTP_404',
      });
      const args = {
        sceneId: saved.content.scenes[0]!.id,
        expectedRevision: saved.revision,
        instruction: '改标题',
      };
      expect(await execute('revise_scene', JSON.stringify(args))).toMatchObject({
        error: 'HTTP_400',
        message: expect.stringContaining('锁定'),
      });
      expect(
        await execute(
          'revise_scene',
          JSON.stringify({ ...args, sceneId: saved.content.scenes[1]!.id, expectedRevision: 0 }),
        ),
      ).toMatchObject({ error: 'HTTP_409' });
      return { answer: '锁定页不能修改。' };
    });
    const input = {
      expectedRevision: saved.revision,
      sceneId: saved.content.scenes[0]!.id,
      question: '修改标题',
    };
    await conversations.ask(saved.id, input);
    provider.complete.mockImplementationOnce(async (_selection, request) => {
      expect(request.tools!.definitions).toHaveLength(2);
      expect(await request.tools!.execute('revise_scene', '{}')).toMatchObject({
        error: 'HTTP_400',
        message: '询问模式不能修改页面',
      });
      return { answer: '仅提供建议。' };
    });
    await conversations.ask(saved.id, { ...input, allowEdits: false });
    expect(service.get(saved.id)).toEqual(saved);
  });
  it.each(['reply failure', 'concurrent edit'])(
    'does not commit staged page changes after %s',
    async (failure) => {
      const { service, conversations, project, provider } = await fixture();
      const plan = await planned(service, project);
      const scene = plan.content.scenes[0]!;
      provider.complete.mockImplementationOnce(async (_selection, request) => {
        await request.tools!.execute(
          'revise_scene',
          JSON.stringify({
            sceneId: scene.id,
            expectedRevision: plan.revision,
            instruction: '修改标题',
          }),
        );
        if (failure === 'reply failure') throw new Error('private details');
        const content = structuredClone(plan.content);
        content.title = 'Concurrent manual edit';
        await service.save(plan.id, {
          expectedRevision: plan.revision,
          operationId: randomUUID(),
          content,
        });
        return { answer: '已修改。' };
      });
      provider.complete.mockResolvedValueOnce({
        title: '新标题',
        objective: scene.objective,
        content: scene.content,
        layout: scene.layout,
        html: '',
      });
      await expect(
        conversations.ask(plan.id, {
          expectedRevision: plan.revision,
          sceneId: scene.id,
          question: '修改标题',
        }),
      ).rejects.toThrow(failure === 'reply failure' ? '询问失败' : '其他窗口');
      expect(service.get(plan.id).content.scenes).toEqual(plan.content.scenes);
      expect(conversations.get(plan.id).messages).toEqual([]);
    },
  );
  it('persists archive/restore and deletes the project and transcript from disk', async () => {
    const { service, project, repository, directory } = await fixture();
    const archived = await service.archive(project.id, true, project.revision);
    expect(service.list().find((item) => item.id === project.id)?.archived).toBe(true);
    const disk = new ProjectRepository(directory);
    await disk.initialize();
    expect(disk.get(project.id).project.archived).toBe(true);
    await expect(service.remove(project.id, project.revision)).rejects.toThrow('其他窗口');
    const restored = await service.archive(project.id, false, archived.revision);
    expect(restored.archived).toBe(false);
    await service.remove(project.id, restored.revision);
    expect(service.list()).toHaveLength(0);
    expect(() => repository.get(project.id)).toThrow('项目不存在');
    const reloaded = new ProjectRepository(directory);
    await reloaded.initialize();
    expect(reloaded.list()).toHaveLength(0);
    await expect(readFile(join(directory, `${project.id}.json`))).rejects.toThrow();
  });
  it('duplicates pages and conversations independently and deduplicates retry requests', async () => {
    const { service, project, conversations, directory } = await fixture();
    const plan = await planned(service, project);
    await conversations.ask(plan.id, {
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: 'Explain this page',
      modelSelection: { provider: 'demo', model: 'local-sample' },
    });
    const archived = await service.archive(plan.id, true, plan.revision);
    const requestId = randomUUID();
    const copy = await service.duplicate(plan.id, requestId, archived.revision);
    expect(copy.id).not.toBe(plan.id);
    expect(copy.content.scenes).toEqual(plan.content.scenes);
    expect(copy.archived).toBe(false);
    expect(copy.run).toBeUndefined();
    expect(copy.undoDepth).toBe(0);
    expect((await service.duplicate(plan.id, requestId, archived.revision)).id).toBe(copy.id);
    const transcript = conversations.get(copy.id);
    expect(transcript.projectId).toBe(copy.id);
    expect(transcript.messages.map((message) => message.content)).toEqual(
      conversations.get(plan.id).messages.map((message) => message.content),
    );
    expect(transcript.messages[0]?.id).not.toBe(conversations.get(plan.id).messages[0]?.id);
    const content = structuredClone(copy.content);
    content.scenes[0]!.content = 'Changed only in copy';
    await service.save(copy.id, { expectedRevision: 0, operationId: randomUUID(), content });
    expect(service.get(plan.id).content.scenes[0]!.content).not.toBe(content.scenes[0]!.content);
    await service.remove(plan.id, archived.revision);
    const reloaded = new ProjectRepository(directory);
    await reloaded.initialize();
    expect(reloaded.get(copy.id).conversation?.messages).toHaveLength(2);
  });
  it('answers from the saved current page and project without mutating any project state', async () => {
    const { service, conversations, project, provider, directory } = await fixture();
    const plan = await planned(service, project);
    const content = structuredClone(plan.content);
    content.scenes[1]!.html = '<html><body><h1>Human edited example</h1></body></html>';
    content.scenes[1]!.locked = true;
    const saved = await service.save(plan.id, {
      expectedRevision: plan.revision,
      operationId: randomUUID(),
      content,
    });
    provider.complete.mockResolvedValueOnce({ answer: '本页通过案例解释分数。建议补充图示。' });
    const modelSelection = { provider: 'zhipu', model: 'glm-5.3', reasoningEffort: 'max' } as const;
    const question = {
      expectedRevision: saved.revision,
      sceneId: content.scenes[1]!.id,
      question: '这页讲了什么？有什么可以改进的地方？',
      modelSelection,
    };
    const result = await conversations.ask(saved.id, question);
    expect(result).toEqual({
      answer: '本页通过案例解释分数。建议补充图示。',
      conversation: conversations.get(saved.id),
      sceneId: question.sceneId,
      revision: saved.revision,
      modelSelection,
    });
    const [selection, request] = provider.complete.mock.calls.at(-1)!;
    expect(selection).toEqual(modelSelection);
    const context = JSON.parse(request.input);
    expect(context.question).toBe(question.question);
    expect(context.project.brief).toBe(content.brief);
    expect(context.scene).toEqual(content.scenes[1]);
    expect(context.pageNumber).toBe(2);
    expect(context.storyboard).toHaveLength(3);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(service.get(saved.id)).toEqual(saved);
    const reopened = await setup(directory, provider);
    expect(reopened.service.get(saved.id)).toEqual(saved);
  });
  it('rejects stale pages, missing pages, provider failures and empty answers without writing', async () => {
    const { service, conversations, project, provider } = await fixture();
    const plan = await planned(service, project);
    const input = {
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: '请解释本页',
    };
    provider.complete.mockClear();
    await expect(conversations.ask(plan.id, { ...input, expectedRevision: 0 })).rejects.toThrow(
      '其他窗口',
    );
    await expect(conversations.ask(plan.id, { ...input, sceneId: randomUUID() })).rejects.toThrow(
      '不存在',
    );
    expect(provider.complete).not.toHaveBeenCalled();
    provider.complete.mockRejectedValueOnce(new Error('private upstream error'));
    await expect(conversations.ask(plan.id, input)).rejects.toThrow('询问失败');
    provider.complete.mockResolvedValueOnce({ answer: '  ' });
    await expect(conversations.ask(plan.id, input)).rejects.toThrow('询问失败');
    expect(service.get(plan.id)).toEqual(plan);
  });

  it('retains chronological turns across pages and restart, isolates projects, and excludes failed replies', async () => {
    const { service, conversations, project, provider, directory } = await fixture();
    const plan = await planned(service, project);
    const input = {
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: '这页适合小学生吗？',
    };
    provider.complete.mockResolvedValueOnce({ answer: '术语较多，可以用分披萨解释。' });
    await conversations.ask(plan.id, input);
    provider.complete.mockRejectedValueOnce(new Error('failed'));
    await expect(
      conversations.ask(plan.id, { ...input, question: '失败的问题' }),
    ).rejects.toThrow();
    const reopened = await setup(directory, provider);
    expect(reopened.conversations.get(plan.id)).toEqual(conversations.get(plan.id));
    provider.complete.mockResolvedValueOnce({ answer: '把一个披萨平均分成四块，每块是四分之一。' });
    const followup = {
      ...input,
      sceneId: plan.content.scenes[1]!.id,
      question: '你刚才说的例子，具体举一个。',
    };
    const result = await reopened.conversations.ask(plan.id, followup);
    const context = JSON.parse(provider.complete.mock.calls.at(-1)![1].input);
    expect(
      context.messages.map((message: { role: string; content: string }) => [
        message.role,
        message.content,
      ]),
    ).toEqual([
      ['user', input.question],
      ['assistant', '术语较多，可以用分披萨解释。'],
    ]);
    expect(
      context.messages.every((message: { sceneId: string }) => message.sceneId === input.sceneId),
    ).toBe(true);
    expect(context.scene.id).toBe(followup.sceneId);
    expect(result.conversation.messages).toHaveLength(4);
    expect(result.conversation.messages[3]).toMatchObject({
      role: 'assistant',
      sceneId: followup.sceneId,
    });
    const other = await reopened.service.create({
      requestId: randomUUID(),
      brief: 'Other',
      audience: 'Readers',
      sceneCount: 1,
      style: 'minimal',
      aspect: 'square',
      accent: '#123456',
    });
    expect(reopened.conversations.get(other.id).messages).toEqual([]);
    expect(reopened.service.get(plan.id)).toEqual(plan);
  });
  it('never persists half a turn on disk failure and permits a complete retry', async () => {
    const { service, conversations, project, provider, directory } = await fixture();
    const plan = await planned(service, project);
    const path = join(directory, `${plan.id}.json`);
    const input = {
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: '请举一个生活中的例子',
    };
    provider.complete.mockResolvedValue({ answer: '把一个披萨平均分成四块。' });
    await rm(path);
    await mkdir(path);
    await expect(conversations.ask(plan.id, input)).rejects.toThrow('询问失败');
    expect(conversations.get(plan.id).messages).toEqual([]);
    expect(service.get(plan.id)).toEqual(plan);
    await rm(path, { recursive: true });
    const result = await conversations.ask(plan.id, input);
    expect(result.conversation.messages.map(({ role }) => role)).toEqual(['user', 'assistant']);
    const reopened = await setup(directory, provider);
    expect(reopened.conversations.get(plan.id)).toEqual(result.conversation);
    expect(reopened.service.get(plan.id)).toEqual(plan);
  });

  it('persists an interrupted question across restart and retries it only once', async () => {
    const { service, conversations, project, provider, directory, repository } = await fixture();
    const plan = await planned(service, project);
    const input = {
      requestId: randomUUID(),
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: '继续解释这个例子',
      allowEdits: false,
    };
    provider.complete.mockRejectedValueOnce(new Error('offline'));
    await expect(conversations.ask(plan.id, input)).rejects.toThrow('询问失败');
    expect(conversations.get(plan.id).pending).toMatchObject({ input, status: 'interrupted' });
    // Simulate a process exiting while its durable request was still marked running.
    await repository.transaction(async (tx) => {
      const record = tx.get(plan.id);
      record.conversation!.pending!.status = 'running';
      await tx.save(record, false);
    });
    const reopened = await setup(directory, provider);
    expect(reopened.conversations.get(plan.id).pending).toMatchObject({
      input,
      status: 'interrupted',
    });
    provider.complete.mockResolvedValueOnce({ answer: '恢复后的完整回答' });
    const result = await reopened.conversations.ask(plan.id, input);
    expect(result.conversation.pending).toBeUndefined();
    expect(result.conversation.messages).toHaveLength(2);
    const calls = provider.complete.mock.calls.length;
    // Even a retry with an old revision receives the already committed result.
    expect(
      await reopened.conversations.ask(plan.id, { ...input, expectedRevision: 0 }),
    ).toMatchObject({ answer: result.answer });
    expect(provider.complete).toHaveBeenCalledTimes(calls);
    expect(reopened.conversations.get(plan.id).messages).toHaveLength(2);
  });
  it.each(['after', 'interrupt'] as const)(
    'passes the original goal and supplement to the model for %s continuations',
    async (timing) => {
      const { service, conversations, project, provider } = await fixture();
      const plan = await planned(service, project);
      provider.complete.mockResolvedValueOnce({ answer: '已按原任务补充' });
      const continuation = {
        action: 'conversation' as const,
        goal: '优化全部页面的教学结构',
        timing,
      };
      const result = await conversations.ask(plan.id, {
        requestId: randomUUID(),
        expectedRevision: plan.revision,
        sceneId: plan.content.scenes[0]!.id,
        question: '增加适合三年级的实例',
        continuation,
      });
      const modelRequest = provider.complete.mock.calls.at(-1)![1];
      expect(JSON.parse(modelRequest.input)).toMatchObject({
        question: '增加适合三年级的实例',
        continuation,
      });
      expect(modelRequest.instructions).toContain('Continue pursuing continuation.goal');
      expect(result.conversation.messages[0]!.continuation).toEqual(continuation);
    },
  );
  it('stops a reply, rejects late output and can resume the saved question', async () => {
    const { service, conversations, project, provider } = await fixture();
    const plan = await planned(service, project);
    let resolve!: (value: unknown) => void;
    provider.complete.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const input = {
      requestId: randomUUID(),
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: '解释当前页',
    };
    const pending = conversations.ask(plan.id, input);
    const rejected = expect(pending).rejects.toThrow('回复已停止');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    expect(conversations.get(plan.id).pending?.status).toBe('running');
    expect((await conversations.stop(plan.id)).pending?.status).toBe('interrupted');
    resolve({ answer: '迟到的回答' });
    await rejected;
    expect(conversations.get(plan.id).messages).toEqual([]);
    provider.complete.mockResolvedValueOnce({ answer: '重新回答' });
    const result = await conversations.ask(plan.id, input);
    expect(result.conversation.messages).toHaveLength(2);
    expect(result.answer).toBe('重新回答');
    expect(service.get(plan.id)).toEqual(plan);
  });

  it('rejects transcripts belonging to another project without replacing the saved record', async () => {
    const { service, conversations, repository, project, directory } = await fixture();
    const path = join(directory, `${project.id}.json`);
    const before = await readFile(path, 'utf8');
    await expect(
      repository.transaction(async (transaction) => {
        const record = transaction.get(project.id);
        record.conversation = { id: randomUUID(), projectId: randomUUID(), messages: [] };
        await transaction.save(record, false);
      }),
    ).rejects.toThrow('对话必须属于当前项目');
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(conversations.get(project.id).messages).toEqual([]);
    expect(service.get(project.id)).toEqual(project);
  });
  it('bounds model history to recent complete turns while retaining the full transcript', async () => {
    const { service, conversations, project, provider } = await fixture();
    const plan = await planned(service, project);
    provider.complete.mockResolvedValue({ answer: 'An example' });
    for (let turn = 0; turn < 12; turn++) {
      await conversations.ask(plan.id, {
        expectedRevision: plan.revision,
        sceneId: plan.content.scenes[0]!.id,
        question: `Question ${turn}`,
      });
    }
    const context = JSON.parse(provider.complete.mock.calls.at(-1)![1].input);
    expect(context.messages).toHaveLength(20);
    expect(context.messages[0].content).toBe('Question 1');
    expect(context.messages.at(-1).role).toBe('assistant');
    expect(conversations.get(plan.id).messages).toHaveLength(24);
  });
  it('serializes questions within a project and preserves edits saved while a reply is in flight', async () => {
    const { service, conversations, project, provider } = await fixture();
    const plan = await planned(service, project);
    let resolve!: (value: unknown) => void;
    provider.complete.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const input = {
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: 'Explain',
    };
    const pending = conversations.ask(plan.id, input);
    await expect(conversations.ask(plan.id, input)).rejects.toThrow('正在回复');
    const content = structuredClone(plan.content);
    content.title = 'Edited during question';
    const saved = await service.save(plan.id, {
      expectedRevision: plan.revision,
      operationId: randomUUID(),
      content,
    });
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve({ answer: 'Answer' });
    await pending;
    expect(service.get(plan.id)).toEqual(saved);
    expect(conversations.get(plan.id).messages).toHaveLength(2);
  });

  it('isolates repository snapshots and keeps the write queue usable after disk failure', async () => {
    const { service, repository, project, directory } = await fixture();
    const snapshot = repository.get(project.id);
    snapshot.project.content.title = 'Unsaved';
    repository.all()[0]!.project.content.title = 'Also unsaved';
    expect(service.get(project.id)).toEqual(project);
    const path = join(directory, `${project.id}.json`);
    const previous = JSON.parse(await readFile(path, 'utf8'));
    // Make the atomic rename fail without relying on OS-specific permission behavior.
    await rm(path);
    await mkdir(path);
    const change = {
      expectedRevision: project.revision,
      operationId: randomUUID(),
      content: snapshot.project.content,
    };
    await expect(service.save(project.id, change)).rejects.toThrow();
    expect(service.get(project.id)).toEqual(project);
    await rm(path, { recursive: true });
    const saved = await service.save(project.id, change);
    expect(saved.content.title).toBe('Unsaved');
    const persisted = JSON.parse(await readFile(path, 'utf8'));
    expect(Object.keys(persisted)).toEqual(Object.keys(previous));
    expect(persisted.schemaVersion).toBe(2);
    const reopened = new ProjectRepository(directory);
    await reopened.initialize();
    expect(reopened.get(saved.id).project).toEqual(saved);
  });
  it('shares task capacity across generation and conversation and releases it after cancellation', async () => {
    const { service, conversations, project, provider } = await fixture();
    const plan = await planned(service, project);
    const createOther = () =>
      service.create({
        requestId: randomUUID(),
        brief: 'Another project',
        audience: 'Readers',
        sceneCount: 1,
        style: 'minimal',
        aspect: 'square',
        accent: '#123456',
        sourceHtml: '<html><body>Page</body></html>',
      });
    const other = await createOther();
    const third = await createOther();
    let resolve!: (value: unknown) => void;
    provider.generate.mockImplementationOnce(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    await service.start(plan.id, {
      expectedRevision: plan.revision,
      requestId: randomUUID(),
      action: 'build',
      instruction: '',
    });
    await vi.waitFor(() => expect(provider.generate).toHaveBeenCalled());
    provider.complete.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = conversations.ask(other.id, {
      expectedRevision: other.revision,
      sceneId: other.content.scenes[0]!.id,
      question: 'Explain',
    });
    const thirdInput = {
      expectedRevision: third.revision,
      sceneId: third.content.scenes[0]!.id,
      question: 'Explain',
    };
    await expect(conversations.ask(third.id, thirdInput)).rejects.toThrow('任务较多');
    try {
      await service.cancel(plan.id);
      provider.complete.mockResolvedValueOnce({ answer: 'Third answer' });
      // Cancellation marks the run immediately; admission is released when its worker settles.
      await vi.waitFor(async () => {
        await expect(conversations.ask(third.id, thirdInput)).resolves.toMatchObject({
          answer: 'Third answer',
        });
      });
    } finally {
      resolve({ answer: 'Second answer' });
      await pending;
    }
    expect(conversations.get(other.id).messages).toHaveLength(2);
    expect(conversations.get(third.id).messages).toHaveLength(2);
  });
  it('aborts pending conversation work on shutdown without saving a late reply', async () => {
    const { service, conversations, project, provider } = await fixture();
    const plan = await planned(service, project);
    provider.complete.mockImplementationOnce(
      (_selection, _request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const pending = conversations.ask(plan.id, {
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: 'Explain',
    });
    const rejected = expect(pending).rejects.toThrow('回复已停止');
    await conversations.onModuleDestroy();
    await rejected;
    expect(conversations.get(plan.id).messages).toEqual([]);
    expect(service.get(plan.id)).toEqual(plan);
  });
  it('assembles bounded context without changing source records or including unrelated page HTML', async () => {
    const { service, conversations, project } = await fixture();
    const plan = await planned(service, project);
    const conversation = conversations.get(plan.id);
    const scene = plan.content.scenes[1]!;
    conversation.messages = Array.from({ length: 6 }, (_, index) => ({
      id: randomUUID(),
      role: index % 2 ? ('assistant' as const) : ('user' as const),
      content: 'x'.repeat(16000),
      sceneId: plan.content.scenes[0]!.id,
      createdAt: new Date().toISOString(),
    }));
    const before = structuredClone({ plan, conversation });
    const context = JSON.parse(
      buildConversationContext(plan, scene, conversation, 'Follow up').input,
    );
    expect(context.messages).toHaveLength(4);
    expect(context.messages[0].id).toBe(conversation.messages[2]!.id);
    expect(context.scene).toEqual(scene);
    expect(context.pageNumber).toBe(2);
    expect(context.project).not.toHaveProperty('scenes');
    expect(context.storyboard.every((item: object) => !('html' in item))).toBe(true);
    expect({ plan, conversation }).toEqual(before);
  });

  it('persists the selected reasoning level and uses it for both planning and page generation', async () => {
    const { service, project, provider, directory } = await fixture();
    const modelSelection = { provider: 'zhipu', model: 'glm-5.3', reasoningEffort: 'max' } as const;
    await service.start(project.id, {
      expectedRevision: project.revision,
      requestId: randomUUID(),
      action: 'plan',
      instruction: '',
      modelSelection,
    });
    const plan = await settle(service, project.id);
    expect(provider.complete).toHaveBeenCalledWith(
      modelSelection,
      expect.any(Object),
      expect.any(AbortSignal),
    );
    await service.start(project.id, {
      expectedRevision: plan.revision,
      requestId: randomUUID(),
      action: 'build',
      instruction: '',
    });
    await settle(service, project.id);
    expect(provider.generate.mock.calls[0]![0].modelSelection).toEqual(modelSelection);
    const reopened = await setup(directory, provider);
    expect(reopened.service.get(project.id).modelSelection).toEqual(modelSelection);
    expect(reopened.service.get(project.id).run?.modelSelection).toEqual(modelSelection);
  });
  it('plans before building, persists edits and rejects stale overwrites', async () => {
    const { service, project, directory, provider } = await fixture();
    const plan = await planned(service, project);
    expect(plan.content.scenes).toHaveLength(3);
    expect(plan.content.scenes.every((scene) => scene.html === '')).toBe(true);
    const content = structuredClone(plan.content);
    content.scenes[0]!.title = 'Human edited title';
    const operationId = randomUUID();
    const saved = await service.save(plan.id, {
      expectedRevision: plan.revision,
      operationId,
      content,
    });
    expect(
      (await service.save(plan.id, { expectedRevision: plan.revision, operationId, content }))
        .revision,
    ).toBe(saved.revision);
    await expect(
      service.save(plan.id, {
        expectedRevision: plan.revision,
        operationId: randomUUID(),
        content: plan.content,
      }),
    ).rejects.toThrow('其他窗口');
    const reopened = await setup(directory, provider);
    expect(reopened.service.get(plan.id).content.scenes[0]!.title).toBe('Human edited title');
  });
  it('revises from saved manual HTML and leaves every other page untouched; undo restores it', async () => {
    const { service, project, provider } = await fixture();
    const plan = await planned(service, project);
    const content = structuredClone(plan.content);
    content.scenes[0]!.html = '<html><body><h1>Manual change</h1><p>Keep this</p></body></html>';
    content.scenes[1]!.locked = true;
    const saved = await service.save(plan.id, {
      expectedRevision: plan.revision,
      operationId: randomUUID(),
      content,
    });
    await service.start(plan.id, {
      action: 'scene',
      sceneId: content.scenes[0]!.id,
      instruction: 'Add one example',
      expectedRevision: saved.revision,
      requestId: randomUUID(),
    });
    const result = await settle(service, plan.id);
    expect(provider.generate.mock.calls[0]![2]?.baseArtifact?.content).toBe(
      content.scenes[0]!.html,
    );
    expect(result.content.scenes[0]!.html).toContain('Manual change');
    expect(result.content.scenes.slice(1)).toEqual(content.scenes.slice(1));
    expect((await service.undo(plan.id, result.revision, randomUUID())).content).toEqual(
      saved.content,
    );
  });
  it('build skips locked and completed scenes and duplicate run requests never generate twice', async () => {
    const { service, project, provider } = await fixture();
    const plan = await planned(service, project);
    const content = structuredClone(plan.content);
    content.scenes[0]!.locked = true;
    content.scenes[1]!.html = '<html><body>Keep built scene</body></html>';
    const saved = await service.save(plan.id, {
      expectedRevision: plan.revision,
      operationId: randomUUID(),
      content,
    });
    const request = {
      action: 'build' as const,
      expectedRevision: saved.revision,
      requestId: randomUUID(),
      instruction: '',
    };
    await Promise.all([service.start(plan.id, request), service.start(plan.id, request)]);
    const result = await settle(service, plan.id);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(result.content.scenes.slice(0, 2)).toEqual(content.scenes.slice(0, 2));
    await service.start(plan.id, request);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('cancellation wins against a provider returning late', async () => {
    const { service, project, provider } = await fixture();
    const plan = await planned(service, project);
    let resolve: (value: {
      mime: 'text/html';
      filename: string;
      content: string;
    }) => void = () => {};
    provider.generate.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await service.start(plan.id, {
      action: 'build',
      expectedRevision: plan.revision,
      requestId: randomUUID(),
      instruction: '',
    });
    await vi.waitFor(() => expect(provider.generate).toHaveBeenCalled());
    await service.cancel(plan.id);
    resolve({
      mime: 'text/html',
      filename: 'late.html',
      content: '<html><body>Late result</body></html>',
    });
    await service.onModuleDestroy();
    const result = service.get(plan.id);
    expect(result.run?.status).toBe('cancelled');
    expect(result.content).toEqual(plan.content);
  });
  it('restart marks interrupted work failed while retaining saved scene content', async () => {
    const { service, project, provider, directory } = await fixture();
    const plan = await planned(service, project);
    provider.generate.mockImplementation(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    await service.start(plan.id, {
      action: 'build',
      expectedRevision: plan.revision,
      requestId: randomUUID(),
      instruction: '',
    });
    await vi.waitFor(() => expect(provider.generate).toHaveBeenCalled());
    await service.onModuleDestroy();
    const reopened = await setup(directory, provider);
    expect(reopened.service.get(plan.id).run?.status).toBe('failed');
    expect(reopened.service.get(plan.id).content).toEqual(plan.content);
  });
});

describe('multi-step page tasks', () => {
  const pageFields = (scene: HtmlProject['content']['scenes'][number]) => ({
    title: scene.title,
    objective: scene.objective,
    content: scene.content,
    layout: scene.layout,
    html: scene.html,
  });
  it('persists live progress, commits two edits together, deduplicates retries and undoes once', async () => {
    const { service, conversations, project, provider, directory } = await fixture();
    const plan = await planned(service, project);
    const steps = plan.content.scenes.slice(0, 2).map((scene) => ({
      sceneId: scene.id,
      instruction: `为 ${scene.title} 补充示例`,
    }));
    provider.complete.mockResolvedValueOnce({ steps });
    for (const [index, scene] of plan.content.scenes.slice(0, 2).entries()) {
      provider.complete.mockImplementationOnce(async () => {
        expect(service.get(plan.id).content).toEqual(plan.content);
        const progress = conversations.get(plan.id).pending!.task!;
        expect(progress.phase).toBe('executing');
        expect(progress.steps[index]!.status).toBe('running');
        if (index) expect(progress.steps[0]!.status).toBe('succeeded');
        const fields = pageFields(scene);
        return { ...fields, content: `${scene.content} 示例：一半苹果。` };
      });
    }
    const input = {
      requestId: randomUUID(),
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: '为前两页补充示例',
      multiStep: true,
    };
    const result = await conversations.ask(plan.id, input);
    expect(result.conversation.pending).toBeUndefined();
    expect(result.conversation.messages[1]!.task).toMatchObject({
      phase: 'completed',
      steps: [{ status: 'succeeded' }, { status: 'succeeded' }],
    });
    expect(result.project!.content.scenes[0]!.content).toContain('一半苹果');
    expect(result.project!.revision).toBe(plan.revision + 2);
    expect(result.project!.undoDepth).toBe(plan.undoDepth + 1);
    const reopened = await setup(directory, provider);
    expect(reopened.conversations.get(plan.id)).toEqual(result.conversation);
    const calls = provider.complete.mock.calls.length;
    await conversations.ask(plan.id, input);
    expect(provider.complete).toHaveBeenCalledTimes(calls);
    expect((await service.undo(plan.id, result.revision, randomUUID())).content).toEqual(
      plan.content,
    );
  });

  it.each(['locked', 'foreign', 'duplicate'])(
    'rejects a %s plan before any edits',
    async (kind) => {
      const { service, conversations, project, provider } = await fixture();
      let plan = await planned(service, project);
      if (kind === 'locked') {
        plan.content.scenes[1]!.locked = true;
        plan = await service.save(plan.id, {
          expectedRevision: plan.revision,
          operationId: randomUUID(),
          content: plan.content,
        });
      }
      const steps = [
        { sceneId: plan.content.scenes[0]!.id, instruction: '补充示例' },
        {
          sceneId:
            kind === 'foreign'
              ? randomUUID()
              : plan.content.scenes[kind === 'duplicate' ? 0 : 1]!.id,
          instruction: '补充示例',
        },
      ];
      provider.complete.mockResolvedValueOnce({ steps });
      const calls = provider.complete.mock.calls.length;
      await expect(
        conversations.ask(plan.id, {
          expectedRevision: plan.revision,
          sceneId: plan.content.scenes[0]!.id,
          question: '补充示例',
          multiStep: true,
        }),
      ).rejects.toThrow('任务计划');
      expect(provider.complete).toHaveBeenCalledTimes(calls + 1);
      expect(service.get(plan.id).content).toEqual(plan.content);
    },
  );

  it.each(['failure', 'stop', 'conflict'])(
    'discards all staged edits after %s and retains retry input',
    async (kind) => {
      const { service, conversations, project, provider } = await fixture();
      const plan = await planned(service, project);
      const [first, second] = plan.content.scenes;
      provider.complete.mockResolvedValueOnce({
        steps: [first!, second!].map((scene) => ({ sceneId: scene.id, instruction: '补充示例' })),
      });
      const fields = pageFields(first!);
      provider.complete.mockResolvedValueOnce({ ...fields, content: '暂存的新内容' });
      provider.complete.mockImplementationOnce(async () => {
        if (kind === 'failure') throw new Error('upstream private details');
        if (kind === 'stop') await conversations.stop(plan.id);
        else {
          const content = structuredClone(plan.content);
          content.title = '另一个窗口的修改';
          await service.save(plan.id, {
            expectedRevision: plan.revision,
            operationId: randomUUID(),
            content,
          });
        }
        const secondFields = pageFields(second!);
        return { ...secondFields, content: '不能提交的新内容' };
      });
      const input = {
        requestId: randomUUID(),
        expectedRevision: plan.revision,
        sceneId: first!.id,
        question: '补充示例',
        multiStep: true,
      };
      await expect(conversations.ask(plan.id, input)).rejects.toThrow(
        kind === 'conflict' ? '其他窗口' : kind === 'stop' ? '回复已停止' : '询问失败',
      );
      expect(service.get(plan.id).content.scenes).toEqual(plan.content.scenes);
      expect(conversations.get(plan.id)).toMatchObject({
        messages: [],
        pending: {
          input,
          status: 'interrupted',
          task: {
            steps: [
              { status: 'succeeded' },
              { status: kind === 'conflict' ? 'succeeded' : 'running' },
            ],
          },
        },
      });
      // A changed base replans; an unchanged base reuses the completed page checkpoint.
      if (kind === 'conflict') {
        provider.complete.mockResolvedValueOnce({
          steps: [{ sceneId: first!.id, instruction: '补充示例' }],
        });
        provider.complete.mockResolvedValueOnce({ ...fields, content: '重试成功' });
      } else {
        provider.complete.mockResolvedValueOnce({ ...pageFields(second!), content: '重试成功' });
      }
      const calls = provider.complete.mock.calls.length;
      const result = await conversations.ask(plan.id, {
        ...input,
        expectedRevision: service.get(plan.id).revision,
      });
      expect(result.project!.content.scenes[kind === 'conflict' ? 0 : 1]!.content).toBe('重试成功');
      expect(provider.complete.mock.calls.length - calls).toBe(kind === 'conflict' ? 2 : 1);
      if (kind !== 'conflict')
        expect(result.project!.content.scenes[0]!.content).toBe('暂存的新内容');
      expect(result.conversation.pending).toBeUndefined();
    },
  );

  it('rejects read-only tasks without invoking a planner', async () => {
    const { service, conversations, project, provider } = await fixture();
    const plan = await planned(service, project);
    const calls = provider.complete.mock.calls.length;
    await expect(
      conversations.ask(plan.id, {
        expectedRevision: plan.revision,
        sceneId: plan.content.scenes[0]!.id,
        question: '补充示例',
        multiStep: true,
        allowEdits: false,
      }),
    ).rejects.toThrow('允许修改');
    expect(provider.complete).toHaveBeenCalledTimes(calls);
  });
});

describe('default generation tasks', () => {
  it('plans from the conversation and sends page-specific instructions by default', async () => {
    const { service, conversations, project, provider } = await fixture();
    const plan = await planned(service, project);
    provider.complete.mockResolvedValueOnce({ answer: '可以用分苹果解释分数。' });
    const reply = await conversations.ask(plan.id, {
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: '面向小学生，用分苹果作为例子',
      allowEdits: false,
    });
    const steps = plan.content.scenes.map((scene, index) => ({
      sceneId: scene.id,
      instruction: `第${index + 1}页：通过分苹果说明分数`,
    }));
    provider.complete.mockImplementationOnce(async (_selection, request) => {
      expect(request.name).toBe('forge_generation_plan');
      const input = JSON.parse(request.input);
      expect(input.messages.map((message: { content: string }) => message.content)).toEqual([
        '面向小学生，用分苹果作为例子',
        '可以用分苹果解释分数。',
      ]);
      expect(input.project.brief).toBe(plan.content.brief);
      return { question: '', options: [], steps };
    });
    await service.start(plan.id, {
      expectedRevision: reply.revision,
      requestId: randomUUID(),
      action: 'build',
      instruction: '',
    });
    const built = await settle(service, plan.id);
    expect(built.run).toMatchObject({
      status: 'succeeded',
      completed: 3,
      task: { phase: 'completed' },
    });
    expect(
      provider.generate.mock.calls.map((call) => JSON.parse(call[2]!.instructions).request),
    ).toEqual(steps.map((step) => step.instruction));
    expect((await service.undo(plan.id, built.revision, randomUUID())).content).toEqual(
      plan.content,
    );
  });

  it('persists an essential question and topic options, then accepts a manual answer', async () => {
    const { service, project, provider, directory } = await fixture();
    const plan = await planned(service, project);
    const clarification = {
      question: '分苹果的例子希望面向哪个年级？',
      options: [{ label: '三年级：认识几分之一', instruction: '面向三年级，重点说明几分之一。' }],
    };
    provider.complete.mockResolvedValueOnce({ ...clarification, steps: [] });
    await service.start(plan.id, {
      expectedRevision: plan.revision,
      requestId: randomUUID(),
      action: 'build',
      instruction: '',
    });
    const waiting = await settle(service, plan.id);
    expect(waiting.run).toMatchObject({ status: 'awaiting_input', clarification });
    expect(provider.generate).not.toHaveBeenCalled();
    const reopened = await setup(directory, provider);
    expect(reopened.service.get(plan.id).run?.clarification).toEqual(clarification);
    provider.complete.mockImplementationOnce(async (_selection, request) => {
      const input = JSON.parse(request.input);
      expect(input.request).toBe('面向五年级，比较异分母分数');
      expect(input.previousQuestion).toBe(clarification.question);
      return {
        question: '',
        options: [],
        steps: plan.content.scenes.map((scene) => ({
          sceneId: scene.id,
          instruction: '比较异分母分数',
        })),
      };
    });
    await service.start(plan.id, {
      expectedRevision: waiting.revision,
      requestId: randomUUID(),
      action: 'build',
      instruction: '面向五年级，比较异分母分数',
    });
    expect((await settle(service, plan.id)).run?.status).toBe('succeeded');
  });

  it.each(['duplicate', 'locked', 'missing'])(
    'rejects a %s generation plan before generating any page',
    async (kind) => {
      const { service, project, provider } = await fixture();
      let plan = await planned(service, project);
      if (kind === 'locked') {
        plan.content.scenes[1]!.locked = true;
        plan = await service.save(plan.id, {
          expectedRevision: plan.revision,
          operationId: randomUUID(),
          content: plan.content,
        });
      }
      const steps = plan.content.scenes.map((scene) => ({
        sceneId: scene.id,
        instruction: '生成本页',
      }));
      if (kind === 'duplicate') steps[1]!.sceneId = steps[0]!.sceneId;
      if (kind === 'missing') steps.pop();
      provider.complete.mockResolvedValueOnce({ question: '', options: [], steps });
      await service.start(plan.id, {
        expectedRevision: plan.revision,
        requestId: randomUUID(),
        action: 'build',
        instruction: '',
      });
      expect((await settle(service, plan.id)).run?.status).toBe('failed');
      expect(provider.generate).not.toHaveBeenCalled();
      expect(service.get(plan.id).content).toEqual(plan.content);
    },
  );

  it('stops a planner that ignores abort without waiting for its response', async () => {
    const { service, project, provider } = await fixture();
    const plan = await planned(service, project);
    provider.complete.mockImplementationOnce(() => new Promise(() => {}));
    await service.start(plan.id, {
      expectedRevision: plan.revision,
      requestId: randomUUID(),
      action: 'build',
      instruction: '',
    });
    await vi.waitFor(() => expect(provider.complete).toHaveBeenCalledTimes(2));
    await service.cancel(plan.id);
    await service.onModuleDestroy();
    expect(service.get(plan.id).run?.status).toBe('cancelled');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('retains completed pages when stopped and ignores a late in-flight page', async () => {
    const { service, project, provider } = await fixture();
    const plan = await planned(service, project);
    let finish!: (value: { mime: 'text/html'; content: string; filename: string }) => void;
    provider.generate.mockResolvedValueOnce({
      mime: 'text/html',
      content: '<html><body>Saved first page</body></html>',
      filename: 'first.html',
    });
    provider.generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await service.start(plan.id, {
      expectedRevision: plan.revision,
      requestId: randomUUID(),
      action: 'build',
      instruction: '',
    });
    await vi.waitFor(() => expect(provider.generate).toHaveBeenCalledTimes(2));
    await service.cancel(plan.id);
    await vi.waitFor(() => expect(service.get(plan.id).run?.status).toBe('cancelled'));
    finish({
      mime: 'text/html',
      content: '<html><body>Late page</body></html>',
      filename: 'late.html',
    });
    const stopped = service.get(plan.id);
    expect(stopped.content.scenes[0]!.html).toContain('Saved first page');
    expect(stopped.content.scenes.slice(1).every((scene) => !scene.html)).toBe(true);
    await service.start(plan.id, {
      expectedRevision: stopped.revision,
      requestId: randomUUID(),
      action: 'build',
      instruction: '',
    });
    expect((await settle(service, plan.id)).run?.status).toBe('succeeded');
    expect(provider.generate).toHaveBeenCalledTimes(4);
    expect(service.get(plan.id).content.scenes[0]!.html).toContain('Saved first page');
  });

  it('releases a stopped conversation even when its model never responds', async () => {
    const { service, conversations, project, provider } = await fixture();
    const plan = await planned(service, project);
    provider.complete.mockImplementationOnce(() => new Promise(() => {}));
    const reply = conversations.ask(plan.id, {
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: '解释这一页',
      allowEdits: false,
    });
    const rejected = expect(reply).rejects.toThrow('回复已停止');
    await vi.waitFor(() => expect(provider.complete).toHaveBeenCalledTimes(2));
    await conversations.stop(plan.id);
    await rejected;
    provider.complete.mockResolvedValueOnce({ answer: '可以继续交流。' });
    const resumed = await conversations.ask(plan.id, {
      expectedRevision: plan.revision,
      sceneId: plan.content.scenes[0]!.id,
      question: '现在继续',
      allowEdits: false,
    });
    expect(resumed.answer).toBe('可以继续交流。');
  });
});

describe('durable writer checkpoints and isolated drafts', () => {
  const pageFields = (scene: HtmlProject['content']['scenes'][number]) => ({
    title: scene.title,
    objective: scene.objective,
    content: scene.content,
    layout: scene.layout,
    html: scene.html,
  });
  it('resumes a multi-step draft across restart without planning or rewriting the completed page', async () => {
    const { service, conversations, project, provider, directory, repository } = await fixture();
    const plan = await planned(service, project);
    const [first, second] = plan.content.scenes;
    provider.complete.mockResolvedValueOnce({
      steps: [first!, second!].map((scene) => ({ sceneId: scene.id, instruction: '补充示例' })),
    });
    provider.complete.mockResolvedValueOnce({ ...pageFields(first!), content: '已完成的第一步' });
    provider.complete.mockRejectedValueOnce(new Error('interrupted'));
    const input = {
      requestId: randomUUID(),
      expectedRevision: plan.revision,
      sceneId: first!.id,
      question: '补充示例',
      multiStep: true,
    };
    await expect(conversations.ask(plan.id, input)).rejects.toThrow();
    expect(repository.get(plan.id).checkpoint?.task.steps[0]?.status).toBe('succeeded');
    expect(service.get(plan.id).content).toEqual(plan.content);
    const reopened = await setup(directory, provider);
    provider.complete.mockResolvedValueOnce({ ...pageFields(second!), content: '恢复后的第二步' });
    const calls = provider.complete.mock.calls.length;
    const result = await reopened.conversations.ask(plan.id, input);
    expect(provider.complete.mock.calls.length - calls).toBe(1);
    expect(result.project!.content.scenes.slice(0, 2).map((scene) => scene.content)).toEqual([
      '已完成的第一步',
      '恢复后的第二步',
    ]);
    expect(reopened.repository.get(plan.id).checkpoint).toBeUndefined();
    expect((await reopened.service.undo(plan.id, result.revision, randomUUID())).content).toEqual(
      plan.content,
    );
  });
  it('merges an isolated writer draft with a concurrent edit to a different page', async () => {
    const { service, conversations, project, provider } = await fixture();
    const plan = await planned(service, project);
    const [first, second] = plan.content.scenes;
    let release!: (value: unknown) => void;
    provider.complete.mockImplementationOnce(async (_selection, request) => {
      await request.tools!.execute(
        'revise_scene',
        JSON.stringify({
          sceneId: first!.id,
          expectedRevision: plan.revision,
          instruction: '修改第一页',
        }),
      );
      return { answer: '已修改' };
    });
    provider.complete.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const work = conversations.ask(plan.id, {
      expectedRevision: plan.revision,
      sceneId: first!.id,
      question: '修改第一页',
    });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const manual = structuredClone(plan.content);
    manual.scenes[1]!.content = '另一位作者的修改';
    await service.save(plan.id, {
      expectedRevision: plan.revision,
      operationId: randomUUID(),
      content: manual,
    });
    release({ ...pageFields(first!), content: 'Agent 的修改' });
    const result = await work;
    expect(result.project!.content.scenes[0]!.content).toBe('Agent 的修改');
    expect(result.project!.content.scenes.find((scene) => scene.id === second!.id)!.content).toBe(
      '另一位作者的修改',
    );
    expect(result.revision).toBeGreaterThan(plan.revision + 1);
  });
});
