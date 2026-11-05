<script setup lang="ts">
import GenerationOrb from '../generation-orb/index.vue';

const props = withDefaults(defineProps<{ size?: number }>(), { size: 28 });
</script>

<template>
  <span class="forge-mark" aria-hidden="true">
    <GenerationOrb class="forge-mark-orb" :size="100" />
  </span>
</template>

<style scoped>
.forge-mark {
  --forge-mark-scale: v-bind('props.size / 100');
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 1em;
  height: 1em;
  font-size: v-bind('props.size + "px"');
  pointer-events: none;
}
.forge-mark-orb {
  transform: scale(var(--forge-mark-scale));
}
</style>
