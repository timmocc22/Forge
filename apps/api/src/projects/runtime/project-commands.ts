import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { ProjectCommand } from '@studio/contracts';
import type { ProjectStore } from '../ports/project-store.js';
import type { HtmlProjectService } from '../authoring/project.service.js';
import type { ConversationService } from '../conversation/conversation.service.js';
import type { ProjectTasks } from './project-tasks.js';

/** Durable intent queue. Browser lifetime does not own execution or ordering. */
export class ProjectCommands {
  private readonly workers = new Map<string, Promise<void>>();
  private readonly closing = new AbortController();
  constructor(
    private readonly store: ProjectStore,
    private readonly projects: HtmlProjectService,
    private readonly conversations: ConversationService,
    private readonly tasks: ProjectTasks,
  ) {}
  async onModuleInit() {
    await this.store.initialize();
    await this.store.transaction(async (tx) => {
      for (const record of tx.all()) {
        if (!record.commands?.length) continue;
        for (const command of record.commands) {
          command.status = 'failed';
          command.error = '服务已重启，请确认后继续此任务';
        }
        await tx.save(record, false);
      }
    });
  }
  async onModuleDestroy() {
    this.closing.abort();
    await Promise.allSettled(this.workers.values());
  }
  list(id: string) { return this.store.get(id).commands ?? []; }
  async enqueue(id: string, command: ProjectCommand) {
    if (command.projectId !== id) throw new ConflictException('任务必须属于当前项目');
    await this.store.transaction(async (tx) => {
      const record = tx.get(id);
      const existing = record.commands?.find((item) => item.id === command.id);
      if (existing) {
        if (existing.question !== command.question || existing.sceneId !== command.sceneId || existing.mode !== command.mode || JSON.stringify(existing.task) !== JSON.stringify(command.task))
          throw new ConflictException('任务标识已被其他要求使用');
        return;
      }
      if (record.operations.includes(command.id) || record.conversation?.messages.some((message) => message.id === command.id)) return;
      if ((record.commands?.length ?? 0) >= 20) throw new ConflictException('待处理任务已达 20 条，请先处理或移除');
      record.commands = [...(record.commands ?? []), { ...command, status: 'queued', error: '' }];
      await tx.save(record, false);
    });
    this.kick(id);
    return this.list(id);
  }
  async change(id: string, commandId: string, action: 'remove' | 'retry' | 'interrupt') {
    await this.store.transaction(async (tx) => {
      const record = tx.get(id);
      const command = record.commands?.find((item) => item.id === commandId);
      if (!command) throw new NotFoundException('任务不存在');
      if (command.status === 'running') throw new ConflictException('请先停止正在执行的任务');
      if (action === 'remove') record.commands = record.commands!.filter((item) => item.id !== commandId);
      else {
        command.status = 'queued'; command.error = ''; command.attempt++;
        if (action === 'interrupt') {
          command.timing = 'interrupt'; command.interrupted = true;
          // The replaced command can no longer submit an outcome into the queue.
          record.commands = [command, ...record.commands!.filter((item) => item.id !== commandId && item.status !== 'running')];
        }
      }
      await tx.save(record, false);
    });
    if (action === 'interrupt') {
      const project = this.store.get(id).project;
      if (project.run?.status === 'running' || project.run?.status === 'awaiting_input') await this.projects.cancel(id);
      await this.conversations.stop(id);
    }
    if (action !== 'remove') this.kick(id);
    return this.list(id);
  }
  async clear(id: string) {
    await this.store.transaction(async (tx) => {
      const record = tx.get(id); record.commands = []; await tx.save(record, false);
    });
    await this.projects.cancel(id);
    await this.conversations.stop(id);
    return this.list(id);
  }
  private kick(id: string) {
    if (this.closing.signal.aborted || this.workers.has(id)) return;
    const worker = this.drain(id).catch(() => { /* Per-command errors are durable; shutdown is expected. */ }).finally(() => this.workers.delete(id));
    this.workers.set(id, worker);
  }
  private async drain(id: string) {
    while (!this.closing.signal.aborted) {
      const record = this.store.get(id);
      const command = record.commands?.[0];
      if (!command || command.status === 'failed') return;
      if (!this.tasks.hasCapacity() || record.project.run?.status === 'running' || record.conversation?.pending?.status === 'running') {
        await delay(100, undefined, { signal: this.closing.signal }); continue;
      }
      await this.store.transaction(async (tx) => {
        const current = tx.get(id);
        const target = current.commands?.find((item) => item.id === command.id);
        if (!target || target.status !== 'queued') return;
        target.status = 'running'; await tx.save(current, false);
      });
      if (!this.list(id).some((item) => item.id === command.id && item.status === 'running')) continue;
      try {
        await this.execute(id, command);
        await this.store.transaction(async (tx) => {
          const current = tx.get(id);
          current.commands = current.commands?.filter((item) => item.id !== command.id);
          current.operations = [...current.operations, command.id].slice(-100);
          await tx.save(current, false);
        });
      } catch (error) {
        await this.store.transaction(async (tx) => {
          const current = tx.get(id);
          const target = current.commands?.find((item) => item.id === command.id);
          if (!target) return;
          target.status = 'failed'; target.error = error instanceof HttpException ? error.message : '任务执行失败，可重试';
          await tx.save(current, false);
        });
      }
    }
  }
  private async execute(id: string, command: ProjectCommand) {
    let project = this.store.get(id).project;
    const needsPlan = !project.content.scenes.length;
    if ((command.kind === 'plan' || needsPlan) && project.run?.status !== 'awaiting_input') {
      const brief = command.brief ?? (command.append ? `${project.content.brief}\n\n补充要求：${command.question}` : command.question);
      if (brief.length > 8000) throw new ConflictException('累计创作要求超过 8000 字，请精简后发送');
      project = await this.projects.save(id, { expectedRevision: project.revision, operationId: this.key(command.id, 'prepare'), content: { ...project.content, brief } });
    }
    const runAction = needsPlan ? 'plan' : project.run?.status === 'awaiting_input' ? project.run.action : command.interrupted && (command.task?.action === 'build' || command.task?.action === 'scene') ? command.task.action : undefined;
    if (runAction) {
      const instruction = command.task ? `${command.task.goal}\n\n补充要求：${command.question}` : command.question;
      // A command's id and the run's idempotency key are different from its preparatory save.
      const runKey = this.key(command.id, `run:${command.attempt}`);
      await this.projects.start(id, { expectedRevision: project.revision, requestId: runKey, action: runAction, sceneId: runAction === 'scene' ? command.task?.sceneId ?? command.sceneId : undefined, instruction, modelSelection: command.modelSelection });
      while (this.store.get(id).project.run?.status === 'running') await delay(100, undefined, { signal: this.closing.signal });
      const run = this.store.get(id).project.run;
      if (run?.status === 'failed') throw new ConflictException(run.message);
      return;
    }
    const target = command.task?.sceneId ?? command.sceneId;
    const sceneId = project.content.scenes.find((scene) => scene.id === target)?.id ?? project.content.scenes[0]?.id;
    if (!sceneId) throw new ConflictException('暂无可处理的页面，请先规划分镜');
    await this.conversations.ask(id, {
      expectedRevision: project.revision, requestId: command.id, sceneId, question: command.question,
      modelSelection: command.modelSelection,
      allowEdits: command.task?.allowEdits ?? command.mode !== 'ask', multiStep: command.task?.multiStep ?? false,
      continuation: command.task ? { action: command.task.action, goal: command.task.goal, timing: command.timing } : undefined,
    });
  }
  private key(id: string, purpose: string) {
    const hex = createHash('sha256').update(`${id}:${purpose}`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
}
