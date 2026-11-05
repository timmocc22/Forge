<script setup lang="ts">
import MessageAvatar from '../message-avatar/index.vue';

withDefaults(defineProps<{ role: 'user' | 'assistant'; generating?: boolean }>(), {
  generating: false,
});
</script>

<template>
  <article
    class="chat-message"
    :class="`chat-message--${role}`"
    :aria-label="role === 'user' ? '你的消息' : 'AI 的消息'"
    :aria-busy="generating"
  >
    <MessageAvatar :role="role" :generating="generating" />
    <div class="message-content">
      <div class="message-body"><slot /></div>
    </div>
  </article>
</template>

<style scoped lang="less">
.chat-message {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  margin: 0 0 28px;
  color: var(--text);
}
.message-content {
  min-width: 0;
  max-width: calc(100% - 44px);
  flex: 1;
}
.message-body {
  min-width: 0;
  font-size: 14px;
  line-height: 1.9;
  overflow-wrap: anywhere;
  :deep(> p) {
    margin: 0;
    white-space: pre-wrap;
  }
}
.chat-message--user {
  flex-direction: row-reverse;
  .message-content {
    flex: 0 1 auto;
    max-width: min(85%, calc(100% - 44px));
  }
  .message-body {
    padding: 12px 16px;
    border-radius: 16px 4px 16px 16px;
    background: var(--message);
  }
}
@media (max-width: 600px) {
  .chat-message {
    gap: 8px;
  }
  .message-content,
  .chat-message--user .message-content {
    max-width: calc(100% - 36px);
  }
}
</style>
