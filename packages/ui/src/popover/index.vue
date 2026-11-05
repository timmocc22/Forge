<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, provide, ref, useId, watch } from 'vue';
import { popoverPathKey } from './context';

const props = withDefaults(
  defineProps<{
    placement?: 'top-end' | 'bottom-start' | 'bottom-end';
    width?: number;
    minWidth?: number;
    matchWidth?: boolean;
    role?: 'dialog' | 'listbox' | 'menu';
    label?: string;
    labelledby?: string;
    panelId?: string;
    autoFocus?: boolean;
  }>(),
  {
    placement: 'bottom-start',
    role: 'dialog',
    autoFocus: true,
    width: 360,
    minWidth: 0,
    label: undefined,
    labelledby: undefined,
    panelId: undefined,
  },
);
const open = defineModel<boolean>('open', { default: false });
const anchor = ref<HTMLElement>();
const panel = ref<HTMLElement>();
const position = ref<Record<string, string>>({ visibility: 'hidden' });
const teleportTarget = ref<Element | string>('body');
const id = useId();
const path = [...inject(popoverPathKey, []), id];
provide(popoverPathKey, path);
const panelId = computed(() => props.panelId ?? `${id}-popup`);
let observer: ResizeObserver | undefined;

function close(restoreFocus = true) {
  open.value = false;
  if (restoreFocus) anchor.value?.querySelector<HTMLElement>('button, [tabindex]')?.focus();
}
function contains(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return (
    anchor.value?.contains(target) ||
    target
      .closest('[data-studio-popover-path]')
      ?.getAttribute('data-studio-popover-path')
      ?.split(' ')
      .includes(id)
  );
}
function onOutside(event: Event) {
  if (!contains(event.target)) close(false);
}
function onEscape(event: KeyboardEvent) {
  if (!open.value) return;
  event.preventDefault();
  event.stopPropagation();
  close();
}
function updatePosition() {
  if (!anchor.value || !panel.value) return;
  const rect = anchor.value.getBoundingClientRect();
  const margin = 12;
  const viewport = window.visualViewport;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const width = Math.min(
    props.matchWidth ? Math.max(rect.width, props.minWidth ?? 0) : (props.width ?? 360),
    viewportWidth - margin * 2,
  );
  const height = Math.min(panel.value.scrollHeight, viewportHeight - margin * 2);
  const end = props.placement.endsWith('end');
  const above = props.placement.startsWith('top');
  const roomAbove = rect.top - viewportTop - margin;
  const roomBelow = viewportTop + viewportHeight - rect.bottom - margin;
  const useAbove = above
    ? roomAbove >= height + 8 || roomAbove > roomBelow
    : roomBelow < height + 8 && roomAbove > roomBelow;
  const left = Math.max(
    viewportLeft + margin,
    Math.min(end ? rect.right - width : rect.left, viewportLeft + viewportWidth - width - margin),
  );
  const top = Math.max(
    viewportTop + margin,
    Math.min(
      useAbove ? rect.top - height - 8 : rect.bottom + 8,
      viewportTop + viewportHeight - height - margin,
    ),
  );
  position.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    maxHeight: `${viewportHeight - margin * 2}px`,
    visibility: 'visible',
  };
}
function unbind() {
  observer?.disconnect();
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('focusin', onOutside, true);
  window.removeEventListener('resize', updatePosition);
  window.removeEventListener('scroll', updatePosition, true);
  window.visualViewport?.removeEventListener('resize', updatePosition);
  window.visualViewport?.removeEventListener('scroll', updatePosition);
}
watch(open, async (value) => {
  unbind();
  if (!value) return;
  teleportTarget.value = document.fullscreenElement ?? 'body';
  position.value = { visibility: 'hidden' };
  await nextTick();
  if (!open.value || !panel.value) return;
  updatePosition();
  observer = new ResizeObserver(updatePosition);
  observer.observe(panel.value);
  if (anchor.value) observer.observe(anchor.value);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('focusin', onOutside, true);
  window.addEventListener('resize', updatePosition);
  window.addEventListener('scroll', updatePosition, true);
  window.visualViewport?.addEventListener('resize', updatePosition);
  window.visualViewport?.addEventListener('scroll', updatePosition);
  if (props.autoFocus)
    (
      panel.value.querySelector<HTMLElement>(
        '[autofocus], [role="combobox"], button:not([disabled]), input:not([disabled])',
      ) ?? panel.value
    ).focus({ preventScroll: true });
});
onBeforeUnmount(unbind);
</script>

<template>
  <span ref="anchor" class="studio-popover" @keydown.esc="onEscape">
    <slot
      name="trigger"
      :open="open"
      :toggle="() => (open = !open)"
      :close="close"
      :panel-id="panelId"
    />
    <Teleport :to="teleportTarget">
      <div
        v-if="open"
        :id="panelId"
        ref="panel"
        class="studio-popover-panel"
        :style="position"
        :role="role"
        :aria-label="label"
        :aria-labelledby="labelledby"
        :data-studio-popover-path="path.join(' ')"
        tabindex="-1"
        @keydown.esc.stop.prevent="close()"
      >
        <slot :close="close" />
      </div>
    </Teleport>
  </span>
</template>

<style scoped lang="less" src="./style.less"></style>
