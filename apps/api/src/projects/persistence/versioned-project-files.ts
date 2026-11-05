import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { htmlProjectSchema, pendingConversationSchema, projectCommandsSchema } from '@studio/contracts';
import { projectRecordSchema, executionCheckpointSchema, type ProjectRecord } from '../shared/project-record.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.object({
  schemaVersion: z.literal(2),
  commands: projectCommandsSchema.optional(),
  project: htmlProjectSchema.omit({ content: true }),
  content: hash,
  history: z.array(hash).max(20),
  conversation: z.object({
    id: z.string().uuid(), projectId: z.string().uuid(), messages: hash,
    pending: pendingConversationSchema.optional(),
  }).optional(),
  checkpoint: executionCheckpointSchema.omit({ content: true }).extend({ content: hash }).optional(),
  createRequestId: z.string().uuid(),
  operations: z.array(z.string().uuid()).max(100),
});

/** Immutable values first, then one atomic manifest swap. Legacy files remain readable. */
export class VersionedProjectFiles {
  private readonly blobs: string;
  private readonly known = new Set<string>();
  constructor(private readonly directory: string) { this.blobs = join(directory, 'objects'); }

  private async put(value: unknown) {
    const bytes = JSON.stringify(value);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (!this.known.has(digest)) {
      await mkdir(this.blobs, { recursive: true, mode: 0o700 });
      // Do not trust a pre-existing blob without checking its checksum.
      const path = join(this.blobs, `${digest}.json`);
      const existing = await readFile(path, 'utf8').catch(() => undefined);
      if (existing !== bytes) await this.atomic(path, bytes);
      this.known.add(digest);
    }
    return digest;
  }
  private async read(digest: string) {
    const bytes = await readFile(join(this.blobs, `${digest}.json`), 'utf8');
    if (createHash('sha256').update(bytes).digest('hex') !== digest)
      throw new Error('项目对象校验失败');
    this.known.add(digest);
    return JSON.parse(bytes) as unknown;
  }
  private async decode(bytes: string, id: string): Promise<ProjectRecord> {
    const raw = JSON.parse(bytes);
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== 2) throw new UnsupportedProjectVersion();
    const record = raw.schemaVersion === undefined ? projectRecordSchema.parse(raw) : await (async () => {
      const manifest = manifestSchema.parse(raw);
      const { conversation, checkpoint } = manifest;
      return projectRecordSchema.parse({
        project: { ...manifest.project, content: await this.read(manifest.content) },
        history: await Promise.all(manifest.history.map((ref) => this.read(ref))),
        conversation: conversation ? { ...conversation, messages: await this.read(conversation.messages) } : undefined,
        checkpoint: checkpoint ? { ...checkpoint, content: await this.read(checkpoint.content) } : undefined,
        commands: manifest.commands,
        createRequestId: manifest.createRequestId, operations: manifest.operations,
      });
    })();
    if (record.project.id !== id) throw new Error('项目文件标识不一致');
    return record;
  }
  async load(file: string): Promise<ProjectRecord> {
    const id = file.replace(/\.json$/, '');
    const path = join(this.directory, file);
    try { return await this.decode(await readFile(path, 'utf8'), id); }
    catch (error) {
      if (error instanceof UnsupportedProjectVersion) throw error;
      // Recover only a validated snapshot and retain the damaged original for diagnosis.
      const bytes = await readFile(join(this.directory, `${id}.previous.json`), 'utf8');
      const record = await this.decode(bytes, id);
      await rename(path, `${path}.corrupt-${randomUUID()}`).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await this.atomic(path, bytes);
      return record;
    }
  }
  async save(record: ProjectRecord) {
    const { content, ...project } = record.project;
    const { conversation, checkpoint } = record;
    const manifest = manifestSchema.parse({
      schemaVersion: 2, commands: record.commands, project, content: await this.put(content),
      history: await Promise.all(record.history.map((value) => this.put(value))),
      conversation: conversation ? { ...conversation, messages: await this.put(conversation.messages) } : undefined,
      checkpoint: checkpoint ? { ...checkpoint, content: await this.put(checkpoint.content) } : undefined,
      createRequestId: record.createRequestId, operations: record.operations,
    });
    const path = join(this.directory, `${project.id}.json`);
    const previous = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (previous !== undefined) {
      // Never replace a good backup with a corrupt manifest.
      await this.decode(previous, project.id);
      await this.atomic(join(this.directory, `${project.id}.previous.json`), previous);
    }
    await this.atomic(path, JSON.stringify(manifest));
  }
  async remove(id: string) {
    // Remove backup first so deletion cannot resurrect a project on next startup.
    await unlink(join(this.directory, `${id}.previous.json`)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await unlink(join(this.directory, `${id}.json`));
  }
  /** Run only while the repository write queue is idle. Unreadable records prevent collection. */
  async compact() {
    const names = await readdir(this.directory);
    if (names.some((name) => name.includes('.corrupt-'))) return 0;
    const retained = new Set<string>();
    for (const name of names.filter((file) => /^[\da-f-]{36}(?:\.previous)?\.json$/.test(file))) {
      const raw = JSON.parse(await readFile(join(this.directory, name), 'utf8'));
      if (raw.schemaVersion === undefined) { projectRecordSchema.parse(raw); continue; }
      const manifest = manifestSchema.parse(raw);
      for (const ref of [manifest.content, ...manifest.history, manifest.conversation?.messages, manifest.checkpoint?.content])
        if (ref) retained.add(ref);
    }
    let removed = 0;
    for (const name of await readdir(this.blobs).catch(() => [] as string[])) {
      if (!/^[a-f0-9]{64}\.json$/.test(name) || retained.has(name.slice(0, -5))) continue;
      await unlink(join(this.blobs, name)); this.known.delete(name.slice(0, -5)); removed++;
    }
    return removed;
  }
  private async atomic(path: string, bytes: string) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(() => {}); }
  }
}

class UnsupportedProjectVersion extends Error {}
