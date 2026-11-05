import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useCreativePreferencesStore } from './creative-preferences';

afterEach(() => vi.unstubAllGlobals());
describe('personal creative preferences', () => {
  it('handles corrupt stored preferences without blocking creation', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{broken' });
    setActivePinia(createPinia());
    expect(useCreativePreferencesStore().prompt).toBe('');
  });
  it('keeps saved preferences unchanged when persistence fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ prompt: '原来的偏好', enabled: true }),
      setItem: () => {
        throw new Error('quota');
      },
    });
    setActivePinia(createPinia());
    const store = useCreativePreferencesStore();
    expect(() => store.save('新的偏好', false)).toThrow('无法保存偏好');
    expect(store.prompt).toBe('原来的偏好');
    expect(store.enabled).toBe(true);
  });
});
