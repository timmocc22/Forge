<script setup lang="ts">
withDefaults(defineProps<{ busy?: boolean; disabled?: boolean }>(), {
  busy: false,
  disabled: false,
});
</script>

<template>
  <button type="button" class="send-button" :aria-busy="busy" :disabled="disabled || busy">
    <svg class="send-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path v-if="busy" d="M12 3a9 9 0 1 0 9 9M12 7v5l3 2" />
      <path v-else d="M12 20V4M5 11l7-7 7 7" />
    </svg>
    <span class="send-label" aria-hidden="true">{{ busy ? '创建中' : '发送' }}</span>
  </button>
</template>

<style scoped lang="less" src="./style.less"></style>
