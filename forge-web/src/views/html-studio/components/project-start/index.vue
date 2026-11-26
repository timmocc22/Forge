<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CreateHtmlProject } from '@studio/contracts';
import { UiSelect } from '@studio/ui';
import Icon from '../../../../components/icon/index.vue';
import SendButton from '../../../../components/send-button/index.vue';
import EmptyState from '../../../../components/empty-state/index.vue';
import ModelSelector from '../../../../components/model-selector/index.vue';
import CustomPrompt from '../custom-prompt/index.vue';
import { useCreativePreferencesStore } from '../../../../stores/creative-preferences';
import { useModelsStore } from '../../../../stores/models';

const props = defineProps<{
  connected: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{
  create: [input: CreateHtmlProject];
  error: [message: string];
}>();
const models = useModelsStore();
const preferences = useCreativePreferencesStore();
const brief = ref('');
const audience = ref('');
const count = ref<number | 'auto'>('auto');
const style = ref<CreateHtmlProject['style'] | 'auto'>('auto');
const aspect = ref<CreateHtmlProject['aspect'] | 'auto'>('auto');
const optionsOpen = ref(false);
const importInput = ref<HTMLInputElement>();
const canCreate = computed(() => props.connected && !props.busy && !!brief.value.trim());
const optionsSummary = computed(() =>
  count.value !== 'auto'
    ? `${count.value} 页 · ${style.value === 'auto' || aspect.value === 'auto' || !audience.value.trim() ? '其余自动' : '自定义'}`
    : style.value === 'auto' && aspect.value === 'auto' && !audience.value.trim()
      ? 'AI 决定'
      : '部分自动',
);
let pendingCreate: { fingerprint: string; id: string } | undefined;

function create(sourceHtml?: string, filename?: string) {
  if (props.busy || !props.connected || (!sourceHtml && !canCreate.value)) return;
  const input = {
    brief: sourceHtml ? (filename ?? '导入的 HTML 作品') : brief.value.trim(),
    audience: audience.value.trim() || '普通读者',
    sceneCount: count.value === 'auto' ? 5 : count.value,
    style: style.value === 'auto' ? 'editorial' : style.value,
    aspect: aspect.value === 'auto' ? 'landscape' : aspect.value,
    accent: '#e87844',
    ...(!sourceHtml
      ? {
          creativeOptions: {
            ...(audience.value.trim() ? { audience: audience.value.trim() } : {}),
            ...(count.value !== 'auto' ? { sceneCount: count.value } : {}),
            ...(style.value !== 'auto' ? { style: style.value } : {}),
            ...(aspect.value !== 'auto' ? { aspect: aspect.value } : {}),
          },
          creationContext: {
            locale: navigator.language,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        }
      : {}),
    ...(preferences.enabled && preferences.prompt.trim()
      ? { customPrompt: preferences.prompt.trim() }
      : {}),
    modelSelection: models.selectionFor('html'),
    sourceHtml,
  };
  const fingerprint = JSON.stringify(input);
  if (pendingCreate?.fingerprint !== fingerprint)
    pendingCreate = { fingerprint, id: crypto.randomUUID() };
  emit('create', { ...input, requestId: pendingCreate.id });
}
function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.altKey) return;
  event.preventDefault();
  create();
}
function resizePrompt(event: Event) {
  const field = event.target as HTMLTextAreaElement;
  field.style.height = 'auto';
  field.style.height = `${Math.min(field.scrollHeight, 240)}px`;
}
async function importHtml(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 250000) throw new Error('HTML 文件最多 250 KB');
    const html = await file.text();
    if (!/<html[\s>]/i.test(html)) throw new Error('请选择完整的 HTML 文件');
    create(html, file.name.replace(/\.html?$/i, ''));
  } catch (cause) {
    emit('error', cause instanceof Error ? cause.message : '导入失败');
  }
  input.value = '';
}
</script>

<template>
  <main class="start-landing">
    <EmptyState
      class="start-welcome"
      label="等待开始对话"
      title="让想法从这里开始"
      description="一个灵感，一段文字，都可以成为新的作品。"
    />
    <section class="start-section" aria-label="新对话">
      <div class="composer-preferences">
        <CustomPrompt :disabled="busy" />
      </div>
      <form class="start-composer" @submit.prevent="create()">
        <textarea
          v-model="brief"
          aria-label="创作主题"
          maxlength="8000"
          rows="3"
          placeholder="描述你的想法，或粘贴内容…"
          :disabled="busy"
          @keydown="handleKeydown"
          @input="resizePrompt"
        />
        <div class="composer-controls">
          <div class="composer-tools">
            <button
              type="button"
              class="attach-button"
              aria-label="导入 HTML"
              title="导入 HTML"
              :disabled="busy || !connected"
              @click="importInput?.click()"
            >
              ＋
            </button>
            <input
              ref="importInput"
              type="file"
              accept=".html,.htm,text/html"
              hidden
              @change="importHtml"
            />
            <button
              type="button"
              class="options-button"
              :aria-expanded="optionsOpen"
              aria-controls="creation-options"
              :disabled="busy"
              @click="optionsOpen = !optionsOpen"
            >
              <Icon name="settings" :size="15" /><span>创作选项</span
              ><span class="options-summary">{{ optionsSummary }}</span>
            </button>
          </div>
          <div class="composer-submit">
            <ModelSelector kind="html" />
            <SendButton
              type="submit"
              :disabled="!canCreate"
              :busy="busy"
              :aria-label="busy ? '正在创建' : '开始规划分镜'"
              :title="busy ? '正在创建…' : '开始规划分镜'"
            />
          </div>
        </div>
        <div v-show="optionsOpen" id="creation-options" class="creation-options">
          <label
            >目标读者<input
              v-model="audience"
              aria-label="目标读者"
              maxlength="300"
              placeholder="自动判断"
              :disabled="busy"
          /></label>
          <label
            >页面数<UiSelect
              v-model="count"
              aria-label="分镜页数"
              :disabled="busy"
              :options="[
                { value: 'auto', label: 'AI 决定' },
                ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1} 页` })),
              ]"
          /></label>
          <label
            >画幅<UiSelect
              v-model="aspect"
              aria-label="画幅"
              :disabled="busy"
              :options="[
                { value: 'auto', label: 'AI 决定' },
                { value: 'landscape', label: '16:9 横版' },
                { value: 'portrait', label: '9:16 竖版' },
                { value: 'square', label: '1:1 方形' },
              ]"
          /></label>
          <label
            >风格<UiSelect
              v-model="style"
              aria-label="视觉风格"
              :disabled="busy"
              :options="[
                { value: 'auto', label: 'AI 决定' },
                { value: 'editorial', label: '杂志叙事' },
                { value: 'minimal', label: '清晰极简' },
                { value: 'cinematic', label: '沉浸深色' },
              ]"
          /></label>
          <p class="creation-hint">
            自动项由 AI 结合主题、使用场景、已保存偏好与相关作品决定；手动指定的选项优先。页数支持
            1–12 页。
          </p>
        </div>
      </form>
    </section>
  </main>
</template>
<style scoped lang="less" src="./style.less"></style>
