import { strict as assert } from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import {
  htmlProjectSchema,
  conversationSchema,
  askHtmlSceneResponseSchema,
  providerCatalogSchema,
} from '../packages/contracts/src/index.ts';
const base = process.env.API_URL ?? 'http://127.0.0.1:3009/api';
async function req(path: string, method = 'GET', body?: unknown, status = 200) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
providerCatalogSchema.parse(await req('/providers'));
let p = htmlProjectSchema.parse(
  await req(
    '/html-projects',
    'POST',
    { requestId: randomUUID(), brief: '数学：理解分数', sceneCount: 2 },
    201,
  ),
);
async function run(action: string) {
  p = htmlProjectSchema.parse(
    await req(
      `/html-projects/${p.id}/runs`,
      'POST',
      { expectedRevision: p.revision, requestId: randomUUID(), action },
      202,
    ),
  );
  for (let i = 0; i < 100; i++) {
    await delay(50);
    p = htmlProjectSchema.parse(await req(`/html-projects/${p.id}`));
    if (p.run?.status !== 'running') break;
  }
  assert.equal(p.run?.status, 'succeeded', p.run?.message);
}
await run('plan');
assert.equal(p.content.scenes.length, 2);
await run('build');
assert.ok(p.content.scenes.every((s) => s.html.includes('</html>')));
const answer = askHtmlSceneResponseSchema.parse(
  await req(`/html-projects/${p.id}/questions`, 'POST', {
    expectedRevision: p.revision,
    requestId: randomUUID(),
    sceneId: p.content.scenes[0].id,
    question: '解释一下这页',
    allowEdits: false,
  }),
);
assert.equal(answer.conversation.messages.length, 2);
conversationSchema.parse(await req(`/html-projects/${p.id}/conversation`));
const original = p.content;
const revision = p.revision;
p = htmlProjectSchema.parse(
  await req(`/html-projects/${p.id}`, 'PATCH', {
    expectedRevision: p.revision,
    operationId: randomUUID(),
    content: { ...p.content, title: '新标题' },
  }),
);
await req(
  `/html-projects/${p.id}`,
  'PATCH',
  { expectedRevision: revision, operationId: randomUUID(), content: original },
  409,
);
p = htmlProjectSchema.parse(
  await req(`/html-projects/${p.id}/undo`, 'POST', {
    expectedRevision: p.revision,
    operationId: randomUUID(),
  }),
);
assert.deepEqual(p.content, original);
await req(`/html-projects/${p.id}`, 'DELETE', { expectedRevision: p.revision });
console.log(
  'HTTP contract checks passed: catalog, create, plan, build, conversation, save, conflict, undo, delete',
);
