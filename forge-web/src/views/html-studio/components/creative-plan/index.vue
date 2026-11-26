<script setup lang="ts">
import type { HtmlProjectContent } from '@studio/contracts';
defineProps<{ content: HtmlProjectContent }>();
const styles = { editorial: '杂志叙事', minimal: '清晰极简', cinematic: '沉浸深色' };
const aspects = { landscape: '16:9 横版', portrait: '9:16 竖版', square: '1:1 方形' };
</script>

<template>
  <section v-if="content.creativeDirection" class="creative-plan" aria-label="创作方案">
    <strong
      >创作方案 · {{ content.scenes.length }} 页 · {{ aspects[content.aspect] }} ·
      {{ styles[content.style] }}</strong
    >
    <p>面向 {{ content.audience }}</p>
    <p>{{ content.creativeDirection.design }}</p>
    <details>
      <summary>查看规划理由</summary>
      <p>{{ content.creativeDirection.rationale }}</p>
    </details>
    <small>可以继续在对话中补充要求，或在作品的项目风格中调整视觉方向。</small>
  </section>
</template>

<style scoped lang="less">
.creative-plan {
  margin: 14px 0 20px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
  overflow-wrap: anywhere;
  strong {
    color: var(--text);
    font-weight: 500;
  }
  p {
    margin: 6px 0;
    white-space: pre-line;
  }
  summary {
    cursor: pointer;
  }
  small {
    display: block;
    margin-top: 8px;
    color: var(--subtle);
  }
}
</style>
