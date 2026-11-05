<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import Icon from '../../../../components/icon/index.vue';
import { useCreativePreferencesStore } from '../../../../stores/creative-preferences';

defineProps<{ disabled: boolean }>();
const preferences = useCreativePreferencesStore();
const dialog = ref<HTMLDialogElement>();
const field = ref<HTMLTextAreaElement>();
const draft = ref('');
const enabled = ref(true);
const error = ref('');
const headingId = useId();
const active = computed(() => preferences.enabled && !!preferences.prompt);
const examples = [
  {
    label: '教学讲解',
    text: '面向初学者，用生活中的例子解释概念，先给直觉，再逐步推导。每页聚焦一个知识点，结尾加入一道思考题。',
  },
  {
    label: '品牌视觉',
    text: '使用暖白底色、深灰文字和少量橙色强调。标题醒目，留白充足，避免大面积渐变和重复卡片。',
  },
  {
    label: '商业汇报',
    text: '结论先行，标题直接表达观点。明确区分事实、假设和建议；没有来源的数据不要编造。',
  },
  {
    label: '故事表达',
    text: '围绕一个具体人物或场景展开，用问题、转折和行动串联各页，语言自然、有画面感。',
  },
];
function open() {
  draft.value = preferences.prompt;
  enabled.value = preferences.enabled;
  error.value = '';
  dialog.value?.showModal();
  field.value?.focus();
}
function append(text: string) {
  const next = [draft.value.trim(), text].filter(Boolean).join('\n\n');
  if (next.length > 4000) {
    error.value = '内容已接近上限，请先精简后再添加示例。';
    return;
  }
  draft.value = next;
  error.value = '';
}
function save() {
  try {
    preferences.save(draft.value, enabled.value);
    dialog.value?.close();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败，请重试。';
  }
}
</script>

<template>
  <button
    type="button"
    class="prompt-trigger"
    :class="{ 'is-active': active }"
    :disabled="disabled"
    aria-haspopup="dialog"
    :title="active ? preferences.prompt : '设置并保存你的个人创作偏好'"
    @click="open"
  >
    <Icon name="spark" :size="15" />
    <span>我的 Prompt</span>
    <span v-if="preferences.prompt" class="prompt-state">{{ active ? '已启用' : '已停用' }}</span>
  </button>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="prompt-dialog"
      :aria-labelledby="headingId"
      @click="$event.target === dialog && dialog?.close()"
    >
      <form @submit.prevent="save">
        <header>
          <div>
            <h2 :id="headingId">我的创作 Prompt</h2>
            <p>让每次创作，都带有你的习惯与风格。</p>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="关闭自定义 Prompt"
            @click="dialog?.close()"
          >
            <Icon name="close" :size="18" />
          </button>
        </header>
        <label class="prompt-label" :for="`${headingId}-input`">你希望如何创作？</label>
        <textarea
          :id="`${headingId}-input`"
          ref="field"
          v-model="draft"
          aria-label="自定义 Prompt"
          maxlength="4000"
          rows="8"
          placeholder="例如：我是小学科学老师。请用孩子能理解的语言，搭配生活化例子。偏好暖色、简洁插画和大字号，每页只讲一个重点。"
        />
        <div class="prompt-meta">
          <span>表达方式 · 配色排版 · 内容要求</span><span>{{ draft.length }} / 4000</span>
        </div>
        <div class="prompt-examples">
          <span>从示例开始，点击追加</span>
          <div>
            <button
              v-for="example in examples"
              :key="example.label"
              type="button"
              @click="append(example.text)"
            >
              {{ example.label }} ＋
            </button>
          </div>
        </div>
        <label class="prompt-toggle"
          ><input v-model="enabled" type="checkbox" />新作品自动使用我的 Prompt</label
        >
        <p class="prompt-hint">
          保存在当前浏览器或桌面应用中。启用后随新作品保存，用于分镜规划、页面生成和后续修改；已有作品保持原来的要求。
        </p>
        <p v-if="error" class="prompt-error" role="alert">{{ error }}</p>
        <footer>
          <button type="button" class="clear-button" :disabled="!draft" @click="draft = ''">
            清空内容
          </button>
          <div>
            <button type="button" class="secondary-button" @click="dialog?.close()">取消</button
            ><button type="submit" class="primary-button">保存偏好</button>
          </div>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>
<style scoped lang="less" src="./style.less"></style>
