<script setup lang="ts">
import ForgeMark from '../forge-mark/index.vue';

withDefaults(
  defineProps<{
    title: string;
    description?: string;
    label?: string;
    busy?: boolean;
  }>(),
  { description: '', label: undefined, busy: false },
);
</script>

<template>
  <div class="empty-state" role="status" :aria-label="label || title" :aria-busy="busy">
    <div class="empty-state-illustration" aria-hidden="true">
      <slot name="illustration"><ForgeMark :size="72" /></slot>
    </div>
    <h2>{{ title }}</h2>
    <p v-if="description">{{ description }}</p>
    <div v-if="$slots.actions && !busy" class="empty-state-actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped lang="less" src="./style.less"></style>
