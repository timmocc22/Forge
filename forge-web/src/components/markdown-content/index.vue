<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from './render';
const props = defineProps<{ content: string; legacyTask?: boolean }>();
const html = computed(() => renderMarkdown(props.content, props.legacyTask));
</script>

<template>
  <!-- Raw HTML is disabled in the parser; only Markdown-generated tags reach this sink. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="markdown-content" v-html="html" />
</template>

<style scoped lang="less">
.markdown-content {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
  line-height: 1.75;
  :deep(> :first-child) {
    margin-top: 0;
  }
  :deep(> :last-child) {
    margin-bottom: 0;
  }
  :deep(p) {
    margin: 0.65em 0;
    white-space: normal;
  }
  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin: 1.1em 0 0.45em;
    color: var(--text);
    line-height: 1.45;
    font-weight: 650;
  }
  :deep(h1) {
    font-size: 1.35em;
  }
  :deep(h2) {
    font-size: 1.2em;
  }
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    font-size: 1.05em;
  }
  :deep(ul),
  :deep(ol) {
    padding-left: 1.65em;
    margin: 0.65em 0;
  }
  :deep(li) {
    padding: 0;
    margin: 0.3em 0;
  }
  :deep(li > p) {
    margin: 0.25em 0;
  }
  :deep(strong) {
    color: var(--text);
    font-weight: 650;
  }
  :deep(blockquote) {
    margin: 0.8em 0;
    padding: 0.1em 1em;
    border-left: 3px solid var(--control-border);
    color: var(--muted);
  }
  :deep(code) {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 0.9em;
    padding: 0.1em 0.3em;
    border-radius: 4px;
    background: var(--field);
  }
  :deep(pre) {
    max-width: 100%;
    overflow-x: auto;
    margin: 0.8em 0;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--field);
    white-space: pre;
  }
  :deep(pre code) {
    padding: 0;
    background: transparent;
    white-space: pre;
  }
  :deep(a) {
    color: var(--focus);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  :deep(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
    margin: 0.8em 0;
  }
  :deep(th),
  :deep(td) {
    padding: 6px 10px;
    border: 1px solid var(--border);
    text-align: left;
  }
  :deep(th) {
    background: var(--field);
  }
  :deep(hr) {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 1em 0;
  }
}
</style>
