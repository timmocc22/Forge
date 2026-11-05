import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { APP_CONFIG, readConfig } from './config.js';
import { ErrorFilter } from './common/error.filter.js';

describe('Nest HTTP contract', () => {
  let app: INestApplication;
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'studio-http-'));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(readConfig({ PROVIDER: 'demo', DATA_DIR: directory }))
      .compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new ErrorFilter());
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it('exposes provider mode without credentials', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', provider: 'demo', version: '0.1.0' });
  });
  it('persists imported HTML projects and rejects stale or malformed updates', async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/html-projects')
      .send({
        requestId: crypto.randomUUID(),
        brief: 'Imported presentation',
        sourceHtml: '<html><body><h1>Original</h1></body></html>',
      })
      .expect(201);
    const path = `/api/html-projects/${created.body.id}`;
    const content = structuredClone(created.body.content);
    content.scenes[0].html = '<html><body><h1>Manual edit</h1></body></html>';
    const saved = await request(server)
      .patch(path)
      .send({ expectedRevision: 0, operationId: crypto.randomUUID(), content })
      .expect(200);
    expect(saved.body.content.scenes[0].html).toContain('Manual edit');
    await request(server)
      .patch(path)
      .send({
        expectedRevision: 0,
        operationId: crypto.randomUUID(),
        content: created.body.content,
      })
      .expect(409);
    const latest = await request(server).get(path).expect(200);
    expect(latest.body).toEqual(saved.body);
    await request(server).get('/api/html-projects/not-a-uuid').expect(400);
    await request(server)
      .post(`${path}/runs`)
      .send({ action: 'scene', expectedRevision: -1, requestId: crypto.randomUUID() })
      .expect(400);
  });
  it('validates read-only page questions and explicitly labels demo answers', async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/html-projects')
      .send({
        requestId: crypto.randomUUID(),
        brief: 'Read only questions',
        sourceHtml: '<html><body>Keep this</body></html>',
      })
      .expect(201);
    const path = `/api/html-projects/${created.body.id}`;
    const input = {
      expectedRevision: 0,
      sceneId: created.body.content.scenes[0].id,
      question: '这页讲了什么？',
    };
    const answer = await request(server).post(`${path}/questions`).send(input).expect(200);
    expect(answer.body.answer).toContain('未调用 AI');
    expect(answer.body.sceneId).toBe(input.sceneId);
    const transcript = await request(server).get(`${path}/conversation`).expect(200);
    expect(transcript.body).toEqual(answer.body.conversation);
    expect(transcript.body.messages.map((message: { role: string }) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(transcript.body.messages[0].content).toBe(input.question);

    await request(server)
      .post(`${path}/questions`)
      .send({ ...input, question: '  ' })
      .expect(400);
    await request(server)
      .post(`${path}/questions`)
      .send({ ...input, html: '<html>injected</html>' })
      .expect(400);
    await request(server)
      .post(`${path}/questions`)
      .send({ ...input, expectedRevision: 5 })
      .expect(409);
    await request(server)
      .post(`${path}/questions`)
      .send({ ...input, sceneId: crypto.randomUUID() })
      .expect(404);
    expect((await request(server).get(path).expect(200)).body).toEqual(created.body);
  });
  it('publishes only HTML text capabilities without provider secrets', async () => {
    const response = await request(app.getHttpServer()).get('/api/providers').expect(200);
    expect(response.body.defaultProvider).toBe('demo');
    expect(Object.keys(response.body.defaults)).toEqual(['html']);
    for (const provider of response.body.providers) {
      expect(provider.capabilities.map((item: { kind: string }) => item.kind)).toEqual(['html']);
    }
    expect(response.body).not.toHaveProperty('OPENAI_API_KEY');
  });
  it.each([
    '/api/jobs',
    '/api/mindmaps/00000000-0000-4000-8000-000000000000',
    '/api/conversations',
    '/api/agent-runs',
  ])('does not expose the retired route %s', async (path) => {
    await request(app.getHttpServer()).get(path).expect(404);
    await request(app.getHttpServer()).post(path).send({}).expect(404);
  });
});
