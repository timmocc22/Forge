<script setup lang="ts">
import { computed } from 'vue';
import type { MultiStepTask } from '@studio/contracts';
import Icon from '../../../../components/icon/index.vue';
import MarkdownContent from '../../../../components/markdown-content/index.vue';
const props = defineProps<{ task: MultiStepTask; interrupted?: boolean; incremental?: boolean }>();
const updatedCount = computed(
  () => props.task.steps.filter((step) => step.status === 'succeeded').length,
);
const phases = {
  planning: '正在制定计划',
  executing: '正在逐页执行',
  checking: '正在检查页面结构',
  completed: '全部步骤已保存',
};
const statuses = {
  pending: '待执行',
  running: '执行中',
  succeeded: '已处理',
  unchanged: '无需变更',
};
</script>

<template>
  <section
    v-if="task.phase === 'completed' && !interrupted && !incremental"
    class="task-result"
    aria-label="多步任务进度"
    aria-live="polite"
  >
    <div class="result-heading">
      <span class="result-check"><Icon name="check" :size="18" /></span>
      <div class="result-copy">
        <strong>页面处理完成</strong>
        <p>
          已检查 {{ task.steps.length }} 页<span aria-hidden="true"> · </span
          >{{ updatedCount ? `更新 ${updatedCount} 页` : '内容无需变更' }}
        </p>
      </div>
      <span class="result-state">{{ updatedCount ? '已保存' : '已检查' }}</span>
    </div>
    <details v-if="task.steps.length" class="result-details">
      <summary><span>查看处理详情</span><Icon name="chevron" :size="14" /></summary>
      <ol>
        <li v-for="(step, index) in task.steps" :key="step.sceneId">
          <div class="result-row">
            <span class="result-number">{{ String(index + 1).padStart(2, '0') }}</span>
            <b>{{ step.title }}</b>
            <span class="result-step-state">{{
              step.status === 'unchanged' ? '无需变更' : '已更新'
            }}</span>
          </div>
          <MarkdownContent class="task-instruction" :content="step.instruction" legacy-task />
        </li>
      </ol>
    </details>
    <p class="result-note">
      {{ updatedCount ? '修改已统一保存，可一次撤销。' : '页面内容未发生变化。' }}
    </p>
  </section>
  <section v-else class="task-progress" aria-label="多步任务进度" aria-live="polite">
    <strong>{{ interrupted ? '任务已中断' : phases[task.phase] }}</strong>
    <span
      >{{ task.steps.filter((step) => ['succeeded', 'unchanged'].includes(step.status)).length }} /
      {{ task.steps.length }} 步</span
    >
    <ol v-if="task.steps.length">
      <li v-for="step in task.steps" :key="step.sceneId" :data-status="step.status">
        <div>
          <b>{{ step.title }}</b
          ><small>{{
            interrupted && step.status === 'running' ? '已中断' : statuses[step.status]
          }}</small>
        </div>
        <MarkdownContent class="task-instruction" :content="step.instruction" legacy-task />
      </li>
    </ol>
    <p v-if="task.phase !== 'completed'">
      {{
        incremental
          ? '已完成页面已保存。停止后可继续生成剩余页面。'
          : interrupted
            ? '本次修改尚未保存。重试会根据当前页面重新规划并执行。'
            : '全部步骤完成并检查后统一保存。'
      }}
    </p>
  </section>
</template>

<style scoped lang="less">
.task-result {
  margin: 16px 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--background);
  font-size: 13px;
  .result-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 18px 14px;
  }
  .result-check {
    display: grid;
    place-items: center;
    flex: 0 0 32px;
    height: 32px;
    border-radius: 50%;
    color: var(--success);
    background: color-mix(in srgb, var(--success) 10%, transparent);
  }
  .result-copy {
    flex: 1;
    min-width: 0;
    strong {
      font-size: 14px;
      font-weight: 600;
    }
    p {
      margin: 3px 0 0;
      color: var(--muted);
      font-size: 12px;
    }
  }
  .result-state {
    flex-shrink: 0;
    color: var(--success);
    font-size: 12px;
  }
  .result-details {
    margin: 0 18px;
    border-top: 1px solid var(--border);
    summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 44px;
      color: var(--muted);
      cursor: pointer;
      list-style: none;
      &::-webkit-details-marker {
        display: none;
      }
      &:hover {
        color: var(--text);
      }
      &:focus-visible {
        outline: 2px solid var(--focus);
        outline-offset: 2px;
        border-radius: 4px;
      }
    }
    &[open] summary svg {
      transform: rotate(180deg);
    }
    ol {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      padding: 12px 0;
      border-top: 1px solid var(--border);
    }
  }
  .result-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    b {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
      font-weight: 500;
    }
  }
  .result-number {
    color: var(--subtle);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .result-step-state {
    flex-shrink: 0;
    color: var(--muted);
    font-size: 11px;
  }
  .task-instruction {
    margin: 6px 0 0 26px;
    color: var(--muted);
    font-size: 12px;
  }
  .result-note {
    margin: 0;
    padding: 10px 18px;
    background: var(--surface);
    color: var(--muted);
    font-size: 12px;
  }
}
.task-progress {
  margin: 12px 0;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 13px;
  > span {
    float: right;
    opacity: 0.65;
  }
  > ol {
    margin: 14px 0;
    padding-left: 22px;
  }
  > ol > li {
    padding: 6px 0;
  }
  li > div:not(.task-instruction) {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  small {
    flex-shrink: 0;
    opacity: 0.65;
  }
  > p,
  .task-instruction {
    margin: 5px 0 0;
    color: var(--muted);
    line-height: 1.6;
  }
  [data-status='running'] b {
    color: var(--accent);
  }
}
</style>
