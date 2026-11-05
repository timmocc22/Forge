<script setup lang="ts">
import Icon from '../../../../components/icon/index.vue';

defineProps<{ title: string; detail: string; actionLabel: string; disabled?: boolean }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="reply-failure">
    <div class="reply-failure-row">
      <Icon name="warning" :size="15" />
      <span role="status">{{ title }}</span>
      <button type="button" :disabled="disabled" @click="$emit('retry')">
        <Icon name="refresh" :size="14" />{{ actionLabel }}
      </button>
    </div>
    <details class="reply-failure-detail">
      <summary>查看详情</summary>
      <p>{{ detail }}</p>
    </details>
  </div>
</template>

<style scoped lang="less">
.reply-failure {
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}
.reply-failure-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  > svg {
    flex-shrink: 0;
    color: var(--error-text);
  }
  > span {
    flex: 1;
    min-width: 100px;
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 32px;
    padding: 5px 10px;
    border: 1px solid var(--control-border);
    border-radius: 8px;
    background: var(--background);
    color: var(--text);
    font-size: 12px;
    white-space: nowrap;
    &:hover:not(:disabled) {
      background: var(--hover);
    }
  }
}
.reply-failure-detail {
  margin: 2px 0 0 23px;
  color: var(--subtle);
  font-size: 11px;
  summary {
    width: fit-content;
    padding: 3px 0;
    cursor: pointer;
    &:hover {
      color: var(--text);
    }
    &:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 3px;
      border-radius: 2px;
    }
  }
  p {
    margin: 6px 0 2px;
    color: var(--muted);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}
@media (pointer: coarse) {
  .reply-failure-row button {
    min-height: 44px;
  }
  .reply-failure-detail summary {
    min-height: 32px;
  }
}
</style>
