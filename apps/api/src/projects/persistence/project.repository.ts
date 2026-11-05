import { mkdir, readdir } from 'node:fs/promises';
import { NotFoundException } from '@nestjs/common';
import { projectRecordSchema, type ProjectRecord } from '../shared/project-record.js';
import type { ProjectStore, ProjectTransaction } from '../ports/project-store.js';
import { VersionedProjectFiles } from './versioned-project-files.js';
export { projectRecordSchema, type ProjectRecord } from '../shared/project-record.js';
import { expandImportedPresentation } from '../shared/import-presentation.js';

/** Single-process JSON repository. Only transaction callbacks can persist records. */
export class ProjectRepository implements ProjectStore {
  private readonly files: VersionedProjectFiles;
  readonly issues: { file: string; reason: string }[] = [];
  private readonly records = new Map<string, ProjectRecord>();
  private mutations: Promise<unknown> = Promise.resolve();
  private initialization?: Promise<void>;
  constructor(private readonly directory: string) { this.files = new VersionedProjectFiles(directory); }

  initialize() {
    return (this.initialization ??= this.load());
  }
  private async load() {
    await mkdir(this.directory, { recursive: true });
    const files = new Set((await readdir(this.directory)).filter((file) => /^[\da-f-]{36}(?:\.previous)?\.json$/.test(file)).map((file) => file.replace('.previous.json', '.json')));
    for (const file of files) {
      let record: ProjectRecord;
      try { record = await this.files.load(file); }
      catch {
        this.issues.push({ file, reason: '项目及其备份无法读取，原文件已保留' });
        continue;
      }

      const scenes = expandImportedPresentation(record.project.content.scenes);
      if (scenes !== record.project.content.scenes) {
        record.project.content.scenes = scenes;
        record.project.sceneCount = scenes.length;
        record.project.revision++;
        record.history.forEach((content) => {
          content.scenes = expandImportedPresentation(content.scenes);
        });
        await this.persist(record, false);
      }
      if (record.conversation?.pending?.status === 'running') {
        record.conversation.pending.status = 'interrupted';
        record.conversation.pending.error = '服务已重启，可继续回复';
      }
      this.records.set(record.project.id, record);
    }
  }
  diagnostics() { return structuredClone(this.issues); }
  compact() { return this.transaction(async () => this.files.compact()); }
  get(id: string): ProjectRecord {
    const record = this.records.get(id);
    if (!record) throw new NotFoundException('项目不存在');
    return structuredClone(record);
  }
  all(): ProjectRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record));
  }
  // Project list queries avoid copying full page HTML and undo snapshots.
  list() {
    return [...this.records.values()]
      .map(({ project }) => ({
        id: project.id,
        title: project.content.title,
        brief: project.content.brief.slice(0, 160),
        revision: project.revision,
        sceneCount: project.content.scenes.length,
        builtCount: project.content.scenes.filter((scene) => !!scene.html).length,
        updatedAt: project.updatedAt,
        archived: project.archived ?? false,
        running: project.run?.status === 'running',
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  /** Serialized write scope; each save atomically replaces a single record. */
  transaction<T>(operation: (transaction: ProjectTransaction) => Promise<T>): Promise<T> {
    const next = this.mutations.then(() =>
      operation({
        get: (id) => this.get(id),
        all: () => this.all(),
        remove: async (id) => {
          this.get(id);
          await this.files.remove(id);
          this.records.delete(id);
        },
        findCreated: (requestId) => {
          const record = [...this.records.values()].find(
            (item) => item.createRequestId === requestId,
          );
          return record ? structuredClone(record.project) : undefined;
        },
        save: (record, touchProject) => this.persist(record, touchProject),
      }),
    );
    this.mutations = next.catch(() => {});
    return next;
  }
  async idle() {
    await this.mutations;
  }
  /** Report a storage failure in memory when disk persistence itself is unavailable. */
  updateVolatile(id: string, change: (record: ProjectRecord) => void) {
    const record = this.get(id);
    change(record);
    this.records.set(id, structuredClone(record));
  }
  private async persist(record: ProjectRecord, touchProject = true) {
    record.project.undoDepth = record.history.length;
    if (touchProject) record.project.updatedAt = new Date().toISOString();
    projectRecordSchema.parse(record);
    await this.files.save(record);
    this.records.set(record.project.id, structuredClone(record));
    return structuredClone(record.project);
  }
}
