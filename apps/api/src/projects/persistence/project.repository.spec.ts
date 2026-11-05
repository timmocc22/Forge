import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectRepository } from './project.repository.js';
import type { ProjectRecord } from '../shared/project-record.js';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'forge-store-'));
  directories.push(directory);
  const repository = new ProjectRepository(directory);
  await repository.initialize();
  const record: ProjectRecord = {
    project: {
      id: randomUUID(),
      revision: 0,
      undoDepth: 0,
      sceneCount: 1,
      modelSelection: { provider: 'demo', model: 'local-sample' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      content: {
        title: 'Healthy work',
        brief: 'Brief',
        audience: 'Reader',
        style: 'minimal',
        aspect: 'landscape',
        accent: '#123456',
        scenes: [],
      },
    },
    history: [],
    operations: [],
    createRequestId: randomUUID(),
  };
  await repository.transaction((tx) => tx.save(record));
  return { directory, repository, record, path: join(directory, `${record.project.id}.json`) };
}
describe('versioned project storage', () => {
  it('isolates an unreadable project instead of preventing startup', async () => {
    const { directory, record } = await fixture();
    const bad = `${randomUUID()}.json`;
    await writeFile(join(directory, bad), 'broken');
    const reopened = new ProjectRepository(directory);
    await reopened.initialize();
    expect(reopened.get(record.project.id).project.content.title).toBe('Healthy work');
    expect(reopened.diagnostics()).toEqual([{ file: bad, reason: expect.any(String) }]);
    expect(await readFile(join(directory, bad), 'utf8')).toBe('broken');
  });
  it('recovers a validated backup and retains the corrupt original', async () => {
    const { directory, repository, record, path } = await fixture();
    record.project.content.title = 'Second version';
    record.project.revision++;
    await repository.transaction((tx) => tx.save(record));
    await writeFile(path, 'broken');
    const reopened = new ProjectRepository(directory);
    await reopened.initialize();
    expect(reopened.get(record.project.id).project.content.title).toBe('Healthy work');
    expect((await readdir(directory)).some((name) => name.includes('.corrupt-'))).toBe(true);
  });
  it('keeps legacy records readable and writes a versioned manifest on mutation', async () => {
    const { directory, record, path } = await fixture();
    await writeFile(path, JSON.stringify(record));
    const reopened = new ProjectRepository(directory);
    await reopened.initialize();
    expect(reopened.get(record.project.id)).toEqual(record);
    await reopened.transaction((tx) => tx.save(record));
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.project.content).toBeUndefined();
    expect(manifest.content).toMatch(/^[a-f0-9]{64}$/);
  });
  it('reuses content and history objects when only runtime progress changes', async () => {
    const { directory, repository, record } = await fixture();
    const objects = await readdir(join(directory, 'objects'));
    record.commands = [];
    await repository.transaction((tx) => tx.save(record, false));
    expect(await readdir(join(directory, 'objects'))).toEqual(objects);
    const reopened = new ProjectRepository(directory);
    await reopened.initialize();
    expect(reopened.get(record.project.id).commands).toEqual([]);
  });
  it('collects unreachable objects without removing the current or backup content', async () => {
    const { directory, repository, record } = await fixture();
    for (const title of ['Second version', 'Third version']) {
      record.project.content.title = title;
      record.project.revision++;
      await repository.transaction((tx) => tx.save(record));
    }
    expect(await repository.compact()).toBe(1);
    expect(await readdir(join(directory, 'objects'))).toHaveLength(2);
    const reopened = new ProjectRepository(directory);
    await reopened.initialize();
    expect(reopened.get(record.project.id).project.content.title).toBe('Third version');
  });
  it('does not downgrade an unsupported future manifest to an older backup', async () => {
    const { directory, repository, record, path } = await fixture();
    await repository.transaction((tx) => tx.save(record));
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.schemaVersion = 99;
    await writeFile(path, JSON.stringify(manifest));
    const reopened = new ProjectRepository(directory);
    await reopened.initialize();
    expect(reopened.list()).toEqual([]);
    expect(reopened.diagnostics()).toHaveLength(1);
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(99);
  });
});
