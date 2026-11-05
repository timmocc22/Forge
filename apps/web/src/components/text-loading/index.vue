<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: '正在处理消息…' });
</script>

<template>
  <!-- Adapted from dexter-st / wicked-elephant-4 (MIT). See third-party-licenses.txt. -->
  <span class="text-loading" role="status" :aria-label="label">
    <span class="text-loading-spectrum" aria-hidden="true" />
  </span>
</template>

<style scoped lang="less" src="./style.less"></style>
