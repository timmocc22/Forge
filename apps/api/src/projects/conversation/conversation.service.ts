import {
  ContextService,
  recentTurns,
  type ContextDocument,
} from '../../context/context.service.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { htmlSceneAnswerSchema, type AskHtmlScene, type Conversation } from '@studio/contracts';
import type { GenerationGateway } from '../../generation/ports.js';
import { ProviderError } from '../../generation/ports.js';
import type { ProjectStore } from '../ports/project-store.js';
import { ProjectTasks } from '../runtime/project-tasks.js';
import { mergeProjectDraft } from '../shared/project-draft.js';
import { checkProjectRevision } from '../shared/project-policy.js';
import { resolveProjectModel } from '../shared/project-model.js';
import { SceneTools } from './scene-tools.js';
import { buildConversationContext } from './conversation-context.js';
import { runMultiStepTask } from './multi-step-task.js';
import { abortable } from '../runtime/abortable.js';

export class ConversationService {
  private readonly workers = new Set<Promise<unknown>>();
  private readonly replies = new Map<string, Promise<unknown>>();
  constructor(
    private readonly repository: ProjectStore,
    private readonly provider: Pick<GenerationGateway, 'resolveInput' | 'complete'>,
    private readonly tasks: ProjectTasks,
    private readonly context = new ContextService(),
  ) {}
  async onModuleDestroy() {
    this.tasks.close();
    await Promise.allSettled(this.workers);
    await this.repository.idle();
  }
  get(id: string): Conversation {
    const record = this.repository.read(id);
    return structuredClone(record.conversation ?? { id, projectId: id, messages: [] });
  }
  private readonly asking = new Set<string>();
  private readonly active = new Map<string, AbortController>();
  async stop(id: string) {
    this.repository.get(id);
    const controller = this.active.get(id);
    controller?.abort(new Error('回复已停止，可继续回复'));
    await this.repository.transaction(async (transaction) => {
      const record = transaction.get(id);
      if (record.conversation?.pending?.status === 'running') {
        record.conversation.pending.status = 'interrupted';
        record.conversation.pending.error = '回复已停止，可继续回复';
        await transaction.save(record, false);
      }
    });
    return this.get(id);
  }
  ask(id: string, input: AskHtmlScene) {
    const worker = this.execute(id, input);
    this.workers.add(worker);
    // A rejected concurrent request must not replace the active worker.
    if (!this.replies.has(id)) this.replies.set(id, worker);
    void worker
      .finally(() => {
        this.workers.delete(worker);
        if (this.replies.get(id) === worker) this.replies.delete(id);
      })
      .catch(() => {});
    return worker;
  }
  private async execute(id: string, input: AskHtmlScene) {
    const initial = this.repository.get(id);
    const project = initial.project;
    const existing = this.get(id);
    const completedIndex = input.requestId
      ? existing.messages.findIndex(
          (message) => message.role === 'user' && message.id === input.requestId,
        )
      : -1;
    if (completedIndex >= 0) {
      const question = existing.messages[completedIndex]!;
      if (
        question.content !== input.question ||
        question.sceneId !== input.sceneId ||
        JSON.stringify(question.continuation) !== JSON.stringify(input.continuation) ||
        !!existing.messages[completedIndex + 1]?.task !== !!input.multiStep
      )
        throw new ConflictException('请求标识已被其他问题使用');
      return {
        answer: existing.messages[completedIndex + 1]!.content,
        conversation: existing,
        sceneId: question.sceneId,
        revision: project.revision,
        project,
        modelSelection: project.modelSelection,
      };
    }
    checkProjectRevision(project, input.expectedRevision);
    const scene = project.content.scenes.find((item) => item.id === input.sceneId);
    if (!scene) throw new NotFoundException('当前页面不存在，请重新选择');
    const modelSelection = resolveProjectModel(
      this.provider,
      input.modelSelection ?? project.modelSelection,
    );
    if (input.multiStep && (input.allowEdits === false || modelSelection.provider === 'demo'))
      throw new BadRequestException('多步任务需要选择已配置的 AI 模型并允许修改页面');
    this.tasks.assertAvailable('当前模型任务较多，请稍后重试');
    if (this.asking.has(id)) throw new ConflictException('本对话正在回复，请稍后再发送');
    const conversation = this.get(id);
    if (conversation.messages.length >= 1000)
      throw new BadRequestException('本对话记录已满，请新建项目继续交流');
    this.asking.add(id);
    const requestId = input.requestId ?? randomUUID();
    const taskId = randomUUID();
    const controller = this.tasks.register(taskId);
    this.active.set(id, controller);
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(input.multiStep ? 600000 : 120000),
    ]);
    let evidence: ContextDocument[] | undefined;
    const provider = {
      complete: (
        selection: Parameters<GenerationGateway['complete']>[0],
        request: Parameters<GenerationGateway['complete']>[1],
        _signal: AbortSignal,
      ) =>
        abortable(signal, async () => {
          evidence ??= await this.context.retrieve(
            { projectId: id, query: input.question, sceneId: scene.id, taskId: requestId },
            signal,
          );
          return this.provider.complete(selection, this.context.enrich(request, evidence), signal);
        }),
    };
    const tools = new SceneTools(
      project,
      input.allowEdits ?? true,
      provider,
      modelSelection,
      signal,
    );
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          question: input.question,
          sceneId: input.sceneId,
          allowEdits: input.allowEdits ?? true,
          multiStep: input.multiStep ?? false,
          continuation: input.continuation,
          modelSelection,
        }),
      )
      .digest('hex');
    const checkpoint =
      input.multiStep &&
      initial.checkpoint?.requestId === requestId &&
      initial.checkpoint.fingerprint === fingerprint &&
      initial.checkpoint.baseRevision === project.revision
        ? initial.checkpoint
        : undefined;
    if (checkpoint) {
      evidence = checkpoint.evidence;
      tools.project.content = structuredClone(checkpoint.content);
      tools.project.revision = checkpoint.draftRevision;
      tools.changed = checkpoint.draftRevision !== checkpoint.baseRevision;
    }
    try {
      conversation.pending = {
        requestId,
        input: { ...input, requestId },
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      await this.repository.transaction(async (transaction) => {
        const record = transaction.get(id);
        checkProjectRevision(record.project, input.expectedRevision);
        record.conversation = conversation;
        if (!checkpoint) delete record.checkpoint;
        await transaction.save(record, false);
      });
      signal.throwIfAborted();
      const taskResult = input.multiStep
        ? await runMultiStepTask(
            input.continuation
              ? `原任务：${input.continuation.goal}\n补充要求：${input.question}\n${input.continuation.timing === 'interrupt' ? '继续完成原任务并落实补充要求。' : '基于原任务已完成的结果落实补充要求。'}`
              : input.question,
            input.sceneId,
            tools,
            provider,
            modelSelection,
            signal,
            async (task) => {
              signal.throwIfAborted();
              conversation.pending!.task = structuredClone(task);
              await this.repository.transaction(async (transaction) => {
                signal.throwIfAborted();
                const record = transaction.get(id);
                if (
                  record.conversation?.pending?.requestId !== requestId ||
                  record.conversation.pending.status !== 'running'
                )
                  throw new ConflictException('任务已停止');
                record.checkpoint = {
                  requestId,
                  fingerprint,
                  evidence,
                  baseRevision: project.revision,
                  draftRevision: tools.project.revision,
                  content: structuredClone(tools.project.content),
                  task: structuredClone(task),
                };
                record.conversation.pending.task = structuredClone(task);
                await transaction.save(record, false);
              });
            },
            checkpoint?.task,
            recentTurns(conversation.messages),
          )
        : undefined;
      const result = htmlSceneAnswerSchema.parse(
        taskResult
          ? { answer: taskResult.answer }
          : modelSelection.provider === 'demo'
            ? {
                answer: `本地演示（规则样例，未调用 AI）\n当前页：${scene.title}\n页面目标：${scene.objective || '尚未填写'}\n内容：${scene.content || '尚未填写'}\n建议：检查本页是否围绕一个重点展开，并补充具体示例。切换到已配置的文字模型，可针对问题获得 AI 分析，也能按要求修改指定页面。本地演示不执行自动修改。`,
              }
            : await provider.complete(
                modelSelection,
                {
                  ...buildConversationContext(
                    project,
                    scene,
                    conversation,
                    input.question,
                    input.allowEdits ?? true,
                    input.continuation,
                  ),
                  tools: tools.tools,
                },
                signal,
              ),
      );
      signal.throwIfAborted();
      const saved = await this.repository.transaction(async (transaction) => {
        signal.throwIfAborted();
        const record = transaction.get(id);
        if (tools.changed) {
          const merged = mergeProjectDraft(record.project, project, tools.project);
          record.history = [...record.history, structuredClone(record.project.content)].slice(-20);
          record.project.content = merged.content;
          record.project.revision = merged.revision;
          record.project.modelSelection = modelSelection;
        }
        delete record.checkpoint;
        delete conversation.pending;
        conversation.messages.push(
          {
            id: requestId,
            role: 'user',
            content: input.question,
            ...(input.continuation ? { continuation: input.continuation } : {}),
            sceneId: scene.id,
            createdAt: new Date().toISOString(),
          },
          {
            id: randomUUID(),
            role: 'assistant',
            content: result.answer,
            ...(taskResult ? { task: taskResult.task } : {}),
            sceneId: scene.id,
            createdAt: new Date().toISOString(),
          },
        );
        record.conversation = conversation;
        const savedProject = await transaction.save(record, tools.changed);
        return { conversation: structuredClone(conversation), project: savedProject };
      });
      return {
        ...result,
        conversation: saved.conversation,
        sceneId: scene.id,
        revision: saved.project.revision,
        ...(tools.changed ? { project: saved.project } : {}),
        modelSelection,
      };
    } catch (error) {
      const message = signal.aborted
        ? controller.signal.aborted
          ? '回复已停止，可继续回复'
          : '询问超时，可继续回复'
        : error instanceof HttpException
          ? error.message
          : error instanceof ProviderError
            ? error.message
            : '询问失败，请重试';
      await this.repository
        .transaction(async (transaction) => {
          const record = transaction.get(id);
          if (record.conversation?.pending?.requestId !== requestId) return;
          record.conversation.pending.status = 'interrupted';
          record.conversation.pending.error = message;
          await transaction.save(record, false);
        })
        .catch(() => {});
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(message);
    } finally {
      this.tasks.release(taskId);
      this.active.delete(id);
      this.asking.delete(id);
    }
  }
}
