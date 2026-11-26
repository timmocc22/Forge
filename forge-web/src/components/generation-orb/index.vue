<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue';
withDefaults(defineProps<{ size?: number }>(), { size: 100 });
const id = useId();
const maskId = `generation-lava-${id}`;
const gradientId = `generation-colors-${id}`;
const blurId = `generation-blur-${id}`;
const contrastId = `generation-contrast-${id}`;
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const animated = ref(!motionPreference.matches);
const updateMotion = (event: MediaQueryListEvent) => {
  animated.value = !event.matches;
};
onMounted(() => motionPreference.addEventListener('change', updateMotion));
onBeforeUnmount(() => motionPreference.removeEventListener('change', updateMotion));
const contrastMatrix = (contrast: number) => {
  const offset = (1 - contrast) / 2;
  return `${contrast} 0 0 0 ${offset} 0 ${contrast} 0 0 ${offset} 0 0 ${contrast} 0 ${offset} 0 0 0 1 0`;
};
const contrastFrames = [15, 3, 3, 15, 15].map(contrastMatrix).join(';');
</script>

<template>
  <!-- Adapted from andrew-manzyk / young-walrus-64 (MIT). See third-party-licenses.txt. -->
  <span
    class="generation-orb"
    :style="{ width: `${size}px`, height: `${size}px`, '--size': size / 100 }"
    aria-hidden="true"
  >
    <span class="loader">
      <svg width="100" height="100" viewBox="0 0 100 100" focusable="false">
        <defs>
          <filter
            :id="blurId"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            color-interpolation-filters="sRGB"
          >
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter
            :id="contrastId"
            x="0"
            y="0"
            width="100"
            height="100"
            filterUnits="userSpaceOnUse"
            color-interpolation-filters="sRGB"
          >
            <feColorMatrix type="matrix" :values="contrastMatrix(15)">
              <animate
                v-if="animated"
                attributeName="values"
                :values="contrastFrames"
                keyTimes="0;0.2;0.4;0.6;1"
                dur="1s"
                repeatCount="indefinite"
              />
            </feColorMatrix>
          </filter>
          <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="30%" stop-color="var(--color-one)" />
            <stop offset="70%" stop-color="var(--color-two)" />
          </linearGradient>
          <!-- Keep the mask and its fill in one SVG for WebKit and scaled instances. -->
          <mask
            :id="maskId"
            x="0"
            y="0"
            width="100"
            height="100"
            maskUnits="userSpaceOnUse"
            mask-type="luminance"
          >
            <g class="lava-mask" :filter="`url(#${contrastId})`">
              <polygon points="0,0 100,0 100,100 0,100" fill="black" :filter="`url(#${blurId})`" />
              <polygon
                class="lava-shape"
                points="25,25 75,25 50,75"
                fill="white"
                :filter="`url(#${blurId})`"
              />
              <polygon
                class="lava-shape"
                points="50,25 75,75 25,75"
                fill="white"
                :filter="`url(#${blurId})`"
              />
              <polygon
                class="lava-shape"
                points="35,35 65,35 50,65"
                fill="white"
                :filter="`url(#${blurId})`"
              />
              <polygon
                class="lava-shape"
                points="35,35 65,35 50,65"
                fill="white"
                :filter="`url(#${blurId})`"
              />
              <polygon
                class="lava-shape"
                points="35,35 65,35 50,65"
                fill="white"
                :filter="`url(#${blurId})`"
              />
              <polygon
                class="lava-shape"
                points="35,35 65,35 50,65"
                fill="white"
                :filter="`url(#${blurId})`"
              />
            </g>
          </mask>
        </defs>
        <rect
          class="lava-fill"
          width="100"
          height="100"
          :fill="`url(#${gradientId})`"
          :mask="`url(#${maskId})`"
        />
      </svg>
    </span>
  </span>
</template>

<style scoped lang="less" src="./style.less"></style>
