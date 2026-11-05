<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CreateHtmlProject, HtmlScene, TaskContinuation } from '@studio/contracts';
import { isTauri } from '@tauri-apps/api/core';
import { createPreviewDocument } from '@studio/plugin-sdk';
import { UiPopover, UiSelect } from '@studio/ui';
import Icon from '../../components/icon/index.vue';
import SendButton from '../../components/send-button/index.vue';
import ForgeMark from '../../components/forge-mark/index.vue';
import EmptyState from '../../components/empty-state/index.vue';
import TextLoading from '../../components/text-loading/index.vue';
import MarkdownContent from '../../components/markdown-content/index.vue';
import ModelSelector from '../../components/model-selector/index.vue';
import { useAppearanceStore } from '../../stores/appearance';
import { BrowserDownloadService, browserClock } from '../../platform/browser';
import { DesktopDownloadService } from '../../platform/desktop';
import { useHtmlProjects } from './use-projects';
import { previewHtml, replaceSelectedText, exportPresentation } from './html';
import ProjectStart from './components/project-start/index.vue';
import CreativePlan from './components/creative-plan/index.vue';
import ProjectLibrary from './components/project-library/index.vue';
import GenerationStatus from './components/generation-status/index.vue';
import TaskProgress from './components/task-progress/index.vue';
import ReplyFailure from './components/reply-failure/index.vue';
import ChatMessage from './components/chat-message/index.vue';
import { useWorkspacePanels } from './use-panels';

const studio = useHtmlProjects();
const {
  project,
  content,
  projects,
  conversation,
  commands: queuedMessages,
  dirty,
  error,
  notice,
  busy,
  running,
  connected,
  loading,
} = studio;
const appearance = useAppearanceStore();
const page = ref<'conversation' | 'works'>(
  location.hash.startsWith('#works') ? 'works' : 'conversation',
);
const previewSidebar = ref<HTMLElement>();
const panels = useWorkspacePanels(() => page.value === 'conversation', previewSidebar);
const sidebarVisible = computed(() => panels.leftOpen.value && !panels.rightExpanded.value);
const conversationVisible = computed(
  () =>
    page.value === 'conversation' &&
    !panels.rightExpanded.value &&
    (!panels.narrow.value || !panels.rightOpen.value),
);
const worksEmptyState = computed(() =>
  loading.value
    ? { title: '正在载入作品', description: '正在整理你的创作，请稍候。' }
    : projects.value.length
      ? {
          title: '选择一件作品，继续创作',
          description: '从左侧打开作品，在这里预览与打磨每一页。',
        }
      : {
          title: '你的作品，从一个想法开始',
          description: '开始一次对话，把灵感变成可以预览、编辑和分享的作品。',
        },
);
const previewTool = ref<'pages' | 'properties'>();
function updateRoute() {
  const id = project.value?.id;
  history.replaceState(
    null,
    '',
    page.value === 'works'
      ? `#works${id ? `/${id}` : ''}`
      : id
        ? `#project/${id}`
        : location.pathname,
  );
}
function navigate(next: 'conversation' | 'works') {
  page.value = next;
  panels.rightExpanded.value = false;
  panels.leftOpen.value = next === 'works' || !panels.narrow.value;
  updateRoute();
}
async function newConversation() {
  await studio.home();
  if (error.value) return;
  page.value = 'conversation';
  if (panels.narrow.value) panels.leftOpen.value = false;
  panels.rightOpen.value = false;
  updateRoute();
}
async function openProject(id: string) {
  await studio.open(id);
  if (error.value) return;
  panels.rightOpen.value = true;
  if (panels.narrow.value) panels.leftOpen.value = false;
  updateRoute();
}
async function createProject(input: CreateHtmlProject) {
  await studio.create(input);
  if (project.value) {
    page.value = 'conversation';
    panels.rightOpen.value = true;
    updateRoute();
  }
}
watch(
  () => project.value?.id,
  (id) => {
    if (id) panels.rightOpen.value = true;
  },
);

const download = isTauri()
  ? new DesktopDownloadService()
  : new BrowserDownloadService(browserClock);
const selectedId = ref('');
const tab = ref<'preview' | 'storyboard' | 'source'>('preview');
const inspector = ref<'scene' | 'design' | 'check'>('scene');
const instruction = ref('');
const agentMode = ref<'revise' | 'ask'>('revise');
const asking = computed(() => !!processingMessage.value && !running.value);
const queueMenu = ref('');
type ActiveTask = Omit<TaskContinuation, 'timing'> & {
  sceneId?: string;
  allowEdits: boolean;
  multiStep: boolean;
};
function currentTask(): ActiveTask | undefined {
  const pending = conversation.value?.pending;
  if (pending?.status === 'running')
    return {
      action: 'conversation',
      goal: pending.input.continuation
        ? `${pending.input.continuation.goal}\n补充要求：${pending.input.question}`
        : pending.input.question,
      sceneId: pending.input.sceneId,
      allowEdits: pending.input.allowEdits ?? true,
      multiStep: pending.input.multiStep ?? false,
    };
  const run = project.value?.run;
  if (
    run?.status === 'running' ||
    run?.status === 'awaiting_input' ||
    (busy.value && needsPlan.value)
  )
    return {
      action: run?.action ?? 'plan',
      goal: `创作主题：${content.value?.brief ?? ''}\n当前任务：${run?.action === 'build' ? '按分镜生成所有待生成页面' : run?.action === 'scene' ? '生成指定页面' : '规划作品分镜'}${run?.instruction ? `\n任务要求：${run.instruction}` : ''}`,
      sceneId: run?.action === 'scene' ? run.sceneId : undefined,
      allowEdits: true,
      multiStep: false,
    };
  const sending =
    projectMessages.value.find((message) => message.id === processingMessage.value) ??
    projectMessages.value.find((message) => message.status === 'queued');
  if (sending)
    return {
      action: 'conversation',
      goal: sending.task ? `${sending.task.goal}\n补充要求：${sending.question}` : sending.question,
      sceneId: sending.task?.sceneId ?? sending.sceneId,
      allowEdits: sending.task?.allowEdits ?? sending.mode !== 'ask',
      multiStep: sending.task?.multiStep ?? false,
    };
}
const hasActiveTask = computed(
  () =>
    busy.value ||
    running.value ||
    project.value?.run?.status === 'awaiting_input' ||
    conversation.value?.pending?.status === 'running',
);
const processingMessage = computed(
  () => queuedMessages.value.find((message) => message.status === 'running')?.id ?? '',
);
const projectMessages = computed(() =>
  queuedMessages.value.filter((message) => message.projectId === project.value?.id),
);
const waitingMessages = computed(() =>
  projectMessages.value.filter((message) => message.id !== processingMessage.value),
);
const conversationThread = ref<HTMLElement>();
const showGlobalError = computed(
  () =>
    !!error.value &&
    !projectMessages.value.some((message) => message.error === error.value) &&
    !(
      conversation.value?.pending?.status === 'interrupted' &&
      conversation.value.pending.error === error.value
    ),
);
const consultationEntries = computed(() => {
  const messages = conversation.value?.messages ?? [];
  const saved = [];
  for (let index = 0; index < messages.length; index += 2) {
    const question = messages[index]!;
    const answer = messages[index + 1]!;
    saved.push({
      id: question.id,
      title:
        content.value?.scenes.find((scene) => scene.id === question.sceneId)?.title ?? '历史页面',
      question: question.content,
      answer: answer.content,
      task: answer.task,
      error: '',
    });
  }
  const pending = conversation.value?.pending;
  // A failed queued message owns its recovery UI until it is retried or removed.
  if (
    pending &&
    !projectMessages.value.some((message) => message.id === pending.requestId && message.error)
  )
    return [
      ...saved,
      {
        id: pending.requestId,
        title:
          content.value?.scenes.find((scene) => scene.id === pending.input.sceneId)?.title ??
          '历史页面',
        question: pending.input.question,
        answer: '',
        task: pending.task,
        error: pending.status === 'interrupted' ? pending.error || '回复已中断，可继续回复' : '',
      },
    ];
  return saved;
});
watch(
  () => conversation.value?.messages.length,
  async () => {
    await nextTick();
    conversationThread.value?.scrollTo({ top: conversationThread.value.scrollHeight });
  },
);
const selection = ref<{ index: number; tag: string; text: string }>();
const replacement = ref('');
const picking = ref(false);
const frame = ref<HTMLIFrameElement>();
const stage = ref<HTMLElement>();
const scale = ref(1);
const token = ref(crypto.randomUUID());
const frameReady = ref(false);
const issues = ref<{ level: string; message: string }[]>([]);
const checked = ref(false);
const checksPending = ref(false);
let checkTimer: ReturnType<typeof setTimeout> | undefined;
const player = ref(false);
const editing = computed(
  () =>
    !!content.value &&
    !busy.value &&
    !running.value &&
    conversation.value?.pending?.status !== 'running',
);
const selected = computed(() =>
  content.value?.scenes.find((scene) => scene.id === selectedId.value),
);
const needsPlan = computed(() => !!content.value && !content.value.scenes.length);
const awaitingGenerationInput = computed(() => project.value?.run?.status === 'awaiting_input');
watch(awaitingGenerationInput, async (waiting) => {
  if (!waiting) return;
  await nextTick();
  conversationThread.value?.scrollTo({ top: conversationThread.value.scrollHeight });
});
const stopping = ref(false);
async function stopActiveTask() {
  if (stopping.value) return;
  stopping.value = true;

  try {
    await studio.clearCommands();
    await studio.reload();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '停止失败';
  } finally {
    stopping.value = false;
  }
}
async function answerGeneration(instructionText: string) {
  await studio.run(needsPlan.value ? 'plan' : 'build', undefined, instructionText);
}
const canCompose = computed(() => !!project.value && !!content.value);
watch([() => project.value?.id, needsPlan], ([id, empty], [previousId]) => {
  if (id !== previousId)
    instruction.value = empty && !busy.value && !running.value ? (content.value?.brief ?? '') : '';
});
const canvasGenerating = computed(
  () =>
    running.value &&
    (project.value?.run?.action === 'plan' ||
      !selected.value?.html ||
      project.value?.run?.sceneId === selected.value.id),
);
const loadingLocation = computed(() =>
  (page.value === 'works' || panels.rightOpen.value) &&
  tab.value === 'preview' &&
  canvasGenerating.value
    ? 'canvas'
    : conversationVisible.value
      ? 'conversation'
      : 'preview',
);
const generatingScene = computed(() =>
  content.value?.scenes.find((scene) => scene.id === project.value?.run?.sceneId),
);
const sceneIndex = computed(
  () => content.value?.scenes.findIndex((scene) => scene.id === selectedId.value) ?? -1,
);
const built = computed(() => content.value?.scenes.filter((scene) => scene.html).length ?? 0);
const unbuilt = computed(
  () => content.value?.scenes.filter((scene) => !scene.html && !scene.locked).length ?? 0,
);
const canvas = computed(() =>
  content.value?.aspect === 'portrait'
    ? { width: 720, height: 1280 }
    : content.value?.aspect === 'square'
      ? { width: 960, height: 960 }
      : { width: 1280, height: 720 },
);
const frameStyle = computed(() => ({
  width: `${canvas.value.width}px`,
  height: `${canvas.value.height}px`,
  transform: `scale(${scale.value})`,
}));
const frameDocument = computed(() =>
  selected.value?.html ? previewHtml(selected.value.html, token.value) : '',
);
const stateLabel = computed(() =>
  running.value ? '正在创作' : dirty.value ? '有未保存修改' : '已保存',
);
const tabs = [
  { id: 'preview', label: '画布' },
  { id: 'storyboard', label: '分镜总览' },
  { id: 'source', label: 'HTML 源码' },
] as const;
const inspectorTabs = [
  { id: 'scene', label: '页面' },
  { id: 'design', label: '项目风格' },
  { id: 'check', label: '检查' },
] as const;
let observer: ResizeObserver | undefined;
function fit() {
  if (stage.value)
    scale.value = Math.max(
      0.05,
      Math.min(
        (stage.value.clientWidth - 48) / canvas.value.width,
        (stage.value.clientHeight - 48) / canvas.value.height,
      ),
    );
}
watch(stage, (element) => {
  observer?.disconnect();
  if (element) {
    observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
  }
});
watch(canvas, fit);
watch(
  () => [project.value?.id, content.value?.scenes.map((scene) => scene.id).join(',')],
  () => {
    if (!content.value?.scenes.some((scene) => scene.id === selectedId.value))
      selectedId.value = content.value?.scenes[0]?.id ?? '';
  },
);
watch(
  // Compare each source separately: accepting run/progress updates replaces content
  // without necessarily changing the selected page or its preview document.
  [selectedId, () => selected.value?.html],
  () => {
    token.value = crypto.randomUUID();
    frameReady.value = false;
    selection.value = undefined;
    picking.value = false;
    checked.value = false;
    checksPending.value = false;
    clearTimeout(checkTimer);
    issues.value = [];
  },
);
watch(
  () => project.value?.id,
  () => {
    tab.value = 'preview';
    player.value = false;
  },
);
function post(type: string, data: Record<string, unknown> = {}) {
  frame.value?.contentWindow?.postMessage({ forge: token.value, type, ...data }, '*');
}
function togglePicking() {
  picking.value = !picking.value;
  post('pick', { enabled: picking.value });
  if (!picking.value) selection.value = undefined;
}
function receive(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow || event.data?.forge !== token.value) return;
  const data = event.data;
  if (data.type === 'exit') player.value = false;
  if (data.type === 'navigate' && player.value && [1, -1].includes(data.offset))
    pageStep(data.offset);
  if (data.type === 'ready') {
    frameReady.value = true;
    post('pick', { enabled: picking.value });
  }
  if (
    data.type === 'selection' &&
    Number.isInteger(data.index) &&
    data.index >= 0 &&
    typeof data.text === 'string' &&
    data.text.length <= 2000 &&
    typeof data.tag === 'string' &&
    data.tag.length <= 20
  ) {
    selection.value = { index: data.index, tag: data.tag, text: data.text };
    replacement.value = data.text;
    inspector.value = 'scene';
    previewTool.value = 'properties';
  }
  if (data.type === 'check' && Array.isArray(data.issues)) {
    issues.value = data.issues
      .filter(
        (item: { message?: unknown; level?: unknown }) =>
          typeof item?.message === 'string' && ['error', 'warning'].includes(String(item.level)),
      )
      .slice(0, 20)
      .map((item: { level: string; message: string }) => ({
        level: item.level,
        message: item.message.slice(0, 240),
      }));
    checked.value = true;
    checksPending.value = false;
    clearTimeout(checkTimer);
  }
}
function check() {
  inspector.value = 'check';
  previewTool.value = 'properties';
  tab.value = 'preview';
  checksPending.value = true;
  checked.value = false;
  post('check');
  checkTimer = setTimeout(() => {
    checksPending.value = false;
    error.value = '页面尚未就绪，暂时无法完成检查。请稍后重试。';
  }, 5000);
}
function pickScene(scene: HtmlScene) {
  selectedId.value = scene.id;
  tab.value = 'preview';
}
function moveScene(offset: number) {
  if (!content.value || !editing.value) return;
  const index = sceneIndex.value,
    target = index + offset;
  if (target < 0 || target >= content.value.scenes.length) return;
  const [scene] = content.value.scenes.splice(index, 1);
  content.value.scenes.splice(target, 0, scene!);
}
function addScene() {
  if (!content.value || content.value.scenes.length >= 12) return;
  const scene: HtmlScene = {
    id: crypto.randomUUID(),
    title: '新的页面',
    objective: '这一页希望读者理解什么？',
    content: '',
    layout: '沿用项目视觉风格',
    html: '',
    locked: false,
  };
  content.value.scenes.splice(sceneIndex.value + 1, 0, scene);
  selectedId.value = scene.id;
}
function removeScene() {
  if (content.value && selected.value && !selected.value.locked)
    content.value.scenes = content.value.scenes.filter((scene) => scene.id !== selectedId.value);
}
function applyText() {
  if (!selected.value || !selection.value) return;
  try {
    selected.value.html = replaceSelectedText(
      selected.value.html,
      selection.value.index,
      selection.value.text,
      replacement.value,
    );
    if (
      selection.value.tag === 'h1' &&
      selected.value.title === selection.value.text &&
      replacement.value.trim().length <= 120 &&
      replacement.value.trim()
    )
      selected.value.title = replacement.value.trim();
    notice.value = '文字已修改，保存后会用于后续 AI 续改';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '修改失败';
  }
}
async function submitAgent() {
  if (!canCompose.value || stopping.value || !instruction.value.trim()) return;
  const question =
    selection.value && agentMode.value === 'revise' && !needsPlan.value
      ? `${instruction.value.trim()}\n已引用当前页元素：${selection.value.tag}，索引 ${selection.value.index}，文本：${selection.value.text.slice(0, 120)}`
      : instruction.value.trim();
  const task = currentTask();
  const message = {
    id: crypto.randomUUID(),
    projectId: project.value!.id,
    question,
    sceneId: selected.value?.id,
    mode: agentMode.value,
    kind: (needsPlan.value || (running.value && project.value?.run?.action === 'plan')
      ? 'plan'
      : 'message') as 'plan' | 'message',
    append: busy.value || running.value || projectMessages.value.length > 0,
    task,
    timing: 'after' as const,
  };
  const draft = instruction.value;
  instruction.value = '';
  try {
    if (awaitingGenerationInput.value && !projectMessages.value.length) {
      await answerGeneration(question);
      if (error.value) throw new Error(error.value);
    } else await studio.enqueue(message);
  } catch (cause) {
    if (!instruction.value) instruction.value = draft;
    error.value = cause instanceof Error ? cause.message : '发送失败';
  }
}
async function updateCommand(id: string, action: 'remove' | 'retry' | 'interrupt') {
  try {
    await studio.changeCommand(id, action);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '任务操作失败';
  }
}
function steerMessage(id: string) {
  void updateCommand(id, 'interrupt');
}
function removeMessage(id: string) {
  void updateCommand(id, 'remove');
}
function restoreMessage(id: string) {
  const message = projectMessages.value.find((entry) => entry.id === id);
  if (!message || id === processingMessage.value) return;
  instruction.value = instruction.value
    ? `${instruction.value}\n${message.question}`
    : message.question;
  removeMessage(id);
}
function retryMessage(id: string) {
  void updateCommand(id, 'retry');
}

async function exportHtml() {
  await studio.action(async () => {
    await studio.save();
    if (dirty.value) throw new Error('保存期间内容发生变化，请再次导出');
    if (
      !content.value ||
      !content.value.scenes.length ||
      content.value.scenes.some((scene) => !scene.html)
    )
      throw new Error('请先生成所有页面，再导出完整演示');
    await download.save({
      filename: `${content.value.title.replace(/[\\/:*?"<>|]/g, '_')}.html`,
      blob: new Blob([exportPresentation(content.value)], { type: 'text/html' }),
    });
  });
}
async function exportProject() {
  if (!content.value) return;
  await studio.action(async () => {
    await download.save({
      filename: `${content.value!.title.replace(/[\\/:*?"<>|]/g, '_')}.json`,
      blob: new Blob(
        [JSON.stringify({ schemaVersion: 1, ...project.value, content: content.value }, null, 2)],
        { type: 'application/json' },
      ),
    });
  });
}
function pageStep(offset: number) {
  const scene = content.value?.scenes[sceneIndex.value + offset];
  if (scene) selectedId.value = scene.id;
}
function keyboard(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (editing.value) void studio.action(studio.save);
    return;
  }
  if (
    event.target instanceof HTMLElement &&
    event.target.closest('input,textarea,select,[contenteditable]')
  )
    return;
  if (player.value && event.key === 'ArrowRight') pageStep(1);
  if (player.value && event.key === 'ArrowLeft') pageStep(-1);
  if (event.key === 'Escape') player.value = false;
}
onMounted(() => {
  window.addEventListener('message', receive);
  window.addEventListener('keydown', keyboard);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  clearTimeout(checkTimer);
  window.removeEventListener('message', receive);
  window.removeEventListener('keydown', keyboard);
});
</script>

<template>
  <div
    class="forge-studio"
    :class="{
      'presentation-mode': player,
      'home-mode': true,
      'is-resizing': !!panels.resizing.value,
    }"
  >
    <div class="generation-ambience" aria-hidden="true" />
    <aside class="forge-rail" aria-label="工作台导航">
      <button
        class="forge-brand"
        aria-label="新建对话"
        title="Forge · 新建对话"
        :disabled="busy"
        @click="newConversation()"
      >
        <ForgeMark />
      </button>
      <button
        class="rail-button"
        :class="{ active: page === 'conversation' }"
        :aria-current="page === 'conversation' ? 'page' : undefined"
        aria-label="对话"
        title="对话"
        @click="navigate('conversation')"
      >
        <Icon name="chat" :size="20" />
      </button>
      <button
        class="rail-button"
        :class="{ active: page === 'works' }"
        :aria-current="page === 'works' ? 'page' : undefined"
        aria-label="作品"
        title="作品"
        @click="navigate('works')"
      >
        <Icon name="folder" :size="20" />
      </button>
      <div class="rail-bottom">
        <button
          class="rail-button"
          aria-label="切换明暗主题"
          title="切换明暗主题"
          @click="appearance.preference = appearance.resolvedTheme === 'dark' ? 'light' : 'dark'"
        >
          <Icon :name="appearance.resolvedTheme === 'dark' ? 'moon' : 'sun'" :size="19" /></button
        ><span
          class="connection-light"
          :class="{ online: connected }"
          :title="connected ? '本地服务已连接' : '等待本地服务'"
        />
      </div>
    </aside>
    <div class="forge-main">
      <header class="workspace-header">
        <div>
          <button
            class="workspace-icon"
            :aria-label="
              page === 'works'
                ? sidebarVisible
                  ? '收起作品侧栏'
                  : '展开作品侧栏'
                : sidebarVisible
                  ? '收起对话历史'
                  : '展开对话历史'
            "
            :aria-expanded="sidebarVisible"
            aria-controls="workspace-sidebar"
            @click="
              panels.leftOpen.value = !sidebarVisible;
              panels.rightExpanded.value = false;
            "
          >
            <Icon name="panel-left" :size="18" />
          </button>
          <h1>{{ page === 'conversation' ? '对话' : '作品' }}</h1>
          <span v-if="project" class="workspace-project-title">{{ content?.title }}</span>
        </div>
        <div>
          <button
            v-if="project && page === 'works'"
            class="workspace-text-button"
            @click="navigate('conversation')"
          >
            <Icon name="chat" :size="16" />继续对话
          </button>
          <button class="workspace-text-button" :disabled="busy" @click="newConversation()">
            ＋ 新建对话</button
          ><button
            v-if="project && page === 'conversation'"
            class="workspace-text-button"
            :aria-pressed="panels.rightOpen.value"
            :aria-label="panels.rightOpen.value ? '收起预览侧栏' : '展开预览侧栏'"
            @click="panels.rightOpen.value = !panels.rightOpen.value"
          >
            <Icon name="panel-right" :size="16" />预览
          </button>
        </div>
      </header>
      <div v-if="showGlobalError" class="studio-alert" role="alert">
        <span>{{ error }}</span
        ><button :disabled="busy" @click="studio.reload()">重新连接 / 载入</button
        ><button aria-label="关闭错误提示" @click="error = ''">×</button>
      </div>
      <div v-if="notice" class="studio-notice" role="status">
        {{ notice }}<button aria-label="关闭提示" @click="notice = ''">×</button>
      </div>
      <div
        class="workspace-panels"
        :role="page === 'works' ? 'region' : undefined"
        :aria-label="page === 'works' ? '作品页' : undefined"
        :class="{
          'works-mode': page === 'works',
          'preview-expanded': panels.rightExpanded.value,
          'has-preview': panels.rightOpen.value && project,
          'has-library': panels.leftOpen.value,
        }"
      >
        <div
          v-if="panels.leftOpen.value"
          id="workspace-sidebar"
          class="library-sidebar"
          :style="{ width: `${panels.leftWidth.value}px` }"
        >
          <ProjectLibrary
            :projects="projects"
            :current-id="project?.id"
            :busy="busy"
            :loading="loading"
            :mode="page === 'conversation' ? 'conversations' : 'works'"
            :expanded="panels.leftExpanded.value"
            @open="openProject"
            @manage="studio.manage"
            @create="newConversation()"
            @collapse="panels.leftOpen.value = false"
            @expand="panels.expandLeft()"
          />
        </div>
        <div
          v-if="panels.leftOpen.value && !panels.narrow.value"
          class="panel-resizer"
          role="separator"
          :aria-label="page === 'works' ? '调整作品侧栏宽度' : '调整对话历史宽度'"
          aria-orientation="vertical"
          tabindex="0"
          :aria-valuemin="200"
          :aria-valuemax="Math.round(panels.leftMax.value)"
          :aria-valuenow="Math.round(panels.leftWidth.value)"
          title="左右拖动调整宽度，双击恢复默认"
          @pointerdown="panels.start('left', $event)"
          @keydown="panels.keyboard('left', $event)"
          @dblclick="panels.reset('left')"
        />
        <section v-if="page === 'conversation'" class="workspace-center" aria-label="对话页">
          <ProjectStart
            v-if="!project"
            :connected="connected"
            :busy="busy"
            @create="createProject"
            @error="error = $event"
          />
          <div v-else-if="content" class="conversation-page">
            <div ref="conversationThread" class="conversation-thread">
              <ChatMessage role="user" class="conversation-request">
                <p>{{ content.brief }}</p>
              </ChatMessage>
              <ChatMessage role="assistant" class="conversation-response" :generating="running">
                <GenerationStatus
                  v-if="running && project.run && loadingLocation === 'conversation'"
                  :run="project.run"
                  compact
                />
                <div v-else-if="!running" class="response-heading">
                  <Icon name="spark" :size="18" /><span>{{
                    running ? '正在创作' : content.scenes.length ? '分镜已就绪' : '开始规划分镜'
                  }}</span>
                </div>
                <p
                  v-if="project.run && !running && conversationVisible"
                  class="response-status"
                  :class="project.run.status"
                >
                  {{ project.run.message }}
                </p>
                <CreativePlan v-if="content.scenes.length" :content="content" />
                <ol v-if="content.scenes.length" class="conversation-scenes">
                  <li v-for="(scene, index) in content.scenes" :key="scene.id">
                    <button
                      :class="{ selected: scene.id === selectedId }"
                      @click="
                        pickScene(scene);
                        panels.rightOpen.value = true;
                      "
                    >
                      <span>{{ String(index + 1).padStart(2, '0') }}</span
                      ><strong>{{ scene.title }}</strong
                      ><small>{{
                        running && project.run?.sceneId === scene.id
                          ? '生成中'
                          : scene.html
                            ? '已生成'
                            : '待生成'
                      }}</small>
                    </button>
                  </li>
                </ol>
                <button
                  v-if="!running && !awaitingGenerationInput && (unbuilt || !content.scenes.length)"
                  class="quiet-button conversation-build"
                  :disabled="busy || conversation?.pending?.status === 'running'"
                  @click="studio.run(content.scenes.length ? 'build' : 'plan')"
                >
                  <Icon name="spark" :size="15" />{{
                    content.scenes.length ? '生成未完成页面' : '规划分镜'
                  }}
                </button>
                <TaskProgress
                  v-if="project.run?.task && !awaitingGenerationInput"
                  :task="project.run.task"
                  :interrupted="['cancelled', 'failed'].includes(project.run.status)"
                  incremental
                />
                <section
                  v-if="awaitingGenerationInput && project.run?.clarification"
                  class="generation-question"
                  aria-label="生成前确认"
                >
                  <p>{{ project.run.clarification.question }}</p>
                  <div class="generation-options">
                    <button
                      v-for="option in project.run.clarification.options"
                      :key="option.label"
                      class="quiet-button"
                      :disabled="busy"
                      @click="answerGeneration(option.instruction)"
                    >
                      {{ option.label }}
                    </button>
                    <button
                      class="quiet-button"
                      :disabled="busy"
                      @click="
                        answerGeneration(
                          '请结合主题、分镜和对话背景自行判断，采用合理方案继续生成，无需我补充要求。',
                        )
                      "
                    >
                      交给 AI 判断
                    </button>
                    <button class="quiet-button" :disabled="busy" @click="studio.cancel()">
                      取消生成
                    </button>
                  </div>
                  <small>也可以在下方输入具体要求。</small>
                </section>
              </ChatMessage>
              <div v-for="entry in consultationEntries" :key="entry.id" class="page-consultation">
                <ChatMessage role="user">
                  <p class="consultation-question">{{ entry.question }}</p>
                </ChatMessage>
                <ChatMessage
                  role="assistant"
                  :generating="
                    conversation?.pending?.requestId === entry.id &&
                    conversation.pending.status === 'running'
                  "
                >
                  <small>{{ entry.task ? '多步任务' : '页面对话' }} · {{ entry.title }}</small>
                  <TaskProgress v-if="entry.task" :task="entry.task" :interrupted="!!entry.error" />
                  <TextLoading
                    v-if="!entry.task && !entry.answer && !entry.error"
                    class="consultation-answer"
                  />
                  <MarkdownContent
                    v-if="
                      entry.answer &&
                      !(
                        entry.task?.phase === 'completed' &&
                        entry.answer.startsWith('**多步任务已完成**')
                      )
                    "
                    class="consultation-answer"
                    :content="entry.answer"
                  />
                  <ReplyFailure
                    v-if="entry.error"
                    title="回复已中断"
                    :detail="entry.error"
                    :action-label="
                      conversation?.pending?.input.multiStep ? '重新执行任务' : '继续回复'
                    "
                    :disabled="busy || running || dirty"
                    @retry="studio.resumeConversation()"
                  />
                </ChatMessage>
              </div>
            </div>
            <section class="scene-agent">
              <div v-if="selection && agentMode === 'revise'" class="agent-selection">
                已引用：{{ selection.text.slice(0, 55)
                }}<button aria-label="清除选中元素" @click="selection = undefined">×</button>
              </div>
              <div
                v-if="waitingMessages.length"
                class="agent-queue"
                aria-label="待处理消息"
                aria-live="polite"
              >
                <article
                  v-for="message in waitingMessages"
                  :key="message.id"
                  class="agent-queued-message"
                >
                  <div class="queued-message-row">
                    <Icon name="queue" :size="16" />
                    <p :title="message.question">{{ message.question }}</p>
                    <div class="queued-message-actions">
                      <button
                        type="button"
                        class="queued-steer"
                        :disabled="stopping"
                        title="中断当前任务，合并这条要求后继续"
                        @click="steerMessage(message.id)"
                      >
                        <Icon name="steer" :size="16" /><span>引导</span>
                      </button>
                      <button
                        type="button"
                        aria-label="删除待追加消息"
                        title="删除待追加消息"
                        @click="removeMessage(message.id)"
                      >
                        <Icon name="trash" :size="16" />
                      </button>
                      <UiPopover
                        :open="queueMenu === message.id"
                        placement="top-end"
                        :width="180"
                        role="menu"
                        label="消息操作"
                        @update:open="queueMenu = $event ? message.id : ''"
                      >
                        <template #trigger="{ panelId }">
                          <button
                            type="button"
                            aria-label="更多消息操作"
                            title="更多操作"
                            aria-haspopup="menu"
                            :aria-expanded="queueMenu === message.id"
                            :aria-controls="panelId"
                            @click="queueMenu = queueMenu === message.id ? '' : message.id"
                          >
                            <Icon name="more" :size="16" />
                          </button>
                        </template>
                        <template #default="{ close }">
                          <button
                            type="button"
                            role="menuitem"
                            class="queued-restore"
                            @click="
                              close();
                              restoreMessage(message.id);
                            "
                          >
                            移回输入框
                          </button>
                        </template>
                      </UiPopover>
                    </div>
                  </div>
                  <ReplyFailure
                    v-if="message.error"
                    title="这条消息暂未完成"
                    :detail="message.error"
                    action-label="重试发送"
                    :disabled="
                      busy || running || stopping || conversation?.pending?.status === 'running'
                    "
                    @retry="retryMessage(message.id)"
                  />
                </article>
              </div>
              <div class="agent-composer">
                <textarea
                  v-model="instruction"
                  :aria-label="
                    awaitingGenerationInput
                      ? needsPlan
                        ? '补充你的选择'
                        : '页面生成要求'
                      : needsPlan
                        ? '创作要求'
                        : agentMode === 'ask'
                          ? '当前页问题'
                          : '页面问题或修改要求'
                  "
                  :maxlength="needsPlan ? 8000 : 1800"
                  :disabled="!canCompose"
                  :placeholder="
                    awaitingGenerationInput
                      ? '选择建议，或直接补充你的想法…'
                      : needsPlan
                        ? '和 Forge 一起创作'
                        : agentMode === 'ask'
                          ? '这页讲了什么？有什么可以改进的地方？'
                          : selection
                            ? '描述这个元素应该如何调整…'
                            : '和 Forge 一起创作'
                  "
                  @keydown.meta.enter.prevent="submitAgent()"
                  @keydown.ctrl.enter.prevent="submitAgent()"
                />
                <div class="agent-footer">
                  <div class="agent-footer-left">
                    <button
                      v-if="
                        !needsPlan &&
                        !awaitingGenerationInput &&
                        !running &&
                        conversation?.pending?.status !== 'running'
                      "
                      type="button"
                      class="agent-mode-switch"
                      role="switch"
                      aria-label="询问模式"
                      :aria-checked="agentMode === 'ask'"
                      :disabled="busy"
                      :title="
                        agentMode === 'ask'
                          ? '已开启：只返回文字建议，页面保持原样'
                          : '当前可回答问题或修改页面；开启询问模式后只返回建议'
                      "
                      @click="agentMode = agentMode === 'ask' ? 'revise' : 'ask'"
                    >
                      <span>询问模式</span
                      ><span class="switch-track" aria-hidden="true"><span /></span>
                    </button>
                  </div>
                  <div class="agent-send-controls">
                    <ModelSelector kind="html" />
                    <button
                      v-if="
                        (running || conversation?.pending?.status === 'running') &&
                        !instruction.trim()
                      "
                      type="button"
                      class="agent-composer-stop"
                      aria-label="停止任务"
                      :disabled="stopping"
                      :title="stopping ? '正在停止…' : '停止任务'"
                      @click="stopActiveTask()"
                    >
                      <span aria-hidden="true" />
                    </button>
                    <SendButton
                      v-else
                      :aria-label="
                        needsPlan
                          ? '发送创作要求并重新规划'
                          : awaitingGenerationInput
                            ? '发送页面生成要求'
                            : agentMode === 'ask'
                              ? '发送当前页问题'
                              : '发送消息'
                      "
                      :title="
                        hasActiveTask
                          ? '追加到当前任务，完成后处理；可在消息条中点击引导立即追加'
                          : needsPlan
                            ? '按修改后的创作要求重新规划分镜'
                            : awaitingGenerationInput
                              ? '按你的要求继续生成页面'
                              : asking
                                ? '追加发送，等待当前任务完成'
                                : agentMode === 'ask'
                                  ? '发送当前页问题'
                                  : '发送消息，可询问或修改页面'
                      "
                      :disabled="!canCompose || stopping || !instruction.trim()"
                      @click="submitAgent()"
                    />
                  </div>
                </div>
              </div>
              <p v-if="project.modelSelection.provider === 'demo'" class="demo-disclosure">
                本地演示：规则样例，非 AI 生成
              </p>
            </section>
          </div>
        </section>
        <div
          v-if="
            page === 'conversation' &&
            panels.rightOpen.value &&
            project &&
            !panels.narrow.value &&
            !panels.rightExpanded.value
          "
          class="panel-resizer"
          role="separator"
          aria-label="调整预览侧栏宽度"
          aria-orientation="vertical"
          tabindex="0"
          :aria-valuemin="360"
          :aria-valuemax="Math.round(panels.rightMax.value)"
          :aria-valuenow="Math.round(panels.rightWidth.value)"
          title="左右拖动调整宽度，双击恢复默认"
          @pointerdown="panels.start('right', $event)"
          @keydown="panels.keyboard('right', $event)"
          @dblclick="panels.reset('right')"
        />
        <aside
          v-if="(page === 'works' || panels.rightOpen.value) && project && content"
          ref="previewSidebar"
          class="preview-sidebar"
          aria-label="预览侧栏"
          :style="{ width: `${panels.rightWidth.value}px` }"
        >
          <header class="preview-header">
            <div class="preview-heading">
              <strong>预览</strong>
              <div>
                <button
                  class="workspace-text-button"
                  :aria-pressed="previewTool === 'pages'"
                  aria-label="页面分镜"
                  @click="previewTool = previewTool === 'pages' ? undefined : 'pages'"
                >
                  <Icon name="grid" :size="15" />页面</button
                ><button
                  class="workspace-text-button"
                  :aria-pressed="previewTool === 'properties'"
                  aria-label="页面属性"
                  @click="previewTool = previewTool === 'properties' ? undefined : 'properties'"
                >
                  <Icon name="settings" :size="15" />属性</button
                ><button
                  class="workspace-icon"
                  :aria-label="panels.rightExpanded.value ? '还原预览宽度' : '扩张预览侧栏'"
                  @click="panels.rightExpanded.value = !panels.rightExpanded.value"
                >
                  <Icon
                    :name="panels.rightExpanded.value ? 'collapse' : 'expand'"
                    :size="16"
                  /></button
                ><button
                  v-if="page === 'conversation'"
                  class="workspace-icon"
                  aria-label="关闭预览侧栏"
                  @click="panels.rightOpen.value = false"
                >
                  <Icon name="close" :size="17" />
                </button>
              </div>
            </div>
            <div class="header-actions">
              <template v-if="project">
                <span class="save-indicator" :class="{ changed: dirty }"
                  ><i />{{ stateLabel }}</span
                >
                <button
                  class="quiet-button save-button"
                  :disabled="!editing || !dirty"
                  @click="studio.action(studio.save)"
                >
                  保存修改
                </button>
                <button
                  class="quiet-button"
                  title="撤销上次项目修改"
                  :disabled="!editing || !project.undoDepth"
                  @click="studio.undo()"
                >
                  <Icon name="restore" :size="16" /><span>撤销</span>
                </button>
                <button
                  class="quiet-button"
                  :disabled="!content?.scenes.length"
                  @click="exportProject()"
                >
                  <Icon name="download" :size="16" /><span>项目</span>
                </button>
                <button
                  class="accent-button"
                  :disabled="busy || running || !built || built !== content?.scenes.length"
                  @click="exportHtml()"
                >
                  <Icon name="external" :size="16" />导出 HTML
                </button>
              </template>
            </div>
          </header>
          <main
            v-if="content"
            class="authoring-workspace"
            :style="{ '--inspector-width': `${panels.inspectorWidth.value}px` }"
            :class="{
              'with-pages': previewTool === 'pages',
              'with-properties': previewTool === 'properties',
            }"
          >
            <aside class="scene-sidebar" aria-label="页面分镜">
              <div class="scene-sidebar-heading">
                <div>
                  <span class="section-kicker">STORYBOARD</span>
                  <h2>
                    页面分镜 <small>{{ content.scenes.length }}</small>
                  </h2>
                </div>
                <button
                  class="square-button"
                  title="新增页面"
                  aria-label="新增页面"
                  :disabled="!editing || content.scenes.length >= 12"
                  @click="addScene()"
                >
                  ＋
                </button>
              </div>
              <div class="scene-list">
                <button
                  v-for="(scene, index) in content.scenes"
                  :key="scene.id"
                  class="scene-tile"
                  :class="{
                    selected: scene.id === selectedId,
                    generating: running && project.run?.sceneId === scene.id,
                  }"
                  :aria-label="`第 ${index + 1} 页：${scene.title}`"
                  :aria-current="scene.id === selectedId ? 'true' : undefined"
                  @click="pickScene(scene)"
                >
                  <div class="scene-poster">
                    <iframe
                      v-if="scene.html"
                      :title="`${scene.title}缩略图`"
                      tabindex="-1"
                      sandbox=""
                      loading="lazy"
                      :srcdoc="createPreviewDocument(scene.html)"
                    />
                    <div v-else class="outline-poster">
                      <span>{{ String(index + 1).padStart(2, '0') }}</span
                      ><strong>{{ scene.title }}</strong
                      ><i /><i />
                    </div>
                    <span class="scene-number">{{ String(index + 1).padStart(2, '0') }}</span
                    ><span v-if="scene.locked" class="scene-status">已锁定</span
                    ><span v-else-if="!scene.html" class="scene-status">分镜</span>
                  </div>
                  <div class="scene-tile-caption">
                    <span>{{ scene.title }}</span
                    ><i :class="{ built: !!scene.html }" />
                  </div>
                </button>
                <div v-if="!content.scenes.length" class="scene-planning">
                  <Icon name="spark" :size="26" />
                  <p>{{ running ? '正在构思页面分镜…' : '开始规划你的故事' }}</p>
                  <span>先确定结构，再展开细节</span>
                </div>
              </div>
              <div class="scene-sidebar-footer">
                <button
                  class="accent-button"
                  :disabled="busy || running || (!unbuilt && !!content.scenes.length)"
                  @click="studio.run(content.scenes.length ? 'build' : 'plan')"
                >
                  <Icon name="spark" :size="16" />{{
                    content.scenes.length ? '生成未完成页面' : '规划分镜'
                  }}<span v-if="unbuilt">{{ unbuilt }}</span>
                </button>
              </div>
            </aside>
            <section class="creative-canvas">
              <div class="canvas-toolbar">
                <div class="canvas-tabs" role="tablist" aria-label="编辑视图">
                  <button
                    v-for="item in tabs"
                    :key="item.id"
                    role="tab"
                    :aria-selected="tab === item.id"
                    :class="{ active: tab === item.id }"
                    :disabled="item.id === 'source' && !selected"
                    @click="tab = item.id"
                  >
                    {{ item.label }}
                  </button>
                </div>
                <div class="canvas-actions">
                  <button
                    v-if="running && !conversationVisible"
                    class="quiet-button"
                    :disabled="busy"
                    @click="studio.cancel()"
                  >
                    <Icon name="pause" :size="13" />停止
                  </button>
                  <button
                    class="quiet-button"
                    title="检查当前页"
                    :disabled="!selected?.html || !frameReady || tab !== 'preview'"
                    @click="check()"
                  >
                    <Icon name="check" :size="16" /><span>检查</span></button
                  ><button
                    class="quiet-button"
                    title="放映"
                    :disabled="!selected?.html"
                    @click="
                      player = !player;
                      tab = 'preview';
                    "
                  >
                    <Icon :name="player ? 'collapse' : 'expand'" :size="16" /><span>{{
                      player ? '退出' : '放映'
                    }}</span>
                  </button>
                </div>
              </div>
              <div
                v-if="running && project.run && loadingLocation === 'preview'"
                class="run-progress"
              >
                <GenerationStatus :run="project.run" compact />
              </div>
              <div
                v-else-if="
                  !conversationVisible &&
                  (project.run?.status === 'failed' || project.run?.status === 'cancelled')
                "
                class="run-result"
                :class="project.run.status"
                role="status"
              >
                {{ project.run.message
                }}<button
                  v-if="project.run.action === 'plan' && !content.scenes.length"
                  :disabled="busy"
                  @click="studio.run('plan')"
                >
                  重新规划
                </button>
              </div>
              <div v-if="tab === 'storyboard'" class="storyboard-overview">
                <div class="overview-heading">
                  <span class="section-kicker">THE STORY, AT A GLANCE</span>
                  <h2>{{ content.title }}</h2>
                  <p>{{ content.brief }}</p>
                </div>
                <CreativePlan :content="content" />
                <div class="storyboard-grid">
                  <button
                    v-for="(scene, index) in content.scenes"
                    :key="scene.id"
                    class="storyboard-card"
                    @click="pickScene(scene)"
                  >
                    <span
                      >SCENE {{ String(index + 1).padStart(2, '0')
                      }}<small>{{ scene.html ? '已生成' : '待创作' }}</small></span
                    >
                    <h3>{{ scene.title }}</h3>
                    <p>{{ scene.objective }}</p>
                    <div>{{ scene.layout }}</div>
                    <footer>打开这一页 <Icon name="arrow" :size="15" /></footer>
                  </button>
                </div>
              </div>
              <div v-else-if="tab === 'source' && selected" class="source-pane">
                <div class="source-caption">
                  <span>{{ `scene-${String(sceneIndex + 1).padStart(2, '0')}.html` }}</span
                  ><span>编辑后保存，AI 将基于此版本续改</span>
                </div>
                <textarea
                  v-model="selected.html"
                  aria-label="页面 HTML 源码"
                  maxlength="250000"
                  spellcheck="false"
                  :disabled="!editing || selected.locked"
                />
                <div class="source-footer">
                  <span>{{ selected.html.length.toLocaleString() }} 字符</span
                  ><button
                    class="quiet-button"
                    :disabled="!editing || !dirty"
                    @click="studio.action(studio.save)"
                  >
                    保存修改
                  </button>
                </div>
              </div>
              <div v-else ref="stage" class="canvas-stage">
                <Transition name="canvas-reveal" mode="out-in">
                  <GenerationStatus
                    v-if="running && project.run && loadingLocation === 'canvas'"
                    :run="project.run"
                    :scene-title="generatingScene?.title"
                  />
                  <iframe
                    v-else-if="selected?.html"
                    ref="frame"
                    class="scene-frame"
                    title="当前页面预览"
                    sandbox="allow-scripts"
                    referrerpolicy="no-referrer"
                    :style="frameStyle"
                    :srcdoc="frameDocument"
                  />
                  <div
                    v-else-if="selected"
                    class="scene-outline"
                    :style="{ '--project-accent': content.accent }"
                  >
                    <span class="outline-eyebrow"
                      >SCENE {{ String(sceneIndex + 1).padStart(2, '0') }} /
                      {{ content.scenes.length }}</span
                    >
                    <h2>{{ selected.title }}</h2>
                    <p>{{ selected.objective }}</p>
                    <div class="outline-layout">
                      <Icon name="grid" :size="18" />{{ selected.layout }}
                    </div>
                    <button
                      class="accent-button"
                      :disabled="!editing || selected.locked"
                      @click="studio.run('scene', selected.id)"
                    >
                      <Icon name="spark" :size="16" />生成这一页</button
                    ><small>这是一份分镜，页面尚未生成</small>
                  </div>
                  <div v-else class="canvas-waiting">
                    <div class="waiting-composition"><i /><i /><i /></div>
                    <span class="section-kicker">A STORY IS TAKING SHAPE</span>
                    <h2>{{ running ? '让故事，先有骨架。' : '从分镜开始创作' }}</h2>
                    <p>每一页一个重点，让表达循序展开。</p>
                  </div>
                </Transition>
              </div>
              <footer class="canvas-footer">
                <button v-if="player" class="quiet-button" @click="player = false">退出放映</button>
                <div>
                  <button
                    class="square-button"
                    aria-label="上一页"
                    :disabled="sceneIndex <= 0"
                    @click="pageStep(-1)"
                  >
                    ←</button
                  ><span>{{
                    content.scenes.length
                      ? `${sceneIndex + 1} / ${content.scenes.length}`
                      : '分镜规划'
                  }}</span
                  ><button
                    class="square-button"
                    aria-label="下一页"
                    :disabled="sceneIndex >= content.scenes.length - 1"
                    @click="pageStep(1)"
                  >
                    →
                  </button>
                </div>
                <button
                  v-if="selected?.html && tab === 'preview' && !player"
                  class="pick-button"
                  :class="{ active: picking }"
                  :aria-pressed="picking"
                  :disabled="!editing || selected.locked || !frameReady"
                  @click="togglePicking()"
                >
                  <Icon name="expand" :size="14" />{{
                    picking ? '正在点选 · 点击画面文字' : '点选修改'
                  }}</button
                ><span class="canvas-size"
                  >{{ canvas.width }} × {{ canvas.height }}
                  <span v-if="tab === 'preview' && selected?.html"
                    >· {{ Math.round(scale * 100) }}%</span
                  ></span
                >
              </footer>
            </section>
            <aside class="creative-inspector" aria-label="创作属性">
              <div
                v-if="previewTool === 'properties' && !player"
                class="inspector-resizer"
                role="separator"
                aria-label="调整创作属性宽度"
                aria-orientation="vertical"
                tabindex="0"
                :aria-valuemin="Math.round(panels.inspectorMin.value)"
                :aria-valuemax="Math.round(panels.inspectorMax.value)"
                :aria-valuenow="Math.round(panels.inspectorWidth.value)"
                title="左右拖动调整宽度，双击恢复默认"
                @pointerdown="panels.start('inspector', $event)"
                @keydown="panels.keyboard('inspector', $event)"
                @dblclick="panels.reset('inspector')"
              />
              <div class="inspector-tabs">
                <button
                  v-for="item in inspectorTabs"
                  :key="item.id"
                  :class="{ active: inspector === item.id }"
                  @click="inspector = item.id"
                >
                  {{ item.label }}<i v-if="item.id === 'check' && checked && issues.length" />
                </button>
              </div>
              <div class="inspector-content">
                <template v-if="inspector === 'scene' && selected"
                  ><div class="inspector-section-title">
                    <span>SCENE {{ String(sceneIndex + 1).padStart(2, '0') }}</span
                    ><button
                      class="lock-button"
                      :class="{ locked: selected.locked }"
                      :disabled="!editing"
                      @click="selected.locked = !selected.locked"
                    >
                      {{ selected.locked ? '已锁定 · 解锁' : '锁定页面' }}
                    </button>
                  </div>
                  <fieldset :disabled="!editing || selected.locked">
                    <label
                      >页面标题<input
                        v-model="selected.title"
                        aria-label="页面标题"
                        maxlength="120" /></label
                    ><label
                      >这一页要讲清楚什么<textarea
                        v-model="selected.objective"
                        aria-label="页面目标"
                        maxlength="1000"
                        rows="3"
                      /></label
                    ><label
                      >内容与素材<textarea
                        v-model="selected.content"
                        aria-label="页面内容"
                        maxlength="4000"
                        rows="5"
                        placeholder="补充要点、数据、案例或需要保留的原文…"
                      /></label
                    ><label
                      >画面与布局<textarea
                        v-model="selected.layout"
                        aria-label="页面布局"
                        maxlength="500"
                        rows="3"
                      />
                    </label>
                  </fieldset>
                  <div class="scene-management">
                    <button
                      class="quiet-button"
                      aria-label="上移页面"
                      :disabled="!editing || sceneIndex <= 0"
                      @click="moveScene(-1)"
                    >
                      ↑ 上移</button
                    ><button
                      class="quiet-button"
                      aria-label="下移页面"
                      :disabled="!editing || sceneIndex >= content.scenes.length - 1"
                      @click="moveScene(1)"
                    >
                      ↓ 下移</button
                    ><button
                      class="quiet-button danger-text"
                      :disabled="!editing || selected.locked || content.scenes.length <= 1"
                      @click="removeScene()"
                    >
                      删除
                    </button>
                  </div>
                  <div v-if="selection" class="selection-editor">
                    <span class="section-kicker">SELECTED ELEMENT · {{ selection.tag }}</span>
                    <blockquote>{{ selection.text.slice(0, 160) }}</blockquote>
                    <label
                      >替换文字<textarea
                        v-model="replacement"
                        aria-label="替换选中文字"
                        maxlength="2000"
                        rows="3"
                        :disabled="!editing || selected.locked"
                      /></label
                    ><button
                      class="quiet-button"
                      :disabled="!editing || selected.locked || replacement === selection.text"
                      @click="applyText()"
                    >
                      应用文字修改 <Icon name="arrow" :size="15" />
                    </button></div
                ></template>
                <template v-else-if="inspector === 'design'"
                  ><div class="inspector-section-title"><span>CREATIVE DIRECTION</span></div>
                  <fieldset :disabled="!editing">
                    <label
                      >项目名称<input
                        v-model="content.title"
                        aria-label="项目名称"
                        maxlength="120" /></label
                    ><label
                      >目标读者<input
                        v-model="content.audience"
                        aria-label="项目目标读者"
                        maxlength="300" /></label
                    ><label
                      >创作主题<textarea
                        v-model="content.brief"
                        aria-label="项目主题"
                        maxlength="8000"
                        rows="5"
                      /></label
                    ><label
                      >视觉风格<UiSelect
                        v-model="content.style"
                        aria-label="项目视觉风格"
                        :options="[
                          { value: 'editorial', label: '杂志叙事' },
                          { value: 'minimal', label: '清晰极简' },
                          { value: 'cinematic', label: '沉浸深色' },
                        ]" /></label
                    ><label
                      >画幅<UiSelect
                        v-model="content.aspect"
                        aria-label="项目画幅"
                        :options="[
                          { value: 'landscape', label: '16:9 横版' },
                          { value: 'portrait', label: '9:16 竖版' },
                          { value: 'square', label: '1:1 方形' },
                        ]" /></label
                    ><label v-if="content.creativeDirection"
                      >视觉方向<textarea
                        v-model="content.creativeDirection.design"
                        aria-label="项目视觉方向"
                        maxlength="2000"
                        rows="5"
                      /></label
                    ><label
                      >自定义 Prompt<textarea
                        v-model="content.customPrompt"
                        aria-label="项目自定义 Prompt"
                        maxlength="4000"
                        rows="5"
                        placeholder="补充这个作品的表达、配色、排版要求"
                      /></label
                    ><label
                      >主题强调色
                      <div class="accent-input">
                        <input
                          v-model="content.accent"
                          aria-label="项目强调色"
                          type="color"
                        /><span>{{ content.accent.toUpperCase() }}</span>
                      </div></label
                    >
                    <p class="field-hint">
                      项目风格会用于接下来的生成与修改。已生成页面可逐页调整。
                    </p>
                  </fieldset></template
                >
                <template v-else-if="inspector === 'check'"
                  ><div class="inspector-section-title"><span>PAGE CHECK</span></div>
                  <div class="check-intro">
                    <Icon name="check" :size="28" />
                    <h3>
                      {{
                        checked
                          ? issues.length
                            ? '发现需要留意的地方'
                            : '当前页未发现问题'
                          : '让作品更稳妥一些'
                      }}
                    </h3>
                    <p>检查当前画布的文字边界、字号、图片加载和脚本错误。</p>
                  </div>
                  <button
                    class="quiet-button check-run-button"
                    :disabled="!selected?.html || !frameReady || tab !== 'preview' || checksPending"
                    @click="check()"
                  >
                    {{ checksPending ? '正在检查…' : '检查当前页'
                    }}<Icon name="refresh" :size="14" />
                  </button>
                  <ul v-if="checked && issues.length" class="check-issues">
                    <li v-for="(issue, index) in issues" :key="index" :class="issue.level">
                      {{ issue.message }}
                    </li>
                  </ul>
                  <p class="field-hint">
                    检查结果用于发现技术问题；内容准确性、视觉效果和交互仍需预览确认。
                  </p></template
                >
                <div v-else class="inspector-placeholder">
                  <Icon name="book" :size="24" />
                  <p>分镜就绪后，在这里打磨每一页。</p>
                </div>
              </div>
            </aside>
          </main>
        </aside>
        <EmptyState
          v-else-if="page === 'works'"
          class="works-empty"
          label="作品空状态"
          :title="worksEmptyState.title"
          :description="worksEmptyState.description"
          :busy="loading"
        >
          <template #actions>
            <button
              v-if="projects.length && !panels.leftOpen.value"
              class="quiet-button"
              @click="panels.leftOpen.value = true"
            >
              <Icon name="panel-left" :size="16" />打开作品列表
            </button>
            <button class="quiet-button" :disabled="busy" @click="newConversation()">
              <Icon name="spark" :size="16" />新建创作
            </button>
          </template>
        </EmptyState>
      </div>
    </div>
  </div>
</template>
<style scoped lang="less" src="./style.less"></style>
<style scoped lang="less" src="./panels.less"></style>
