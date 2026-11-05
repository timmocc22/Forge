import { computed, onScopeDispose, ref, watch } from 'vue';
import { defineStore } from 'pinia';

type ThemePreference = 'system' | 'light' | 'dark';
const storageKey = 'studio.theme';
function parsePreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export const useAppearanceStore = defineStore('appearance', () => {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const preference = ref<ThemePreference>(
    parsePreference(document.documentElement.dataset.themePreference),
  );
  const systemDark = ref(media.matches);
  const resolvedTheme = computed(() =>
    preference.value === 'system' ? (systemDark.value ? 'dark' : 'light') : preference.value,
  );
  watch(
    [preference, resolvedTheme],
    ([mode, theme]) => {
      document.documentElement.dataset.themePreference = mode;
      document.documentElement.dataset.theme = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme === 'dark' ? '#202020' : '#ffffff');
    },
    { immediate: true, flush: 'sync' },
  );
  watch(
    preference,
    (value) => {
      try {
        localStorage.setItem(storageKey, value);
      } catch {
        /* Theme still works when browser storage is unavailable. */
      }
    },
    { flush: 'sync' },
  );
  const onSystemChange = (event: MediaQueryListEvent) => {
    systemDark.value = event.matches;
  };
  const onStorageChange = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null)
      preference.value = parsePreference(event.newValue);
  };
  media.addEventListener('change', onSystemChange);
  window.addEventListener('storage', onStorageChange);
  onScopeDispose(() => {
    media.removeEventListener('change', onSystemChange);
    window.removeEventListener('storage', onStorageChange);
  });
  return { preference, resolvedTheme };
});
