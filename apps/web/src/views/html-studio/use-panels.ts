import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';

const storageKey = 'forge.workspace-panels';
const defaults = { left: 240, right: 640, inspector: 240 };
type PanelSide = keyof typeof defaults;
function preferences() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    return {
      left: Number.isFinite(value.left) ? Math.max(200, Math.min(480, value.left)) : defaults.left,
      right: Number.isFinite(value.right)
        ? Math.max(360, Math.min(1400, value.right))
        : defaults.right,
      inspector: Number.isFinite(value.inspector)
        ? Math.max(240, Math.min(640, value.inspector))
        : defaults.inspector,
    };
  } catch {
    return defaults;
  }
}
export function useWorkspacePanels(
  hasConversation: () => boolean,
  preview: Ref<HTMLElement | undefined>,
) {
  const stored = preferences();
  const viewport = ref(window.innerWidth);
  const leftOpen = ref(location.hash.startsWith('#works') || window.innerWidth >= 1040);
  const rightOpen = ref(false);
  const leftSize = ref(stored.left);
  const rightSize = ref(stored.right);
  const inspectorSize = ref(stored.inspector);
  const previewWidth = ref(0);
  const rightExpanded = ref(false);
  const resizing = ref<PanelSide>();
  const narrow = computed(() => viewport.value < 1040);
  const available = computed(() => viewport.value - (viewport.value <= 700 ? 48 : 64));
  const leftMax = computed(() =>
    narrow.value
      ? Math.min(360, available.value)
      : Math.min(
          480,
          available.value - (hasConversation() ? 330 + (rightOpen.value ? 370 : 0) : 366),
        ),
  );
  const leftWidth = computed(() => Math.min(Math.max(200, leftSize.value), leftMax.value));
  const rightMax = computed(() =>
    Math.max(
      360,
      available.value -
        (leftOpen.value && !rightExpanded.value ? leftWidth.value + 6 : 0) -
        (rightExpanded.value ? 0 : 326),
    ),
  );
  const rightWidth = computed(() =>
    narrow.value
      ? available.value
      : rightExpanded.value
        ? rightMax.value
        : Math.max(360, Math.min(rightSize.value, rightMax.value)),
  );
  const leftExpanded = computed(() => leftWidth.value >= Math.min(420, leftMax.value) - 1);
  const inspectorMax = computed(() =>
    Math.max(0, Math.min(640, previewWidth.value - (previewWidth.value > 620 ? 280 : 24))),
  );
  const inspectorMin = computed(() => Math.min(240, inspectorMax.value));
  const inspectorWidth = computed(() =>
    Math.max(inspectorMin.value, Math.min(inspectorSize.value, inspectorMax.value)),
  );
  let observer: ResizeObserver | undefined;
  watch(preview, (element) => {
    observer?.disconnect();
    if (!element) return;
    previewWidth.value = element.clientWidth;
    observer = new ResizeObserver(() => {
      previewWidth.value = element.clientWidth;
    });
    observer.observe(element);
  });
  let drag:
    { side: PanelSide; x: number; width: number; id: number; grip: HTMLElement } | undefined;
  function persist() {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          left: leftSize.value,
          right: rightSize.value,
          inspector: inspectorSize.value,
        }),
      );
    } catch {
      /* Resizing remains usable without preference storage. */
    }
  }
  function width(side: PanelSide) {
    return side === 'left'
      ? leftWidth.value
      : side === 'right'
        ? rightWidth.value
        : inspectorWidth.value;
  }
  function setWidth(side: PanelSide, value: number) {
    if (side === 'left') leftSize.value = Math.max(200, Math.min(leftMax.value, value));
    else if (side === 'right') rightSize.value = Math.max(360, Math.min(rightMax.value, value));
    else inspectorSize.value = Math.max(inspectorMin.value, Math.min(inspectorMax.value, value));
  }
  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    const delta = event.clientX - drag.x;
    setWidth(drag.side, drag.width + (drag.side === 'left' ? delta : -delta));
  }
  function stop(event?: PointerEvent) {
    if (event && drag && event.pointerId !== drag.id) return;
    if (drag?.grip.hasPointerCapture(drag.id)) drag.grip.releasePointerCapture(drag.id);
    drag = undefined;
    resizing.value = undefined;
    persist();
  }
  function start(side: PanelSide, event: PointerEvent) {
    if (
      (side !== 'inspector' && narrow.value) ||
      (side === 'right' && rightExpanded.value) ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    const grip = event.currentTarget as HTMLElement;
    grip.setPointerCapture(event.pointerId);
    drag = {
      side,
      x: event.clientX,
      width: width(side),
      id: event.pointerId,
      grip,
    };
    resizing.value = side;
  }
  function keyboard(side: PanelSide, event: KeyboardEvent) {
    if (event.key === 'Home')
      setWidth(side, side === 'left' ? 200 : side === 'right' ? 360 : inspectorMin.value);
    else if (event.key === 'End')
      setWidth(
        side,
        side === 'left' ? leftMax.value : side === 'right' ? rightMax.value : inspectorMax.value,
      );
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      setWidth(
        side,
        width(side) + (event.key === 'ArrowRight' ? 24 : -24) * (side === 'left' ? 1 : -1),
      );
    else return;
    event.preventDefault();
    persist();
  }
  function reset(side: PanelSide) {
    if (side === 'left') leftSize.value = defaults.left;
    else if (side === 'inspector') inspectorSize.value = defaults.inspector;
    else {
      rightExpanded.value = false;
      rightSize.value = defaults.right;
    }
    persist();
  }
  function expandLeft() {
    leftSize.value =
      leftWidth.value >= Math.min(420, leftMax.value) - 1
        ? defaults.left
        : Math.min(420, leftMax.value);
    persist();
  }
  const resize = () => {
    viewport.value = window.innerWidth;
  };
  watch(rightOpen, (open) => {
    if (!open) rightExpanded.value = false;
  });
  watch(narrow, (value) => {
    if (value && hasConversation()) leftOpen.value = false;
  });
  onMounted(() => {
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  });
  onUnmounted(() => {
    stop();
    observer?.disconnect();
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
  });
  return {
    leftOpen,
    leftExpanded,
    rightOpen,
    rightExpanded,
    resizing,
    narrow,
    leftWidth,
    rightWidth,
    leftMax,
    rightMax,
    inspectorWidth,
    inspectorMin,
    inspectorMax,
    start,
    keyboard,
    reset,
    expandLeft,
  };
}
