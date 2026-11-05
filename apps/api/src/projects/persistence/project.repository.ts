import { mkdir, readdir } from 'node:fs/promises';
import { NotFoundException } from '@nestjs/common';
import { projectRecordSchema, type ProjectRecord } from '../shared/project-record.js';
import type { ProjectStore, ProjectTransaction } from '../ports/project-store.js';
import { VersionedProjectFiles, UnsupportedProjectVersion } from './versioned-project-files.js';
export { projectRecordSchema, type ProjectRecord } from '../shared/project-record.js';
import { expandImportedPresentation } from '../shared/import-presentation.js';

/** Single-process JSON repository. Only transaction callbacks can persist records. */
export class ProjectRepository implements ProjectStore {
  private readonly files: VersionedProjectFiles;
  readonly issues: { file: string; reason: string; recovered?: boolean }[] = [];
  private readonly records = new Map<string, ProjectRecord>();
  private mutations: Promise<unknown> = Promise.resolve();
  private initialization?: Promise<void>;
  constructor(private readonly directory: string) {
    this.files = new VersionedProjectFiles(directory);
  }

  initialize() {
    return (this.initialization ??= this.load());
  }
  private async load() {
    await mkdir(this.directory, { recursive: true });
    const files = new Set(
      (await readdir(this.directory))
        .filter((file) => /^[\da-f-]{36}(?:\.previous)?\.json$/.test(file))
        .map((file) => file.replace('.previous.json', '.json')),
    );
    for (const file of files) {
      let record: ProjectRecord;
      try {
        record = await this.files.load(file);
      } catch (error) {
        this.issues.push({
          file,
          reason:
            error instanceof UnsupportedProjectVersion
              ? '存储版本较新，请使用更新版本的应用；原文件已保留'
              : '项目及其备份无法读取，原文件已保留',
        });
        continue;
      }

      if (this.files.recovered.has(file))
        this.issues.push({
          file,
          reason: '已从上一份备份恢复，请核对最近修改；损坏原文件已保留',
          recovered: true,
        });
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
    // Collection is conservative: any unreadable/unsupported manifest prevents deletion.
    await this.files.compact().catch(() => {});
  }
  read(id: string) {
    const record = this.records.get(id);
    if (!record) throw new NotFoundException('项目不存在');
    return structuredClone({
      project: record.project,
      conversation: record.conversation,
      commands: record.commands,
    });
  }
  diagnostics() {
    return structuredClone(this.issues);
  }
  compact() {
    return this.transaction(async () => this.files.compact());
  }
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
    const validated = projectRecordSchema.parse(record);
    await this.files.save(validated);
    this.records.set(validated.project.id, structuredClone(validated));
    return structuredClone(validated.project);
  }
}
