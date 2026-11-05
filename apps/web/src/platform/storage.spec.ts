import { describe, expect, it, vi } from 'vitest';
import { BrowserPreferenceStore, browserSessionIdentity } from './browser';
import { IndexedDbDraftStore } from './indexeddb-drafts';
describe('optional browser storage adapters', () => {
  it('creates adapters without touching storage and degrades when access is denied', async () => {
    const denied = vi.fn(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const preferences = new BrowserPreferenceStore('test', denied),
      drafts = new IndexedDbDraftStore(
        { database: 'test', version: 1, store: 'drafts', namespace: 'x', sessionId: 'tab' },
        denied,
        (value) => value,
      );
    expect(denied).not.toHaveBeenCalled();
    expect(preferences.read('id')).toBeUndefined();
    expect(() => preferences.write('id', 'draft')).not.toThrow();
    expect(browserSessionIdentity(denied, { next: () => 'fallback' })).toBe('fallback');
    await expect(drafts.read('id')).rejects.toThrow('denied');
    await expect(drafts.read('id')).rejects.toThrow('denied');
    expect(denied).toHaveBeenCalledTimes(5);
  });
});
