<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, ref, useId, watch } from 'vue';
import UiPopover from '../popover/index.vue';
import type { SelectOption } from './options';
defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{
    options: readonly SelectOption<T>[];
    id?: string;
    ariaLabel?: string;
    disabled?: boolean;
    placeholder?: string;
  }>(),
  { placeholder: '请选择', id: undefined, ariaLabel: undefined },
);
const value = defineModel<T>({ required: true });
const emit = defineEmits<{ change: [value: T] }>();
const open = ref(false);
const active = ref(-1);
const uid = useId();
const labelId = `${uid}-label`;
const selected = computed(() => props.options.find((option) => option.value === value.value));
let search = '';
let searchedAt = 0;

function scrollActive() {
  void nextTick(() =>
    document.getElementById(`${uid}-option-${active.value}`)?.scrollIntoView({ block: 'nearest' }),
  );
}
function show() {
  if (props.disabled) return;
  active.value = props.options.findIndex(
    (option) => option.value === value.value && !option.disabled,
  );
  if (active.value < 0) active.value = props.options.findIndex((option) => !option.disabled);
  open.value = true;
  scrollActive();
}
function choose(index: number, close: () => void) {
  const option = props.options[index];
  if (!option || option.disabled) return;
  value.value = option.value;
  emit('change', option.value);
  close();
}
function onKeydown(event: KeyboardEvent, close: () => void) {
  if (event.isComposing || props.disabled) return;
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    if (!open.value) {
      show();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      choose(active.value, close);
      return;
    }
    const enabled = props.options
      .map((option, index) => (option.disabled ? -1 : index))
      .filter((index) => index >= 0);
    const position = enabled.indexOf(active.value);
    active.value =
      event.key === 'Home'
        ? (enabled[0] ?? -1)
        : event.key === 'End'
          ? (enabled.at(-1) ?? -1)
          : (enabled[
              (position + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length
            ] ?? -1);
    scrollActive();
  } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (!open.value) show();
    search = Date.now() - searchedAt > 700 ? event.key : search + event.key;
    searchedAt = Date.now();
    const match = props.options.findIndex(
      (option) =>
        !option.disabled && option.label.toLocaleLowerCase().startsWith(search.toLocaleLowerCase()),
    );
    if (match >= 0) {
      active.value = match;
      scrollActive();
    }
  }
}
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) open.value = false;
  },
);
</script>

<template>
  <UiPopover
    v-model:open="open"
    class="studio-select"
    match-width
    :min-width="160"
    role="listbox"
    :label="ariaLabel"
    :labelledby="ariaLabel ? undefined : labelId"
    :auto-focus="false"
  >
    <template #trigger="{ close, panelId }">
      <button
        v-bind="$attrs"
        :id="props.id"
        type="button"
        class="studio-select-trigger"
        role="combobox"
        :disabled="disabled"
        :aria-label="ariaLabel"
        :aria-labelledby="ariaLabel ? undefined : labelId"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :aria-controls="panelId"
        :aria-activedescendant="open && active >= 0 ? `${uid}-option-${active}` : undefined"
        @click="open ? close() : show()"
        @keydown="onKeydown($event, close)"
      >
        <slot name="value" :selected="selected" :open="open">
          <span :id="labelId">{{ selected?.label ?? placeholder }}</span>
        </slot>
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
          <path
            d="m6 8 4 4 4-4"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </template>
    <template #default="{ close }">
      <div class="studio-select-options" @keydown="onKeydown($event, close)">
        <button
          v-for="(option, index) in options"
          :id="`${uid}-option-${index}`"
          :key="option.value"
          type="button"
          role="option"
          tabindex="-1"
          class="studio-select-option"
          :class="{ highlighted: index === active, selected: option.value === value }"
          :aria-label="option.label"
          :aria-selected="option.value === value"
          :aria-disabled="option.disabled || undefined"
          :disabled="option.disabled"
          @pointermove="!option.disabled && (active = index)"
          @click="choose(index, close)"
        >
          <span
            ><span>{{ option.label }}</span
            ><small v-if="option.description">{{ option.description }}</small></span
          >
          <svg
            v-if="option.value === value"
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m4 10 4 4 8-8"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </template>
  </UiPopover>
</template>

<style scoped lang="less" src="./style.less"></style>
