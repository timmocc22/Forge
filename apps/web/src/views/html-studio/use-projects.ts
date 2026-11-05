import { computed, onMounted, onUnmounted, ref, toRaw, watch } from 'vue';
import { z } from 'zod';
import {
  htmlProjectContentSchema,
  type CreateHtmlProject, type ProjectCommand, type EnqueueProjectCommand,
  type AskHtmlScene,
  type Conversation,
  type HtmlProject,
  type HtmlProjectContent,
  type RunHtmlProject,
  type TaskContinuation,
} from '@studio/contracts';
import { htmlProjectsApi, type ProjectSummary } from '../../services/html-projects';
import { useModelsStore } from '../../stores/models';
import { IndexedDbDraftStore } from '../../platform/indexeddb-drafts';
import { browserSessionIdentity, browserIds } from '../../platform/browser';

export function useHtmlProjects() {
  const models = useModelsStore();
  const projects = ref<ProjectSummary[]>([]);
  const commands = ref<ProjectCommand[]>([]);
  const project = ref<HtmlProject>();
  const conversation = ref<Conversation>();
  const content = ref<HtmlProjectContent>();
  const error = ref('');
  const notice = ref('');
  const loading = ref(false);
  const busy = ref(false);
  const connected = ref(false);
  const running = computed(() => project.value?.run?.status === 'running');
  const dirty = computed(
    () =>
      !!content.value && JSON.stringify(content.value) !== JSON.stringify(project.value?.content),
  );
  const draftSchema = z.object({ baseRevision: z.number(), content: htmlProjectContentSchema });
  const drafts = new IndexedDbDraftStore(
    {
      database: 'forge-project-drafts',
      version: 1,
      store: 'drafts',
      namespace: 'html-project',
      sessionId: browserSessionIdentity(() => sessionStorage, browserIds),
    },
    () => indexedDB,
    (value) => draftSchema.parse(value),
  );
  let draftWrites: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let activeReply: { id: string; controller: AbortController } | undefined;
  function accept(value: HtmlProject) {
    project.value = value;
    content.value = structuredClone(value.content);
  }
  const handle = (cause: unknown) => {
    error.value = cause instanceof Error ? cause.message : '操作失败，请重试';
  };
  async function refreshList() {
    projects.value = await htmlProjectsApi.list();
    connected.value = true;
  }
  async function save() {
    if (!project.value || !content.value || !dirty.value) return;
    const id = project.value.id;
    const snapshot = structuredClone(toRaw(content.value));
    const saved = await htmlProjectsApi.save(
      id,
      project.value.revision,
      crypto.randomUUID(),
      snapshot,
    );
    project.value = saved;
    // Keep any edits typed while the save was in flight.
    if (JSON.stringify(content.value) === JSON.stringify(snapshot))
      content.value = structuredClone(saved.content);
    await draftWrites;
    if (!dirty.value) await drafts.remove(id).catch(() => {});
    notice.value = '已保存到项目';
    await refreshList();
  }
  async function action(operation: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
      await operation();
    } catch (cause) {
      handle(cause);
    } finally {
      busy.value = false;
    }
  }
  async function open(id: string) {
    await action(async () => {
      await save();
      const [value, transcript, queue] = await Promise.all([
        htmlProjectsApi.get(id),
        htmlProjectsApi.conversation(id),
        htmlProjectsApi.commands(id),
      ]);
      accept(value);
      conversation.value = transcript;
      commands.value = queue;
      const draft = await drafts.read(id).catch(() => undefined);
      if (
        draft &&
        !running.value &&
        JSON.stringify(draft.content) !== JSON.stringify(value.content)
      ) {
        content.value = draft.content;
        if (draft.baseRevision !== value.revision) {
          project.value = { ...value, revision: draft.baseRevision };
          notice.value =
            '已恢复本窗口草稿，服务端版本已变化。请先下载项目备份，再重新载入对照修改。';
        } else notice.value = '已恢复未保存的本地草稿';
      }
      history.replaceState(
        null,
        '',
        `${location.hash.startsWith('#works') ? '#works' : '#project'}/${id}`,
      );
    });
  }
  async function home() {
    await action(async () => {
      await save();
      project.value = undefined;
      conversation.value = undefined;
      commands.value = [];
      content.value = undefined;
      history.replaceState(null, '', location.pathname);
      await refreshList();
    });
  }
  async function create(input: CreateHtmlProject) {
    await action(async () => {
      await save();
      accept(await htmlProjectsApi.create(input));
      conversation.value = undefined;
      commands.value = [];
      history.replaceState(null, '', `#project/${project.value!.id}`);
      if (!input.sourceHtml)
        accept(
          await htmlProjectsApi.run(project.value!.id, {
            action: 'plan',
            expectedRevision: project.value!.revision,
            requestId: crypto.randomUUID(),
            instruction: '',
            modelSelection: models.selectionFor('html'),
          }),
        );
      await refreshList();
    });
  }
  async function manage(id: string, operation: 'archive' | 'restore' | 'duplicate' | 'delete') {
    if (operation === 'delete' && !window.confirm('确定删除此会话及关联作品？删除后无法恢复。'))
      return;
    await action(async () => {
      if (operation !== 'delete' || project.value?.id !== id) await save();
      if (operation === 'duplicate' && dirty.value)
        throw new Error('保存期间内容发生变化，请保存后再复制会话');
      const target = await htmlProjectsApi.get(id);
      if (operation === 'duplicate') {
        const copy = await htmlProjectsApi.duplicate(id, target.revision);
        accept(copy);
        conversation.value = await htmlProjectsApi.conversation(copy.id);
        history.replaceState(null, '', `#project/${copy.id}`);
        notice.value = '已复制会话';
      } else if (operation === 'delete') {
        await htmlProjectsApi.remove(id, target.revision);
        if (project.value?.id === id) {
          project.value = undefined;
          content.value = undefined;
          conversation.value = undefined;
      commands.value = [];
          history.replaceState(null, '', location.pathname);
        }
        await draftWrites;
        await drafts.remove(id).catch(() => {});
        notice.value = '已删除会话及关联作品';
      } else {
        const saved = await htmlProjectsApi.archive(id, operation === 'archive', target.revision);
        if (project.value?.id === id) project.value = saved;
        notice.value = operation === 'archive' ? '会话已归档' : '会话已恢复';
      }
      await refreshList();
    });
  }
  async function run(actionType: RunHtmlProject['action'], sceneId?: string, instruction = '') {
    await action(async () => {
      await save();
      if (dirty.value) throw new Error('保存期间内容发生变化，请保存后再开始生成');
      if (!project.value) return;
      accept(
        await htmlProjectsApi.run(project.value.id, {
          action: actionType,
          sceneId,
          instruction,
          requestId: crypto.randomUUID(),
          expectedRevision: project.value.revision,
          modelSelection: models.selectionFor('html'),
        }),
      );
    });
  }
  async function ask(
    sceneId: string,
    question: string,
    allowEdits = true,
    retry?: AskHtmlScene,
    multiStep = false,
    continuation?: TaskContinuation,
    requestId?: string,
  ) {
    let answer: Awaited<ReturnType<typeof htmlProjectsApi.ask>> | undefined;
    await action(async () => {
      await save();
      if (dirty.value) throw new Error('保存期间内容发生变化，请保存后再询问');
      if (!project.value) return;
      const id = project.value.id;
      const input: AskHtmlScene = {
        sceneId,
        question,
        allowEdits,
        ...(multiStep ? { multiStep: true } : {}),
        ...(continuation ? { continuation } : {}),
        modelSelection: models.selectionFor('html'),
        ...retry,
        expectedRevision: project.value.revision,
        requestId: retry?.requestId ?? requestId ?? crypto.randomUUID(),
      };
      conversation.value ??= { id, projectId: id, messages: [] };
      conversation.value.pending = {
        requestId: input.requestId!,
        input,
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      const controller = new AbortController();
      activeReply = { id, controller };
      try {
        answer = await htmlProjectsApi.ask(id, input, controller.signal);
      } catch (cause) {
        // A lost HTTP response does not mean the server stopped. Reconcile before retrying.
        try {
          conversation.value = await htmlProjectsApi.conversation(id);
        } catch {
          if (conversation.value?.pending) {
            conversation.value.pending.status = 'interrupted';
            conversation.value.pending.error = '连接中断，可继续回复';
          }
        }
        const index =
          conversation.value?.messages.findIndex((message) => message.id === input.requestId) ?? -1;
        if (index < 0) {
          if (controller.signal.aborted || conversation.value?.pending?.error?.includes('已停止'))
            return;
          throw cause;
        }
        const saved = await htmlProjectsApi.get(id);
        answer = {
          answer: conversation.value!.messages[index + 1]!.content,
          conversation: conversation.value!,
          project: saved,
          sceneId,
          revision: saved.revision,
          modelSelection: saved.modelSelection,
        };
        error.value = '';
      } finally {
        if (activeReply?.controller === controller) activeReply = undefined;
      }
      conversation.value = answer.conversation;
      if (answer.project) {
        accept(answer.project);
        notice.value = '助手已更新页面，可撤销本次修改';
        await refreshList();
      }
    });
    return answer;
  }
  async function resumeConversation() {
    const pending = conversation.value?.pending;
    if (!pending || pending.status === 'running') return;
    return ask(
      pending.input.sceneId,
      pending.input.question,
      pending.input.allowEdits ?? true,
      pending.input,
      pending.input.multiStep,
      pending.input.continuation,
    );
  }
  async function stopConversation() {
    const id = project.value?.id;
    if (!id) return;
    try {
      conversation.value = await htmlProjectsApi.stopConversation(id);
      if (activeReply?.id === id) activeReply.controller.abort();
      notice.value = '已停止当前任务';
      return true;
    } catch (cause) {
      handle(cause);
      return false;
    }
  }
  async function cancel() {
    try {
      if (project.value) accept(await htmlProjectsApi.cancel(project.value.id));
      return true;
    } catch (cause) {
      handle(cause);
      return false;
    }
  }
  async function undo() {
    await action(async () => {
      await save();
      if (project.value)
        accept(
          await htmlProjectsApi.undo(project.value.id, project.value.revision, crypto.randomUUID()),
        );
      await refreshList();
    });
  }
  async function reload() {
    await action(async () => {
      if (project.value) {
        if (dirty.value) {
          if (!window.confirm('重新载入会放弃当前未保存的草稿。请先下载项目备份。确定重新载入？'))
            return;
          await draftWrites;
          await drafts.remove(project.value.id);
        }
        const id = project.value.id;
        const [value, transcript, queue] = await Promise.all([
          htmlProjectsApi.get(id),
          htmlProjectsApi.conversation(id),
        htmlProjectsApi.commands(id),
        ]);
        accept(value);
        conversation.value = transcript;
      commands.value = queue;
      }
      await refreshList();
      await models.refresh();
    });
  }
  async function enqueue(command: EnqueueProjectCommand) {
    await save();
    if (dirty.value) throw new Error('保存期间内容发生变化，请保存后再发送');
    const queue = await htmlProjectsApi.enqueue(command.projectId, { ...command, modelSelection: models.selectionFor('html') });
    if (project.value?.id === command.projectId) commands.value = queue;
  }
  async function changeCommand(commandId: string, operation: 'remove' | 'retry' | 'interrupt') {
    if (!project.value) return;
    const id = project.value.id;
    const queue = await htmlProjectsApi.changeCommand(id, commandId, operation);
    if (project.value?.id === id) commands.value = queue;
  }
  async function clearCommands() {
    if (!project.value) return;
    const id = project.value.id;
    const queue = await htmlProjectsApi.clearCommands(id);
    if (project.value?.id === id) commands.value = queue;
  }
  async function poll() {
    try {
      if (project.value) {
        const id = project.value.id;
        const previousQueue = commands.value.length > 0;
        const queue = await htmlProjectsApi.commands(id);
        if (project.value?.id === id) {
          commands.value = queue;
          if ((previousQueue || queue.length) && !dirty.value && !busy.value) {
            const [value, transcript] = await Promise.all([htmlProjectsApi.get(id), htmlProjectsApi.conversation(id)]);
            if (project.value?.id === id && !dirty.value && !busy.value) {
              accept(value); conversation.value = transcript;
            }
            await refreshList();
          }
        }
      }
      if (conversation.value?.pending && project.value) {
        const id = project.value.id;
        const transcript = await htmlProjectsApi.conversation(id);
        if (project.value?.id === id) {
          conversation.value = transcript;
          if (!transcript.pending && !dirty.value) {
            const value = await htmlProjectsApi.get(id);
            if (project.value?.id === id && !dirty.value) accept(value);
            await refreshList();
          }
        }
      }
      if (running.value && project.value && !busy.value && !dirty.value) {
        const id = project.value.id;
        const value = await htmlProjectsApi.get(id);
        if (project.value?.id === id && !dirty.value && !busy.value) accept(value);
        connected.value = true;
        if (value.run?.status !== 'running') await refreshList();
      }
    } catch (cause) {
      connected.value = false;
      handle(cause);
    } finally {
      if (!disposed)
        timer = setTimeout(
          () => {
            void poll();
          },
          running.value || commands.value.length || conversation.value?.pending?.status === 'running' ? 750 : 5000,
        );
    }
  }
  watch(
    content,
    () => {
      if (!project.value || !content.value || !dirty.value) return;
      const id = project.value.id;
      const draft = {
        baseRevision: project.value.revision,
        content: structuredClone(toRaw(content.value)),
      };
      draftWrites = draftWrites
        .catch(() => {})
        .then(() => drafts.write(id, draft))
        .catch(() => {
          notice.value = '本地草稿保存失败，请保存项目或下载备份';
        });
    },
    { deep: true },
  );
  function beforeUnload(event: BeforeUnloadEvent) {
    if (dirty.value) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  onMounted(async () => {
    loading.value = true;
    try {
      const [, , storage] = await Promise.all([refreshList(), models.refresh(), htmlProjectsApi.storageStatus()]);
      if (storage.issues.length) notice.value = `${storage.issues.length} 件作品无法读取，其原文件已保留。其余作品可继续使用。`;
      const id = location.hash.match(/^#(?:project|works)\/([\da-f-]{36})$/)?.[1];
      if (id) await open(id);
    } catch (cause) {
      connected.value = false;
      handle(cause);
    } finally {
      loading.value = false;
      void poll();
    }
    window.addEventListener('beforeunload', beforeUnload);
  });
  onUnmounted(() => {
    disposed = true;
    clearTimeout(timer);
    window.removeEventListener('beforeunload', beforeUnload);
    void draftWrites.finally(() => drafts.close());
  });
  return {
    projects,
    commands, enqueue, changeCommand, clearCommands,
    conversation,
    project,
    content,
    error,
    notice,
    loading,
    busy,
    connected,
    running,
    dirty,
    save,
    action,
    open,
    home,
    create,
    manage,
    run,
    ask,
    resumeConversation,
    stopConversation,
    cancel,
    undo,
    reload,
  };
}
