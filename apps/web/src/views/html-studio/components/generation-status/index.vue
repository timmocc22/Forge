<script setup lang="ts">
import { computed } from 'vue';
import type { HtmlProject } from '@studio/contracts';
import GenerationOrb from '../../../../components/generation-orb/index.vue';

const props = defineProps<{
  run: NonNullable<HtmlProject['run']>;
  compact?: boolean;
  sceneTitle?: string;
}>();
const planning = computed(() => props.run.action === 'plan');
const heading = computed(() =>
  planning.value
    ? '正在规划分镜'
    : props.run.action === 'scene'
      ? '正在打磨当前页'
      : '正在生成页面',
);
const progress = computed(() =>
  props.run.total ? Math.min(100, (props.run.completed / props.run.total) * 100) : 0,
);
</script>

<template>
  <section
    class="generation-status"
    :class="{ compact }"
    :aria-label="compact ? '生成状态' : '生成动画'"
  >
    <template v-if="compact">
      <GenerationOrb :size="28" />
      <div class="generation-caption" role="status">
        <strong>{{ heading }}</strong>
        <span>{{ run.message }}</span>
      </div>
      <span v-if="!planning" class="generation-count">{{ run.completed }} / {{ run.total }}</span>
    </template>
    <template v-else>
      <div class="generation-visual" aria-hidden="true"><GenerationOrb :size="112" /></div>
      <div class="generation-copy">
        <span class="generation-label"><i />生成中</span>
        <h2>{{ heading }}</h2>
        <p>{{ sceneTitle || run.message }}</p>
      </div>
      <div class="generation-meter" :class="{ indeterminate: planning }" aria-hidden="true">
        <span :style="{ width: `${progress}%` }" />
      </div>
      <span class="generation-detail">{{
        planning ? '正在组织内容与页面结构' : `已完成 ${run.completed} / ${run.total} 页`
      }}</span>
    </template>
  </section>
</template>

<style scoped lang="less" src="./style.less"></style>
