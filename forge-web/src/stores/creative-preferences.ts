import { ref } from 'vue';
import { defineStore } from 'pinia';

const storageKey = 'studio.creative-preferences.v1';
function readPreferences(): { prompt: string; enabled: boolean } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (
      value &&
      typeof value === 'object' &&
      'prompt' in value &&
      typeof value.prompt === 'string' &&
      value.prompt.length <= 4000 &&
      'enabled' in value &&
      typeof value.enabled === 'boolean'
    )
      return { prompt: value.prompt, enabled: value.enabled };
  } catch {
    /* Invalid or unavailable storage starts with empty preferences. */
  }
  return { prompt: '', enabled: true };
}

export const useCreativePreferencesStore = defineStore('creative-preferences', () => {
  const saved = readPreferences();
  const prompt = ref(saved.prompt);
  const enabled = ref(saved.enabled);
  function save(nextPrompt: string, nextEnabled: boolean) {
    const value = nextPrompt.trim();
    if (value.length > 4000) throw new Error('自定义 Prompt 最多 4000 字');
    // Persist before updating the UI so a failed write is never reported as saved.
    try {
      localStorage.setItem(storageKey, JSON.stringify({ prompt: value, enabled: nextEnabled }));
    } catch {
      throw new Error('无法保存偏好，请检查当前设备的存储权限后重试。');
    }
    prompt.value = value;
    enabled.value = nextEnabled;
  }
  return { prompt, enabled, save };
});
