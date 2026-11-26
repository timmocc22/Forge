<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 });
const paths: Record<string, string> = {
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21v-2a8 8 0 0116 0v2',
  warning: 'M12 3L2 21h20L12 3zM12 9v5M12 17v.01',
  queue: 'M5 3v12a3 3 0 003 3h12M16 14l4 4-4 4M10 4h8M10 9h5',
  steer: 'M4 5v5a3 3 0 003 3h13M15 8l5 5-5 5',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  more: 'M5 12a1 1 0 110 .01M12 12a1 1 0 110 .01M19 12a1 1 0 110 .01',
  chat: 'M4 4h16v12H9l-5 4V4zM8 8h8M8 12h5',
  'panel-left': 'M3 4h18v16H3zM9 4v16M5 8h1M5 11h1',
  'panel-right': 'M3 4h18v16H3zM15 4v16M18 8h1M18 11h1',
  search: 'M10.5 18a7.5 7.5 0 110-15 7.5 7.5 0 010 15zM16 16l5 5',
  chevron: 'M6 9l6 6 6-6',
  sun: 'M12 8a4 4 0 110 8 4 4 0 010-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20.5 13A8.5 8.5 0 1111 3.5 6.5 6.5 0 0020.5 13z',
  spark: 'M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  code: 'M8 6l-6 6 6 6M16 6l6 6-6 6M14 3l-4 18',
  puzzle:
    'M4 4h5V3a3 3 0 016 0v1h5v5h1a3 3 0 010 6h-1v5h-5v-1a3 3 0 00-6 0v1H4v-5h1a3 3 0 000-6H4V4z',
  folder: 'M3 6h7l2 3h9v11H3V6zM3 6V4h7l2 2h7v3',
  archive: 'M3 3h18v4H3zM5 7v14h14V7M10 11h4',
  restore: 'M3 10a9 9 0 119 11M3 4v6h6M12 7v5l3 2',
  settings:
    'M12 8a4 4 0 110 8 4 4 0 010-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  pause: 'M8 5v14M16 5v14',
  download: 'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
  check: 'M5 12l4 4L19 6',
  close: 'M6 6l12 12M18 6L6 18',
  external: 'M14 3h7v7M21 3L10 14M10 3H3v18h18v-7',
  expand: 'M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6',
  collapse: 'M3 9h6V3M21 9h-6V3M9 21v-6H3M15 21v-6h6',
  refresh: 'M20 8a8 8 0 10.3 7M20 3v5h-5',
  book: 'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3V4zM12 6v16',
  clock: 'M12 22a10 10 0 110-20 10 10 0 010 20zM12 6v6l4 2',
};
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.spark" />
  </svg>
</template>
