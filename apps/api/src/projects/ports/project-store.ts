import type { HtmlProject } from '@studio/contracts';
import type { ProjectRecord } from '../shared/project-record.js';

export const PROJECT_STORE = Symbol('PROJECT_STORE');
export interface ProjectTransaction {
  get(id: string): ProjectRecord;
  all(): ProjectRecord[];
  remove(id: string): Promise<void>;
  findCreated(requestId: string): HtmlProject | undefined;
  save(record: ProjectRecord, touchProject?: boolean): Promise<HtmlProject>;
}
export interface ProjectStore {
  initialize(): Promise<void>;
  diagnostics(): { file: string; reason: string }[];
  get(id: string): ProjectRecord;
  all(): ProjectRecord[];
  list(): {
    id: string; title: string; brief: string; revision: number; sceneCount: number;
    builtCount: number; updatedAt: string; archived: boolean; running: boolean;
  }[];
  transaction<T>(operation: (transaction: ProjectTransaction) => Promise<T>): Promise<T>;
  idle(): Promise<void>;
  updateVolatile(id: string, change: (record: ProjectRecord) => void): void;
}
