<script setup lang="ts">
withDefaults(defineProps<{ role: 'user' | 'assistant'; generating?: boolean }>(), {
  generating: false,
});
</script>

<template>
  <!-- Uiverse dexter-st / bright-lizard-8 and Shoh2008 / clever-goose-73 (MIT).
       See public/third-party-licenses.txt. -->
  <span
    class="message-avatar"
    :class="[`message-avatar--${role}`, { 'is-generating': generating }]"
    aria-hidden="true"
  >
    <span v-if="role === 'assistant'" class="ai-orb" />
    <span v-else class="user-pulse" />
  </span>
</template>

<style scoped lang="less">
.message-avatar {
  display: grid;
  place-items: center;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  isolation: isolate;
  pointer-events: none;
}
.ai-orb {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: #171222;
  transform: rotate(90deg);
  box-shadow:
    0 1.78px 3.56px 0 #fff inset,
    0 3.56px 5.33px 0 #ad5fff inset,
    0 10.67px 10.67px 0 #471eec inset;
}
.is-generating .ai-orb {
  animation: avatar-orbit 2s linear infinite;
}
@keyframes avatar-orbit {
  0% {
    transform: rotate(90deg);
    box-shadow:
      0 1.78px 3.56px 0 #fff inset,
      0 3.56px 5.33px 0 #ad5fff inset,
      0 10.67px 10.67px 0 #471eec inset;
  }
  50% {
    transform: rotate(270deg);
    box-shadow:
      0 1.78px 3.56px 0 #fff inset,
      0 3.56px 1.78px 0 #d60a47 inset,
      0 7.11px 10.67px 0 #311e80 inset;
  }
  100% {
    transform: rotate(450deg);
    box-shadow:
      0 1.78px 3.56px 0 #fff inset,
      0 3.56px 5.33px 0 #ad5fff inset,
      0 10.67px 10.67px 0 #471eec inset;
  }
}
.user-pulse {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: var(--text);
  &::before,
  &::after {
    content: '';
    position: absolute;
    border-radius: 50%;
    filter: drop-shadow(0 0 3px var(--muted));
    animation: avatar-pulse-out 1.8s ease-in-out infinite;
  }
  &::before {
    width: 100%;
    height: 100%;
    box-shadow: inset 0 0 0 5.33px currentColor;
    animation-name: avatar-pulse-in;
  }
  &::after {
    width: calc(100% - 10.66px);
    height: calc(100% - 10.66px);
    box-shadow: 0 0 0 0 currentColor;
  }
}
@keyframes avatar-pulse-in {
  0% {
    box-shadow: inset 0 0 0 5.33px currentColor;
    opacity: 1;
  }
  50%,
  100% {
    box-shadow: inset 0 0 0 0 currentColor;
    opacity: 0;
  }
}
@keyframes avatar-pulse-out {
  0%,
  50% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 5.33px currentColor;
    opacity: 1;
  }
}
@media (max-width: 600px) {
  .message-avatar {
    flex-basis: 28px;
    width: 28px;
    height: 28px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .is-generating .ai-orb,
  .user-pulse::before,
  .user-pulse::after {
    animation: none;
  }
  .user-pulse::after {
    display: none;
  }
}
</style>
