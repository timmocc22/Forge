/** Browser-independent ports used by HTML draft storage and export. */
export interface DraftStore<TDraft> {
  read(id: string): Promise<TDraft | undefined>;
  write(id: string, draft: TDraft): Promise<void>;
  remove(id: string): Promise<void>;
}
export interface PreferenceStore {
  read<T>(key: string): T | undefined;
  write<T>(key: string, value: T): void;
}
export interface Clock {
  now(): string;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}
export interface IdGenerator {
  next(): string;
}
export interface ExportFile {
  readonly blob: Blob;
  readonly filename: string;
}
export interface DownloadPort {
  save(file: ExportFile): void | Promise<void>;
}
export { createPreviewDocument } from './artifacts.js';
