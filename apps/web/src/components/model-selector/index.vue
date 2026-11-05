<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import type { GenerationKind, ModelSelection, ReasoningEffort } from '@studio/contracts';
import { modelIdSchema } from '@studio/contracts';
import { UiPopover, UiSelect, type SelectOption } from '@studio/ui';
import { useModelsStore } from '../../stores/models';
import Icon from '../icon/index.vue';

const props = withDefaults(defineProps<{ kind: GenerationKind; label?: string }>(), {
  label: '切换服务商和模型',
});
const models = useModelsStore();
const opened = ref(false);
const headingId = useId();
const provider = ref<ModelSelection['provider']>('demo');
const model = ref('');
const customModel = ref('');
const reasoningEffort = ref<ReasoningEffort>('high');
const error = ref('');
const capability = computed(() => models.capabilityFor(props.kind, provider.value));
const reasoningOptions = computed<SelectOption<ReasoningEffort>[]>(() =>
  (capability.value?.reasoningEfforts ?? []).map((value) => ({
    value,
    label: { low: '低（low）', high: '高（high）', max: '最高（max）' }[value],
  })),
);
const providerOptions = computed<SelectOption<ModelSelection['provider']>[]>(() =>
  (models.catalog?.providers ?? []).map((item) => ({
    value: item.id,
    label: item.name,
    disabled: !models.capabilityFor(props.kind, item.id)?.available,
    description: models.capabilityFor(props.kind, item.id)?.unavailableReason,
  })),
);
const modelOptions = computed<SelectOption<string>[]>(() => [
  ...(capability.value?.models ?? []).map((name) => ({
    value: name,
    label: name === 'local-sample' ? '本地演示样例' : name,
  })),
  ...(provider.value === 'demo' ? [] : [{ value: '__custom__', label: '自定义模型…' }]),
]);
const selectedModel = computed(() =>
  model.value === '__custom__' ? customModel.value.trim() : model.value,
);
const canApply = computed(
  () => capability.value?.available && modelIdSchema.safeParse(selectedModel.value).success,
);
const unavailable = computed(() =>
  providerOptions.value.flatMap((item) =>
    item.description ? [`${item.label}：${item.description}`] : [],
  ),
);

function chooseProvider() {
  model.value = capability.value?.defaultModel ?? '__custom__';
  customModel.value = '';
  reasoningEffort.value = capability.value?.defaultReasoningEffort ?? 'high';
  error.value = '';
}
function open() {
  if (opened.value) {
    opened.value = false;
    return;
  }
  const selection = models.selectionFor(props.kind);
  provider.value = selection?.provider ?? models.catalog?.defaultProvider ?? 'demo';
  const known = capability.value?.models.includes(selection?.model ?? '');
  model.value = known
    ? selection!.model
    : selection
      ? '__custom__'
      : (capability.value?.defaultModel ?? '__custom__');
  customModel.value = selection && !known ? selection.model : '';
  reasoningEffort.value =
    selection?.reasoningEffort ?? capability.value?.defaultReasoningEffort ?? 'high';
  error.value = '';
  opened.value = true;
}
function apply(close: () => void) {
  if (!canApply.value) return;
  try {
    models.select(props.kind, {
      provider: provider.value,
      model: selectedModel.value,
      ...(reasoningOptions.value.length ? { reasoningEffort: reasoningEffort.value } : {}),
    });
    close();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '模型切换失败';
  }
}
</script>

<template>
  <UiPopover
    v-model:open="opened"
    placement="top-end"
    :width="360"
    role="dialog"
    :labelledby="headingId"
  >
    <template #trigger="{ panelId }">
      <button
        type="button"
        class="model-trigger"
        :aria-label="label"
        :title="models.labelFor(kind)"
        aria-haspopup="dialog"
        :aria-expanded="opened"
        :aria-controls="panelId"
        @click="open"
      >
        <Icon name="spark" :size="14" />
        <span>{{ models.labelFor(kind) }}</span>
        <Icon name="chevron" :size="13" />
      </button>
    </template>
    <template #default="{ close }">
      <form class="model-panel" @submit.prevent="apply(close)">
        <header>
          <div>
            <h2 :id="headingId">服务商与模型</h2>
            <p>HTML 创作 · 用于下次创作</p>
          </div>
          <button type="button" class="icon-button" aria-label="关闭模型选择" @click="close()">
            <Icon name="close" :size="16" />
          </button>
        </header>
        <template v-if="models.catalog">
          <div class="model-field">
            <label :for="`${headingId}-provider`">服务商</label>
            <UiSelect
              :id="`${headingId}-provider`"
              v-model="provider"
              aria-label="服务商"
              :options="providerOptions"
              @change="chooseProvider"
            />
          </div>
          <div class="model-field">
            <label :for="`${headingId}-model`">模型</label>
            <UiSelect
              :id="`${headingId}-model`"
              v-model="model"
              aria-label="模型"
              :options="modelOptions"
              :disabled="!capability?.available"
            />
          </div>
          <div v-if="model === '__custom__' && provider !== 'demo'" class="model-field">
            <label :for="`${headingId}-custom`">自定义模型名称</label>
            <input
              :id="`${headingId}-custom`"
              v-model="customModel"
              type="text"
              maxlength="200"
              placeholder="输入账户可用的模型 ID"
              autocomplete="off"
              spellcheck="false"
              :disabled="!capability?.available"
            />
          </div>
          <div v-if="reasoningOptions.length" class="model-field">
            <label :for="`${headingId}-reasoning`">思考等级</label>
            <UiSelect
              :id="`${headingId}-reasoning`"
              v-model="reasoningEffort"
              aria-label="思考等级"
              :options="reasoningOptions"
              :disabled="!capability?.available"
            />
            <p class="model-hint">等级越高，思考通常更充分，耗时和用量也可能增加。</p>
          </div>
          <p class="model-hint">文本模型用于分镜规划和 HTML 页面生成，结构化结果会经过格式校验。</p>
          <ul v-if="unavailable.length" class="model-availability">
            <li v-for="reason in unavailable" :key="reason">{{ reason }}</li>
          </ul>
          <p class="model-hint">模型选择用于后续生成；重试沿用当前任务的模型。</p>
        </template>
        <p v-else class="model-hint">暂未连接本地服务，请点击“重新连接”。</p>
        <p v-if="error" class="model-error" role="alert">{{ error }}</p>
        <footer>
          <button type="button" class="secondary-button" @click="close()">取消</button
          ><button type="submit" class="primary-button" :disabled="!canApply">应用选择</button>
        </footer>
      </form>
    </template>
  </UiPopover>
</template>
<style scoped lang="less" src="./style.less"></style>
