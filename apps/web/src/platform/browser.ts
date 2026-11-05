import type {
  Clock,
  DownloadPort,
  ExportFile,
  IdGenerator,
  PreferenceStore,
} from '@studio/plugin-sdk';
export const browserClock: Clock = {
  now: () => new Date().toISOString(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: (handle) => {
    if (handle !== undefined) clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
export const browserIds: IdGenerator = { next: () => crypto.randomUUID() };
export class BrowserPreferenceStore implements PreferenceStore {
  constructor(
    private readonly namespace: string,
    private readonly storage: () => Storage,
  ) {}
  read<T>(key: string): T | undefined {
    try {
      const raw = this.storage().getItem(`${this.namespace}.${key}`);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return;
    }
  }
  write<T>(key: string, value: T) {
    try {
      this.storage().setItem(`${this.namespace}.${key}`, JSON.stringify(value));
    } catch {
      /* Optional preferences cannot stop the workspace. */
    }
  }
}
export class BrowserDownloadService implements DownloadPort {
  constructor(
    private readonly clock: Clock,
    private readonly revokeDelayMs = 1000,
  ) {}
  save({ blob, filename }: ExportFile) {
    const url = URL.createObjectURL(blob),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    this.clock.schedule(() => URL.revokeObjectURL(url), this.revokeDelayMs);
  }
}
export function browserSessionIdentity(
  storage: () => Storage,
  ids: IdGenerator,
  key = 'studio.window-session',
) {
  try {
    const session = storage();
    const existing = session.getItem(key);
    if (existing) return existing;
    const id = ids.next();
    session.setItem(key, id);
    return id;
  } catch {
    return ids.next();
  }
}
