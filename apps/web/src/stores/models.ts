import { ref } from 'vue';
import { defineStore } from 'pinia';
import {
  modelSelectionSchema,
  providerCatalogSchema,
  type GenerationKind,
  type ModelSelection,
  type ProviderCatalog,
} from '@studio/contracts';
import { providerApi } from '../services/api';

const storageKey = 'studio.models';
type Selections = ProviderCatalog['defaults'];
function readSelections(): Selections {
  try {
    return providerCatalogSchema.shape.defaults.parse(
      JSON.parse(localStorage.getItem(storageKey) ?? '{}'),
    );
  } catch {
    return {};
  }
}

export const useModelsStore = defineStore('models', () => {
  const catalog = ref<ProviderCatalog>();
  const selections = ref(readSelections());

  async function refresh() {
    catalog.value = await providerApi.catalog();
  }
  function selectionFor(kind: GenerationKind) {
    const selection = selections.value[kind] ?? catalog.value?.defaults[kind];
    if (!selection) return;
    const reasoningEffort =
      selection.reasoningEffort ?? capabilityFor(kind, selection.provider)?.defaultReasoningEffort;
    return { ...selection, ...(reasoningEffort ? { reasoningEffort } : {}) };
  }
  function capabilityFor(kind: GenerationKind, provider: ModelSelection['provider']) {
    return catalog.value?.providers
      .find((item) => item.id === provider)
      ?.capabilities.find((item) => item.kind === kind);
  }
  function labelFor(kind: GenerationKind) {
    const selection = selectionFor(kind);
    if (!selection) return catalog.value ? '选择服务商与模型' : '正在连接模型服务…';
    return selection.provider === 'demo'
      ? '本地演示 · 非 AI 生成'
      : `${selection.model}${selection.reasoningEffort ? ` · ${selection.reasoningEffort}` : ''}`;
  }
  function validate(kind: GenerationKind, selection: ModelSelection | undefined) {
    if (!catalog.value) throw new Error('请先连接本地服务，再选择模型');
    if (!selection) throw new Error('请先选择服务商与模型');
    const parsed = modelSelectionSchema.parse(selection);
    const capability = capabilityFor(kind, parsed.provider);
    if (!capability?.available) throw new Error(capability?.unavailableReason ?? '服务商不可用');
    if (parsed.provider === 'demo' && parsed.model !== 'local-sample')
      throw new Error('本地演示仅支持 local-sample');
    if (parsed.reasoningEffort && !capability.reasoningEfforts?.includes(parsed.reasoningEffort))
      throw new Error('当前服务商不支持该思考等级');
    return parsed;
  }
  function select(kind: GenerationKind, selection: ModelSelection) {
    selections.value = { ...selections.value, [kind]: validate(kind, selection) };
    try {
      localStorage.setItem(storageKey, JSON.stringify(selections.value));
    } catch {
      /* The choice still applies for this session when storage is unavailable. */
    }
  }
  return { catalog, refresh, selectionFor, capabilityFor, labelFor, select };
});
