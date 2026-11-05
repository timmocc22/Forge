import { mockCommandWorker } from './command-worker-fixture';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AskHtmlScene, HtmlProject } from '@studio/contracts';

test('AI creative options default to automatic and retain individual manual choices', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /创作选项/ })).toContainText('AI 决定');
  await page.getByRole('button', { name: /创作选项/ }).click();
  await expect(page.getByRole('combobox', { name: '分镜页数', exact: true })).toContainText(
    'AI 决定',
  );
  await page.getByRole('combobox', { name: '分镜页数', exact: true }).click();
  await page.getByRole('option', { name: '8 页', exact: true }).click();
  const submitted = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/html-projects'),
  );
  await page.getByLabel('创作主题', { exact: true }).fill('为小学生介绍分数');
  await page.getByRole('button', { name: '开始规划分镜', exact: true }).click();
  expect((await submitted).postDataJSON()).toMatchObject({ creativeOptions: { sceneCount: 8 } });
  await expect(page.locator('.conversation-scenes li')).toHaveCount(8);
  await expect(page.getByLabel('创作方案')).toContainText('8 页');
  await page.getByText('查看规划理由', { exact: true }).click();
  await expect(page.getByLabel('创作方案')).toContainText('本地演示');
});

for (const mode of ['option', 'manual', 'delegate'] as const) {
  test(`AI guides a key creative decision during planning: ${mode}`, async ({ page, request }) => {
    let attempts = 0;
    await page.route('**/api/html-projects/*/runs', async (route) => {
      const input = route.request().postDataJSON();
      expect(input.action).toBe('plan');
      if (++attempts > 1) {
        expect(input.instruction).toContain(mode === 'delegate' ? '自行判断' : '小学生');
        if (mode === 'manual' && attempts === 2)
          return route.fulfill({
            status: 503,
            json: { error: { message: '暂时无法继续，请重试' } },
          });
        return route.continue();
      }
      const current: HtmlProject = await (
        await request.get(
          route
            .request()
            .url()
            .replace(/\/runs$/, ''),
        )
      ).json();
      return route.fulfill({
        json: {
          ...current,
          run: {
            id: crypto.randomUUID(),
            requestId: input.requestId,
            action: 'plan',
            status: 'awaiting_input',
            completed: 0,
            total: 1,
            message: '需要明确听众',
            modelSelection: current.modelSelection,
            startedAt: new Date().toISOString(),
            clarification: {
              question: '这次给学生讲，还是给教师培训？',
              options: [{ label: '学生课堂', instruction: '给小学生讲解' }],
            },
          },
        },
      });
    });
    await page.goto('/');
    await page.getByLabel('创作主题', { exact: true }).fill('介绍分数的意义');
    await page.getByRole('button', { name: '开始规划分镜', exact: true }).click();
    await expect(page.getByLabel('生成前确认')).toContainText('给教师培训');
    if (mode === 'manual') {
      await page.getByLabel('补充你的选择', { exact: true }).fill('给小学生讲解');
      await page.getByRole('button', { name: '发送创作要求并重新规划', exact: true }).click();
      await expect(page.getByLabel('补充你的选择', { exact: true })).toHaveValue('给小学生讲解');
      await page.getByRole('button', { name: '发送创作要求并重新规划', exact: true }).click();
    } else {
      await page
        .getByRole('button', { name: mode === 'option' ? '学生课堂' : '交给 AI 判断', exact: true })
        .click();
    }
    await expect(page.locator('.conversation-scenes li')).toHaveCount(5);
    await expect(page.getByLabel('生成前确认')).toHaveCount(0);
    await expect(page.getByLabel('创作方案')).toBeVisible();
    await expect(page.locator('.conversation-request')).toContainText('介绍分数的意义');
    expect(attempts).toBe(mode === 'manual' ? 3 : 2);
  });
}

test('failed storyboard allows editing the brief and retrying without a selected scene', async ({
  page,
}, testInfo) => {
  await mockCommandWorker(page);
  let attempts = 0;
  await page.route('**/api/html-projects/*/runs', async (route) => {
    attempts++;
    if (attempts === 1) {
      const response = await route.fetch({
        url: route
          .request()
          .url()
          .replace(/\/runs$/, ''),
        method: 'GET',
        postData: undefined,
      });
      const project: HtmlProject = await response.json();
      project.run = {
        id: crypto.randomUUID(),
        requestId: route.request().postDataJSON().requestId,
        action: 'plan',
        status: 'failed',
        completed: 0,
        total: 1,
        message: '模型返回的分镜格式不正确，请重试。',
        modelSelection: project.modelSelection,
        startedAt: new Date().toISOString(),
      };
      return route.fulfill({ json: project });
    }
    if (attempts === 2)
      return route.fulfill({ status: 503, json: { error: { message: '暂时无法规划，请重试' } } });
    return route.continue();
  });
  await page.goto('/');
  await page.getByLabel('创作主题', { exact: true }).fill('红楼梦');
  await page.getByRole('button', { name: '开始规划分镜' }).click();
  await expect(page.locator('.response-status')).toHaveText('模型返回的分镜格式不正确，请重试。');
  const composer = page.getByLabel('创作要求', { exact: true });
  const send = page.getByRole('button', { name: '发送创作要求并重新规划', exact: true });
  await expect(composer).toBeEnabled();
  await expect(composer).toBeEmpty();
  await composer.fill('');
  await expect(send).toBeDisabled();
  await composer.fill('红楼梦：面向初中生介绍主要人物和人物关系');
  await send.click();
  await expect(composer).toBeEnabled();
  await expect(composer).toBeEmpty();
  await expect(page.getByLabel('待处理消息')).toContainText('暂时无法规划');
  await expect(send).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('storyboard-retry.png'), fullPage: true });
  await page.getByRole('button', { name: '重试发送', exact: true }).click();
  await expect(page.locator('.conversation-scenes li')).toHaveCount(5, { timeout: 20000 });
  await expect(page.getByLabel('页面问题或修改要求', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('页面问题或修改要求', { exact: true })).toHaveValue('');
  expect(attempts).toBe(3);
});

test('Zhipu reasoning selection survives reload and is sent with the next creation', async ({
  page,
}, testInfo) => {
  await page.route('**/api/providers', (route) =>
    route.fulfill({
      json: {
        defaultProvider: 'demo',
        defaults: { html: { provider: 'demo', model: 'local-sample' } },
        providers: [
          {
            id: 'demo',
            name: '本地演示',
            capabilities: [
              {
                kind: 'html',
                available: true,
                models: ['local-sample'],
                defaultModel: 'local-sample',
              },
            ],
          },
          {
            id: 'zhipu',
            name: '智谱',
            capabilities: [
              {
                kind: 'html',
                available: true,
                models: ['glm-5.3', 'glm-5.3-flash'],
                defaultModel: 'glm-5.3',
                reasoningEfforts: ['low', 'high', 'max'],
                defaultReasoningEffort: 'high',
              },
            ],
          },
        ],
      },
    }),
  );
  let submitted: unknown;
  await page.route('**/api/html-projects', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submitted = route.request().postDataJSON().modelSelection;
    await route.fulfill({ status: 400, json: { message: '测试已记录请求' } });
  });
  const trigger = page.locator('.start-section .model-trigger');
  const effort = page.getByRole('combobox', { name: '思考等级', exact: true });
  await page.goto('/');
  await expect(trigger).toContainText('本地演示');
  await trigger.click();
  await expect(effort).toHaveCount(0);
  await page.getByRole('combobox', { name: '服务商', exact: true }).click();
  await page.getByRole('option', { name: '智谱', exact: true }).click();
  await expect(effort).toHaveText('高（high）');
  await effort.click();
  await expect(page.getByRole('option')).toHaveText(['低（low）', '高（high）', '最高（max）']);
  await effort.press('End');
  await effort.press('Enter');
  await page.getByRole('button', { name: '应用选择', exact: true }).click();
  await expect(trigger).toHaveText('glm-5.3 · max');
  await expect(trigger).toHaveAttribute('title', 'glm-5.3 · max');
  await page.reload();
  await expect(trigger).toHaveText('glm-5.3 · max');
  await trigger.click();
  await expect(effort).toHaveText('最高（max）');
  await page.screenshot({
    path: testInfo.outputPath('zhipu-reasoning-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await effort.click();
  await page.getByRole('option', { name: '低（low）', exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath('zhipu-reasoning-mobile.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '应用选择', exact: true }).click();
  await page.getByLabel('创作主题', { exact: true }).fill('检查智谱思考等级');
  await page.getByRole('button', { name: '开始规划分镜' }).click();
  await expect
    .poll(() => submitted)
    .toEqual({ provider: 'zhipu', model: 'glm-5.3', reasoningEffort: 'low' });
  await trigger.click();
  await page.getByRole('combobox', { name: '服务商', exact: true }).click();
  await page.getByRole('option', { name: '本地演示', exact: true }).click();
  await expect(effort).toHaveCount(0);
  await page.getByRole('button', { name: '应用选择', exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('studio.models') ?? '{}'),
  );
  expect(saved.html).toEqual({ provider: 'demo', model: 'local-sample' });
});

test('HTML authoring: storyboard, saved manual edits, focused revision, point editing and export', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90000);
  await page.goto('/');
  await expect(page.locator('.start-section .model-trigger')).toContainText('本地演示');
  await expect(page.getByRole('heading', { name: '想创作什么？' })).toHaveCount(0);
  await expect(page.getByLabel('创作灵感')).toHaveCount(0);
  const composerBottom = await page.locator('.start-composer').boundingBox();
  expect(page.viewportSize()!.height - composerBottom!.y - composerBottom!.height).toBe(24);
  await page.getByRole('button', { name: /创作选项/ }).click();
  await expect(page.getByLabel('目标读者', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /创作选项/ }).click();
  await page.screenshot({ path: testInfo.outputPath('home-minimal-light.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('home-minimal-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileComposer = (await page.locator('.start-composer').boundingBox())!;
  expect(844 - mobileComposer.y - mobileComposer.height).toBe(16);
  await page.screenshot({ path: testInfo.outputPath('home-minimal-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.getByRole('button', { name: '文字生图', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '思维导图', exact: true })).toHaveCount(0);
  await page.getByLabel('创作主题', { exact: true }).fill('分数的意义：从生活中的平分理解分数');
  await page.getByRole('button', { name: '开始规划分镜' }).click();
  await page.getByRole('button', { name: '页面属性', exact: true }).click();
  await expect(page.getByLabel('页面标题', { exact: true })).toHaveValue(/从一个问题开始/, {
    timeout: 20000,
  });
  await expect(page.locator('.conversation-scenes li')).toHaveCount(5);
  await page.getByLabel('页面目标', { exact: true }).fill('用一个披萨说明整体与部分的关系。');
  await page.getByRole('button', { name: '页面属性', exact: true }).click();
  await page.getByRole('button', { name: /生成未完成页面/ }).click();
  await expect(page.getByRole('button', { name: '导出 HTML', exact: true })).toBeEnabled({
    timeout: 20000,
  });
  const projectId = page.url().split('#project/')[1]!;
  const projectUrl = `/api/html-projects/${projectId}`;
  const initial = await (await request.get(projectUrl)).json();
  const untouchedScene = initial.content.scenes[1];
  await page.getByRole('tab', { name: 'HTML 源码' }).click();
  const source = page.getByLabel('页面 HTML 源码');
  const html = await source.inputValue();
  await source.fill(
    html.replace(
      '</body>',
      '<p id="human-edit" style="position:fixed;top:10px;left:10px">人工修改需保留</p></body>',
    ),
  );
  await page.locator('.header-actions .save-button').click();
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.reload();
  await page.getByRole('tab', { name: 'HTML 源码' }).click();
  await expect(source).toHaveValue(/人工修改需保留/);
  await page.getByLabel('页面问题或修改要求').fill('补充一条说明，保留标题与人工修改');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '导出 HTML', exact: true })).toBeEnabled({
    timeout: 20000,
  });
  const revised = await (await request.get(projectUrl)).json();
  expect(revised.content.scenes[0].html).toContain('人工修改需保留');
  expect(revised.content.scenes[1]).toEqual(untouchedScene);
  await page.getByRole('tab', { name: '画布', exact: true }).click();
  await expect(page.getByRole('button', { name: '点选修改', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '点选修改', exact: true }).click();
  const preview = page.frameLocator('iframe[title="当前页面预览"]');
  // Use canvas coordinates: nested locator hit testing misprojects scaled iframe bounds.
  const heading = await preview.locator('h1').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  const canvas = (await page.locator('iframe[title="当前页面预览"]').boundingBox())!;
  await page.mouse.click(
    canvas.x + (heading.x * canvas.width) / 1280,
    canvas.y + (heading.y * canvas.height) / 720,
  );
  await page.getByLabel('替换选中文字').fill('生活中的分数');
  await page.getByRole('button', { name: /应用文字修改/ }).click();
  await expect(preview.locator('h1')).toHaveText('生活中的分数');
  await page.locator('.canvas-actions button[title="检查当前页"]').click();
  await expect(page.locator('.check-intro h3')).toHaveText(/当前页未发现问题|发现需要留意/);
  await page.screenshot({ path: testInfo.outputPath('html-studio-desktop.png'), fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = testInfo.outputPath('presentation.html');
  await download.saveAs(downloadPath);
  const exported = await readFile(downloadPath, 'utf8');
  expect(exported).toContain('生活中的分数');
  expect(exported).toContain('人工修改需保留');
  expect(exported).not.toContain('allow-same-origin');
  await page.goto(`file://${downloadPath}`);
  await expect(page.locator('#counter')).toHaveText('1 / 5');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('#counter')).toHaveText('2 / 5');
  const importedResponse = await request.post('/api/html-projects', {
    data: {
      requestId: crypto.randomUUID(),
      brief: '导出后重新导入页数回归',
      sourceHtml: exported,
      modelSelection: { provider: 'demo', model: 'local-sample' },
    },
  });
  expect(importedResponse.ok()).toBe(true);
  const imported: HtmlProject = await importedResponse.json();
  expect(imported.content.scenes).toHaveLength(5);
  await page.goto(`/#project/${imported.id}`);
  const row = page
    .getByRole('button', {
      name: `打开对话：${imported.content.title}`,
      exact: true,
    })
    .and(page.locator('[aria-current="true"]'));
  await expect(row).toContainText('5 / 5 页');
  const importedPreview = page.frameLocator('iframe[title="当前页面预览"]');
  await expect(importedPreview.locator('h1')).toHaveText('生活中的分数');
  await expect(importedPreview.locator('#counter')).toHaveCount(0);
  await expect(importedPreview.locator('iframe')).toHaveCount(0);
});

test('mobile: project controls fit and imported HTML stays editable and sandboxed', async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const result = await request.post('/api/html-projects', {
    data: {
      requestId: crypto.randomUUID(),
      brief: '移动端导入测试',
      audience: '读者',
      sceneCount: 1,
      modelSelection: { provider: 'demo', model: 'local-sample' },
      sourceHtml:
        '<!doctype html><html><body><h1>可编辑的原始作品</h1><p>保留原始内容</p></body></html>',
    },
  });
  expect(result.ok()).toBe(true);
  const project = await result.json();
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('button', { name: '页面属性', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('导入的 HTML');
  await page.getByRole('button', { name: '页面属性', exact: true }).click();
  await expect(page.locator('iframe[title="当前页面预览"]')).toHaveAttribute(
    'sandbox',
    'allow-scripts',
  );
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.viewport + 1);
  await page.getByRole('tab', { name: 'HTML 源码' }).click();
  await expect(page.getByLabel('页面 HTML 源码')).toHaveValue(/保留原始内容/);
  await page.getByRole('tab', { name: '画布', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('html-studio-mobile.png'), fullPage: true });
});

test('works show content directly and conversation keeps a bottom composer with resizable preview', async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const sidebarTitle = `侧栏布局验收 ${crypto.randomUUID().slice(0, 6)}`;
  const response = await request.post('/api/html-projects', {
    data: {
      requestId: crypto.randomUUID(),
      brief: sidebarTitle,
      audience: '读者',
      sceneCount: 1,
      modelSelection: { provider: 'demo', model: 'local-sample' },
      sourceHtml:
        '<html><body style="margin:0;background:#f4f1e9;font-family:system-ui;display:grid;place-items:center;height:100vh"><h1>清晰的创作空间</h1></body></html>',
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByLabel('创作主题', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近项目' })).toHaveCount(0);
  await page.getByRole('button', { name: '作品', exact: true }).click();
  await expect(page.getByLabel('作品侧栏', { exact: true })).toBeVisible();
  await expect(page.getByLabel('创作主题', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `打开作品：${sidebarTitle}`, exact: true }).click();
  const library = page.locator('.library-sidebar');
  const preview = page.getByLabel('预览侧栏', { exact: true });
  await expect(preview).toBeVisible();
  const left = (await library.boundingBox())!;
  await expect(page.locator('.workspace-center')).toHaveCount(0);
  const works = (await page.getByLabel('作品页', { exact: true }).boundingBox())!;
  const right = (await preview.boundingBox())!;
  expect(right.x - left.x - left.width).toBe(6);
  expect(right.x + right.width).toBe(works.x + works.width);
  await expect(page.getByRole('tab', { name: '画布', exact: true })).toBeVisible();
  const leftHandle = page.getByRole('separator', { name: '调整作品侧栏宽度' });
  await leftHandle.press('ArrowRight');
  await expect(leftHandle).toHaveAttribute('aria-valuenow', String(Math.round(left.width + 24)));
  const grip = (await leftHandle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 150);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 80, grip.y + 150, { steps: 8 });
  await page.mouse.up();
  expect((await preview.boundingBox())!.width).toBeCloseTo(right.width - 104, 0);
  await page.reload();
  await expect(page.getByLabel('作品页', { exact: true })).toBeVisible();
  await expect(leftHandle).toHaveAttribute('aria-valuenow', String(Math.round(left.width + 104)));
  await page.getByRole('button', { name: '扩张预览侧栏', exact: true }).click();
  await expect(library).toBeHidden();
  expect((await preview.boundingBox())!.width).toBe(works.width);
  await page.getByRole('button', { name: '还原预览宽度', exact: true }).click();
  await expect(library).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('works-sidebars.png'), fullPage: true });
  await page.getByRole('button', { name: '继续对话', exact: true }).click();
  await expect(page.getByLabel('对话页', { exact: true })).toBeVisible();
  await expect(page.getByLabel('页面问题或修改要求')).toBeVisible();
  await expect(page.getByLabel('作品侧栏', { exact: true })).toHaveCount(0);
  const rightHandle = page.getByRole('separator', { name: '调整预览侧栏宽度' });
  const beforeResize = (await preview.boundingBox())!;
  await rightHandle.press('ArrowLeft');
  expect((await preview.boundingBox())!.width).toBe(beforeResize.width + 24);
  const followUp = (await page.locator('.scene-agent').boundingBox())!;
  expect(900 - followUp.y - followUp.height).toBeLessThanOrEqual(25);
  await page.getByRole('button', { name: '关闭预览侧栏', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: '展开预览侧栏', exact: true }).click();
  await expect(preview).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('conversation-preview.png'), fullPage: true });
  await page.getByRole('button', { name: '作品', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('作品侧栏', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `打开作品：${sidebarTitle}`, exact: true }).click();
  await expect(page.getByLabel('作品侧栏', { exact: true })).toHaveCount(0);
  await expect(preview).toBeVisible();
  expect((await preview.boundingBox())!.width).toBe(342);
  await page.screenshot({ path: testInfo.outputPath('works-mobile.png'), fullPage: true });
});

test('conversation history opens saved work, resizes alongside preview and collapses on mobile', async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const title = `对话历史验收 ${crypto.randomUUID().slice(0, 6)}`;
  const response = await request.post('/api/html-projects', {
    data: {
      requestId: crypto.randomUUID(),
      brief: title,
      audience: '读者',
      sceneCount: 1,
      modelSelection: { provider: 'demo', model: 'local-sample' },
      sourceHtml: '<html><body><h1>从历史继续创作</h1></body></html>',
    },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  await page.goto('/');
  const history = page.getByLabel('对话历史', { exact: true });
  await expect(history).toBeVisible();
  await expect(page.getByLabel('等待开始对话', { exact: true })).toBeVisible();
  await expect(history.getByRole('heading', { name: '今天', exact: true })).toBeVisible();
  await history.getByLabel('搜索对话历史').fill('不存在的记录-unique');
  await expect(history.getByText('没有匹配的对话')).toBeVisible();
  await history.getByLabel('搜索对话历史').fill(title);
  const saved = history.getByRole('button', { name: `打开对话：${title}`, exact: true });
  await expect(saved).toBeVisible();
  const handle = page.getByRole('separator', { name: '调整对话历史宽度' });
  await handle.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '264');
  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', '264');
  await history.getByRole('button', { name: '扩张对话历史', exact: true }).click();
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  await history.getByRole('button', { name: '还原对话历史宽度', exact: true }).click();
  await expect(handle).toHaveAttribute('aria-valuenow', '240');
  await saved.click();
  await expect(page).toHaveURL(new RegExp(`#project/${project.id}$`));
  await expect(saved).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.conversation-request')).toContainText(title);
  const preview = page.getByLabel('预览侧栏', { exact: true });
  await expect(preview).toBeVisible();
  await expect(page.getByRole('separator', { name: '调整预览侧栏宽度' })).toBeVisible();
  await page.getByRole('button', { name: '扩张预览侧栏', exact: true }).click();
  await expect(history).toBeHidden();
  expect((await preview.boundingBox())!.width).toBe(1536);
  await page.getByRole('button', { name: '还原预览宽度', exact: true }).click();
  await expect(history).toBeVisible();
  await history.getByRole('button', { name: '创建新对话', exact: true }).click();
  await expect(page.getByLabel('等待开始对话', { exact: true })).toBeVisible();
  await expect(saved).toBeVisible();
  await expect(preview).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('conversation-history-light.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(history.locator('.library-create')).toHaveCSS('background-color', 'rgb(32, 32, 32)');
  await page.screenshot({
    path: testInfo.outputPath('conversation-history-dark.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(history).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('conversation-empty-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '展开对话历史', exact: true }).click();
  await expect(history).toBeVisible();
  await saved.click();
  await expect(history).toHaveCount(0);
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: '关闭预览侧栏', exact: true }).click();
  await expect(page.getByLabel('页面问题或修改要求')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath('conversation-history-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('property panel resizes independently with mouse, keyboard and touch and remembers its width', async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await request.post('/api/html-projects', {
    data: {
      requestId: crypto.randomUUID(),
      brief: '属性面板宽度验收',
      audience: '读者',
      sceneCount: 1,
      modelSelection: { provider: 'demo', model: 'local-sample' },
      sourceHtml: '<html><body><h1>可调整的属性面板</h1></body></html>',
    },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('button', { name: '页面属性', exact: true }).click();
  const panel = page.getByLabel('创作属性', { exact: true });
  const separator = page.getByRole('separator', { name: '调整创作属性宽度' });
  const preview = page.getByLabel('预览侧栏', { exact: true });
  await expect(separator).toHaveAttribute('aria-valuenow', '240');
  const previewWidth = (await preview.boundingBox())!.width;
  const grip = (await separator.boundingBox())!;
  await page.mouse.move(grip.x + 4, grip.y + 180);
  await page.mouse.down();
  await page.mouse.move(grip.x - 96, grip.y + 180, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(340);
  expect((await preview.boundingBox())!.width).toBe(previewWidth);
  await separator.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '316');
  await separator.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', '340');
  await page.getByRole('button', { name: '项目风格', exact: true }).click();
  await expect(page.getByLabel('项目名称', { exact: true })).toBeVisible();
  expect((await panel.boundingBox())!.width).toBe(340);
  await page.getByRole('button', { name: '页面属性', exact: true }).click();
  await expect(separator).toHaveCount(0);
  await page.getByRole('button', { name: '页面属性', exact: true }).click();
  await expect(separator).toHaveAttribute('aria-valuenow', '340');
  await page.reload();
  await page.getByRole('button', { name: '页面属性', exact: true }).click();
  await expect(separator).toHaveAttribute('aria-valuenow', '340');
  await expect(page.getByLabel('页面标题', { exact: true })).toHaveValue('导入的 HTML');
  await separator.press('End');
  expect((await page.locator('.creative-canvas').boundingBox())!.width).toBeGreaterThanOrEqual(280);
  await separator.dblclick({ position: { x: 4, y: 180 } });
  await expect(separator).toHaveAttribute('aria-valuenow', '240');
  await page.screenshot({ path: testInfo.outputPath('resizable-properties-desktop.png') });

  // Exercise the overlay layout with real touch pointer events, including cancellation.
  await page.setViewportSize({ width: 390, height: 844 });
  const collapseHistory = page.getByRole('button', { name: '收起对话历史', exact: true });
  if (await collapseHistory.isVisible()) await collapseHistory.click();
  await expect(separator).toHaveAttribute('aria-valuenow', '240');
  const mobileGrip = (await separator.boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const point = { x: mobileGrip.x + 4, y: mobileGrip.y + 180 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await expect(page.locator('.forge-studio')).toHaveClass(/is-resizing/);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...point, x: point.x - 50 }],
  });
  await expect(separator).toHaveAttribute('aria-valuenow', '290');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.forge-studio')).not.toHaveClass(/is-resizing/);
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(290);
  const enlargedGrip = (await separator.boundingBox())!;
  const nextPoint = { x: enlargedGrip.x + 4, y: enlargedGrip.y + 180 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [nextPoint] });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...nextPoint, x: nextPoint.x + 30 }],
  });
  await expect(separator).toHaveAttribute('aria-valuenow', '260');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(page.locator('.forge-studio')).not.toHaveClass(/is-resizing/);
  await separator.press('End');
  expect((await panel.boundingBox())!.width).toBeLessThan((await preview.boundingBox())!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('resizable-properties-mobile.png') });
  await touch.detach();
  expect(errors).toEqual([]);
});

test('unchanged preview stays loaded when generation starts, polls and stops', async ({
  page,
  request,
}) => {
  await mockCommandWorker(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const result = await request.post('/api/html-projects', {
    data: {
      requestId: crypto.randomUUID(),
      brief: `预览稳定性 ${crypto.randomUUID().slice(0, 8)}`,
      audience: '读者',
      sceneCount: 2,
      modelSelection: { provider: 'demo', model: 'local-sample' },
      sourceHtml: '<html><body><h1>保留当前画面</h1></body></html>',
    },
  });
  expect(result.ok()).toBe(true);
  const saved: HtmlProject = await result.json();
  const pending = { ...saved.content.scenes[0]!, id: crypto.randomUUID(), html: '' };
  let current: HtmlProject = {
    ...saved,
    content: { ...saved.content, scenes: [...saved.content.scenes, pending] },
  };
  let reads = 0;
  let requestGate: Promise<void> | undefined;
  await page.route(`**/api/html-projects/${saved.id}`, async (route) => {
    reads++;
    await requestGate;
    return route.fulfill({ json: current });
  });
  await page.route(`**/api/html-projects/${saved.id}/runs`, async (route) => {
    await requestGate;
    current = {
      ...current,
      run: {
        id: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        action: 'build',
        sceneId: pending.id,
        status: 'running',
        completed: 0,
        total: 1,
        message: '正在生成下一页',
        modelSelection: saved.modelSelection,
        startedAt: new Date().toISOString(),
      },
    };
    return route.fulfill({ json: current });
  });
  await page.route(`**/api/html-projects/${saved.id}/cancel`, async (route) => {
    await requestGate;
    current = { ...current, run: { ...current.run!, status: 'cancelled' } };
    return route.fulfill({ json: current });
  });
  await page.goto(`/#project/${saved.id}`);
  async function checkNavigationDuringRequest(click: () => Promise<void>, stopping = false) {
    let release!: () => void;
    requestGate = new Promise<void>((resolve) => (release = resolve));
    try {
      await click();
      const historyItem = page.locator('.library-item').first();
      if (stopping) await expect(page.locator('.agent-composer-stop')).toBeDisabled();
      else await expect(historyItem).toBeDisabled();
      await expect(historyItem).toHaveCSS('opacity', '1');
      await expect(page.locator('.library-create')).toHaveCSS('opacity', '1');
      await expect(page.locator('.forge-brand')).toHaveCSS('opacity', '1');
      await expect(page.locator('.workspace-text-button').first()).toHaveCSS('opacity', '1');
    } finally {
      requestGate = undefined;
      release();
    }
    await expect(page.locator('.library-item').first()).toBeEnabled();
  }
  const preview = page.frameLocator('iframe[title="当前页面预览"]');
  await expect(preview.locator('h1')).toHaveText('保留当前画面');
  // A document reload removes this marker even if the iframe DOM node is reused.
  await preview.locator('body').evaluate((body) => (body.dataset.previewSession = 'retained'));
  const documentBefore = await page.locator('.scene-frame').getAttribute('srcdoc');
  await checkNavigationDuringRequest(() =>
    page.getByRole('button', { name: /生成未完成页面/ }).click(),
  );
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
  await expect(page.locator('.agent-composer-stop')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  await expect(preview.locator('body')).toHaveAttribute('data-preview-session', 'retained');
  const readsBefore = reads;
  await expect.poll(() => reads, { timeout: 10000 }).toBeGreaterThan(readsBefore + 1);
  await expect(preview.locator('body')).toHaveAttribute('data-preview-session', 'retained');
  await checkNavigationDuringRequest(
    () => page.getByRole('button', { name: '停止任务', exact: true }).click(),
    true,
  );
  await expect(page.locator('.response-status.cancelled')).toBeVisible();
  await expect(preview.locator('body')).toHaveAttribute('data-preview-session', 'retained');
  await expect(page.locator('.scene-frame')).toHaveAttribute('srcdoc', documentBefore!);
  await checkNavigationDuringRequest(() =>
    page.getByRole('button', { name: `打开对话：${saved.content.title}`, exact: true }).click(),
  );
  await expect(preview.locator('body')).toHaveAttribute('data-preview-session', 'retained');
});

test('generation feedback follows planning, progress, completion, cancellation and failure', async ({
  page,
  request,
}, testInfo) => {
  await mockCommandWorker(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const result = await request.post('/api/html-projects', {
    data: {
      requestId: crypto.randomUUID(),
      brief: '探索内容的下一种表达',
      audience: '读者',
      sceneCount: 3,
      modelSelection: { provider: 'demo', model: 'local-sample' },
      sourceHtml: '<html><body><h1>原始内容</h1><p>保留已经完成的作品</p></body></html>',
    },
  });
  expect(result.ok()).toBe(true);
  const saved: HtmlProject = await result.json();
  const scenes = [0, 1, 2].map((index) => ({
    ...saved.content.scenes[0]!,
    id: crypto.randomUUID(),
    title: ['灵感的起点', '让想法拥有形状', '连接下一种可能'][index]!,
    html: '',
  }));
  // Hold server states at the HTTP boundary so every visual lifecycle can be inspected.
  // Other HTML tests exercise actual demo generation and persistence.
  let current: HtmlProject = {
    ...saved,
    content: { ...saved.content, scenes: [] },
    run: {
      id: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      action: 'plan',
      status: 'running',
      completed: 0,
      total: 1,
      message: '正在规划故事结构与页面分镜…',
      modelSelection: saved.modelSelection,
      startedAt: new Date().toISOString(),
    },
  };
  await page.route(`**/api/html-projects/${saved.id}`, (route) => route.fulfill({ json: current }));
  await page.route(`**/api/html-projects/${saved.id}/runs`, async (route) => {
    const input = route.request().postDataJSON();
    current = {
      ...current,
      run: {
        ...current.run!,
        id: crypto.randomUUID(),
        action: input.action,
        sceneId: input.sceneId,
        status: 'running',
        completed: 0,
        total: 1,
        message: '正在调整页面内容与视觉布局…',
      },
    };
    await route.fulfill({ json: current });
  });
  await page.route(`**/api/html-projects/${saved.id}/cancel`, async (route) => {
    current = {
      ...current,
      run: { ...current.run!, status: 'cancelled', message: '已停止生成。' },
    };
    await route.fulfill({ json: current });
  });
  await page.goto(`/#project/${saved.id}`);
  const animation = page.getByLabel('生成动画', { exact: true });
  const loading = page.locator('.generation-status');
  const ambience = page.locator('.generation-ambience');
  await expect(animation).toBeVisible();
  await expect(loading).toHaveCount(1);
  await expect
    .poll(async () => Number(await ambience.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.04);
  expect(await ambience.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(
    await page.evaluate(() => {
      const background = document.querySelector('.generation-ambience')!;
      const orb = document.querySelector('.generation-status .loader')!;
      return getComputedStyle(background).filter === getComputedStyle(orb).filter;
    }),
  ).toBe(true);
  await expect(animation).toContainText('正在规划分镜');
  await expect(page.locator('.forge-brand')).not.toHaveClass(/is-generating/);
  await expect(animation.locator('.loader')).toHaveCSS('--color-one', '#ffbf48');
  await expect(animation.locator('.lava-shape').first()).not.toHaveCSS('animation-name', 'none');
  const maskIds = await page
    .locator('.generation-orb mask')
    .evaluateAll((masks) => masks.map((mask) => mask.id));
  expect(maskIds).toHaveLength(2);
  expect(new Set(maskIds).size).toBe(maskIds.length);
  await page.getByRole('button', { name: '关闭预览侧栏', exact: true }).click();
  await expect(loading).toHaveCount(1);
  await expect(page.locator('.conversation-response .generation-status')).toBeVisible();
  await page.getByRole('button', { name: '展开预览侧栏', exact: true }).click();
  await expect(animation).toBeVisible();
  await expect(loading).toHaveCount(1);
  await page.getByRole('tab', { name: '分镜总览', exact: true }).click();
  await expect(page.locator('.conversation-response .generation-status')).toBeVisible();
  await expect(loading).toHaveCount(1);
  await page.getByRole('button', { name: '扩张预览侧栏', exact: true }).click();
  await expect(page.locator('.run-progress .generation-status')).toBeVisible();
  await expect(loading).toHaveCount(1);
  await page.getByRole('tab', { name: '画布', exact: true }).click();
  await expect(animation).toBeVisible();
  await expect(loading).toHaveCount(1);
  await page.getByRole('button', { name: '还原预览宽度', exact: true }).click();
  await expect(animation).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('generation-planning.png'), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.forge-studio')).toHaveCSS('animation-name', 'none');
  await expect(ambience).toHaveCSS('filter', 'hue-rotate(0deg)');
  await expect(animation.locator('.loader')).toHaveCSS('animation-name', 'none');
  await expect(animation.locator('.lava-shape').first()).toHaveCSS('animation-name', 'none');
  await expect(animation.locator('animate')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(animation.locator('animate')).toHaveCount(1);
  current = {
    ...current,
    content: { ...current.content, scenes },
    run: { ...current.run!, action: 'build', sceneId: scenes[0]!.id, total: 3 },
  };
  await expect(page.locator('.conversation-scenes li')).toHaveCount(3);
  await expect(animation).toContainText('已完成 0 / 3 页');
  current = {
    ...current,
    content: {
      ...current.content,
      scenes: scenes.map((scene, index) => ({
        ...scene,
        html: index === 0 ? saved.content.scenes[0]!.html : '',
      })),
    },
    run: {
      ...current.run!,
      sceneId: scenes[1]!.id,
      completed: 1,
      message: '正在创作「让想法拥有形状」',
    },
  };
  await page.locator('.conversation-scenes li').nth(1).getByRole('button').click();
  await expect(animation).toContainText('已完成 1 / 3 页');
  await expect(animation).toContainText('让想法拥有形状');
  await page.locator('.conversation-scenes li').nth(0).getByRole('button').click();
  await expect(page.locator('.conversation-response .generation-status')).toBeVisible();
  await expect(loading).toHaveCount(1);
  await page.locator('.conversation-scenes li').nth(1).getByRole('button').click();
  await expect(animation).toBeVisible();
  await expect(loading).toHaveCount(1);
  await expect(animation).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('generation-dark.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: testInfo.outputPath('generation-light.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(loading).toHaveCount(1);
  await expect(animation).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('generation-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1440, height: 900 });
  current = {
    ...current,
    content: {
      ...current.content,
      scenes: scenes.map((scene) => ({ ...scene, html: saved.content.scenes[0]!.html })),
    },
    run: { ...current.run!, status: 'succeeded', completed: 3, message: '页面创作完成。' },
  };
  await expect(animation).toHaveCount(0);
  await expect(loading).toHaveCount(0);
  await expect(ambience).toHaveCSS('opacity', '0');
  await expect(page.frameLocator('iframe[title="当前页面预览"]').locator('h1')).toHaveText(
    '原始内容',
  );
  await expect(page.locator('.forge-brand')).not.toHaveClass(/is-generating/);
  // Exercise the generation lifecycle independently of the assistant's tool loop.
  const startScene = async () => {
    await page.evaluate(
      async ({ path, sceneId }) => {
        await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'scene', sceneId }),
        });
      },
      { path: `/api/html-projects/${saved.id}/runs`, sceneId: scenes[0]!.id },
    );
    await page.reload();
  };
  await startScene();
  await expect(animation).toContainText('正在打磨当前页');
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await expect(animation).toHaveCount(0);
  await expect(page.locator('.response-status.cancelled')).toContainText('已停止生成');
  await expect(ambience).toHaveCSS('opacity', '0');
  await expect(page.getByText('已停止生成。', { exact: true })).toHaveCount(1);
  await expect(page.frameLocator('iframe[title="当前页面预览"]').locator('h1')).toHaveText(
    '原始内容',
  );
  await startScene();
  await expect(animation).toBeVisible();
  current = {
    ...current,
    run: { ...current.run!, status: 'failed', message: '模型暂时不可用，请重试。' },
  };
  const failure = page.getByText('模型暂时不可用，请重试。', { exact: true });
  await expect(page.locator('.response-status.failed')).toContainText('模型暂时不可用');
  await expect(failure).toHaveCount(1);
  await expect(failure).toBeVisible();
  await expect(page.locator('.run-result.failed')).toHaveCount(0);
  await expect(animation).toHaveCount(0);
  await expect(ambience).toHaveCSS('opacity', '0');
  await expect(page.locator('.forge-brand')).not.toHaveClass(/is-generating/);

  await page.getByRole('button', { name: '扩张预览侧栏', exact: true }).click();
  await expect(page.locator('.run-result.failed')).toBeVisible();
  await expect(failure).toHaveCount(1);
  await page.getByRole('button', { name: '还原预览宽度', exact: true }).click();
  await expect(page.locator('.response-status.failed')).toBeVisible();
  await expect(failure).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('separator', { name: '调整预览侧栏宽度', exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('.run-result.failed')).toBeVisible();
  await expect(failure).toHaveCount(1);
  await page.getByRole('button', { name: '关闭预览侧栏', exact: true }).click();
  await expect(page.locator('.response-status.failed')).toBeVisible();
  await expect(failure).toHaveCount(1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '作品', exact: true }).click();
  await expect(page.locator('.run-result.failed')).toBeVisible();
  await expect(failure).toHaveCount(1);
});

test('ask current page returns advice, allows locked pages, retries errors and leaves the project unchanged', async ({
  page,
  request,
}, testInfo) => {
  await mockCommandWorker(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const created = await request.post('/api/html-projects', {
    data: {
      requestId: crypto.randomUUID(),
      brief: '分数教学',
      modelSelection: { provider: 'demo', model: 'local-sample' },
      sourceHtml: '<html><body><h1>保持这段内容</h1></body></html>',
    },
  });
  const original = await created.json();
  original.content.scenes[0].locked = true;
  original.content.scenes.push({
    ...original.content.scenes[0],
    id: crypto.randomUUID(),
    title: '第二页分数案例',
    html: '',
    objective: '理解整体与部分的关系',
  });
  const path = `/api/html-projects/${original.id}`;
  const saved = await (
    await request.patch(path, {
      data: {
        expectedRevision: original.revision,
        operationId: crypto.randomUUID(),
        content: original.content,
      },
    })
  ).json();
  await page.goto(`/#project/${saved.id}`);
  const askSwitch = page.getByRole('switch', { name: '询问模式', exact: true });
  await expect(askSwitch).not.toBeChecked();
  await askSwitch.click();
  await expect(askSwitch).toBeChecked();
  const input = page.getByLabel('当前页问题', { exact: true });
  const send = page.getByRole('button', { name: '发送当前页问题', exact: true });
  await input.fill('这页讲了什么？有什么可以改进的地方？');
  await expect(send).toBeEnabled();
  let failedInput: AskHtmlScene | undefined;
  await page.route(`**${path}/conversation`, (route) =>
    failedInput
      ? route.fulfill({
          json: {
            id: saved.id,
            projectId: saved.id,
            messages: [],
            pending: {
              requestId: failedInput.requestId,
              input: failedInput,
              status: 'interrupted',
              startedAt: new Date().toISOString(),
              error: '模型暂时不可用，请重试',
            },
          },
        })
      : route.continue(),
  );
  await page.route(`**${path}/questions`, (route) => {
    failedInput = route.request().postDataJSON();
    return route.fulfill({ status: 503, json: { error: { message: '模型暂时不可用，请重试' } } });
  });
  await send.click();
  await expect(page.getByLabel('待处理消息')).toContainText('模型暂时不可用');
  await expect(page.locator('.reply-failure')).toHaveCount(1);
  await expect(page.locator('.studio-alert')).toHaveCount(0);
  await expect(page.locator('.page-consultation')).toHaveCount(0);
  await expect(page.locator('.reply-failure-detail p')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('reply-failure-light.png'), fullPage: true });
  await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试发送', exact: true })).toHaveCSS(
    'background-color',
    'rgb(32, 32, 32)',
  );
  await page.screenshot({ path: testInfo.outputPath('reply-failure-dark.png'), fullPage: true });
  await page.locator('.scene-agent').screenshot({
    path: testInfo.outputPath('reply-failure-detail-dark.png'),
    animations: 'disabled',
  });
  await page.getByText('查看详情', { exact: true }).click();
  await expect(page.locator('.reply-failure-detail p')).toBeVisible();
  await expect(input).toBeEmpty();
  await page.unroute(`**${path}/questions`);
  await page.unroute(`**${path}/conversation`);
  await page.getByRole('button', { name: '重试发送', exact: true }).click();
  await expect(page.locator('.consultation-answer').last()).toContainText('未调用 AI');
  await expect(input).toBeEmpty();
  expect(await (await request.get(path)).json()).toEqual(saved);
  await page.locator('.conversation-scenes li').nth(1).getByRole('button').click();
  await input.fill('这页的目标是什么？');
  const questionRequest = page.waitForRequest((req) => req.url().endsWith('/questions'));
  await input.press('Control+Enter');
  expect((await questionRequest).postDataJSON().sceneId).toBe(saved.content.scenes[1].id);
  await expect(page.locator('.consultation-answer').last()).toContainText('理解整体与部分的关系');
  expect(await (await request.get(path)).json()).toEqual(saved);
  const transcript = await (await request.get(`${path}/conversation`)).json();
  expect(transcript.projectId).toBe(saved.id);
  expect(transcript.messages.map((message: { role: string }) => message.role)).toEqual([
    'user',
    'assistant',
    'user',
    'assistant',
  ]);
  await page.reload();
  await expect(page.locator('.page-consultation')).toHaveCount(2);
  await expect(page.locator('.consultation-question').first()).toHaveText(
    '这页讲了什么？有什么可以改进的地方？',
  );
  await askSwitch.click();
  await input.fill('你刚才说的例子，具体举一个。');
  await send.click();
  await expect(input).toBeEmpty();
  await expect(page.locator('.page-consultation')).toHaveCount(3);
  await page.locator('.consultation-answer').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('ask-current-page.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('ask-current-page-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '关闭预览侧栏', exact: true }).click();
  await expect(askSwitch).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath('ask-current-page-mobile-switch.png'),
    fullPage: true,
  });
  await askSwitch.focus();
  await askSwitch.press('Space');
  await expect(askSwitch).not.toBeChecked();
  await expect(page.getByLabel('页面问题或修改要求', { exact: true })).toBeVisible();
});

test('session context menu duplicates, archives, restores and deletes conversations', async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const title = `菜单验收 ${crypto.randomUUID().slice(0, 6)}`;
  const created = await request.post('/api/html-projects', {
    data: {
      requestId: crypto.randomUUID(),
      brief: title,
      modelSelection: { provider: 'demo', model: 'local-sample' },
      sourceHtml: '<html><body><h1>会话副本测试</h1></body></html>',
    },
  });
  expect(created.ok()).toBe(true);
  const original = await created.json();
  await page.goto(`/#project/${original.id}`);
  const library = page.getByLabel('对话历史', { exact: true });
  await library.getByLabel('搜索对话历史').fill(title);
  const row = library.getByRole('button', { name: `打开对话：${title}`, exact: true });
  await row.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '会话操作' });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('session-menu.png') });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await menu.getByRole('menuitem', { name: '复制会话' }).click();
  const copy = library.getByRole('button', { name: `打开对话：${title}（副本）`, exact: true });
  await expect(copy).toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(original.id));
  await row.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '归档会话', exact: true }).click();
  await expect(row).toBeHidden();
  await library.getByRole('button', { name: '已归档', exact: true }).click();
  await expect(row).toBeVisible();
  await page.reload();
  await library.getByRole('button', { name: '已归档', exact: true }).click();
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '取消归档' }).click();
  await expect(row).toBeHidden();
  await library.getByRole('button', { name: '全部会话', exact: true }).click();
  await expect(row).toBeVisible();
  await copy.click();
  await copy.click({ button: 'right' });
  page.once('dialog', (dialog) => dialog.dismiss());
  await menu.getByRole('menuitem', { name: '删除会话' }).click();
  await expect(copy).toBeVisible();
  await copy.click({ button: 'right' });
  page.once('dialog', (dialog) => dialog.accept());
  await menu.getByRole('menuitem', { name: '删除会话' }).click();
  await expect(copy).toBeHidden();
  await expect(page).not.toHaveURL(/#project/);
  await page.reload();
  await expect(copy).toBeHidden();
  await expect(row).toBeVisible();
  const current = await (await request.get(`/api/html-projects/${original.id}`)).json();
  await request.delete(`/api/html-projects/${original.id}`, {
    data: { expectedRevision: current.revision },
  });
});

test('unified assistant refreshes cross-page tool edits, keeps selected page and supports undo', async ({
  page,
  request,
}, testInfo) => {
  await mockCommandWorker(page);
  const original = await (
    await request.post('/api/html-projects', {
      data: {
        requestId: crypto.randomUUID(),
        brief: '分数教学工具调用验证',
        modelSelection: { provider: 'demo', model: 'local-sample' },
        sourceHtml: '<html><body><h1>第一页面</h1></body></html>',
      },
    })
  ).json();
  original.content.scenes[0].locked = true;
  original.content.scenes.push({
    ...original.content.scenes[0],
    id: crypto.randomUUID(),
    title: '分数案例',
    locked: false,
    html: '<html><body><h1>分数案例</h1></body></html>',
  });
  const path = `/api/html-projects/${original.id}`;
  const saved = await (
    await request.patch(path, {
      data: {
        expectedRevision: original.revision,
        operationId: crypto.randomUUID(),
        content: original.content,
      },
    })
  ).json();
  // Model boundary fixture: persist the edit through the real repository API and
  // return the same project+transcript envelope as the tool-backed conversation.
  await page.route(`**${path}/questions`, async (route) => {
    const input = route.request().postDataJSON();
    expect(input.allowEdits).toBe(true);
    expect(input.sceneId).toBe(saved.content.scenes[0].id);
    expect(input.expectedRevision).toBe(saved.revision);
    const content = structuredClone(saved.content);
    content.scenes[1].title = '分数的日常应用';
    content.scenes[1].html = '<html><body><h1>分数的日常应用</h1></body></html>';
    const updated = await (
      await request.patch(path, {
        data: { expectedRevision: saved.revision, operationId: crypto.randomUUID(), content },
      })
    ).json();
    const result = await (
      await request.post(`${path}/questions`, {
        data: { ...input, allowEdits: false, expectedRevision: updated.revision },
      })
    ).json();
    result.answer = '已将第二页标题修改为“分数的日常应用”。';
    result.conversation.messages.at(-1).content = result.answer;
    await route.fulfill({ json: { ...result, project: updated } });
  });
  await page.goto(`/#project/${saved.id}`);
  await page
    .getByLabel('页面问题或修改要求', { exact: true })
    .fill('把第二页标题改成“分数的日常应用”');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.consultation-answer').last()).toContainText('已将第二页标题修改');
  await expect(page.locator('.conversation-scenes li').nth(1)).toContainText('分数的日常应用');
  await expect(page.frameLocator('iframe[title="当前页面预览"]').locator('h1')).toHaveText(
    '第一页面',
  );
  await page.locator('.conversation-scenes li').nth(1).getByRole('button').click();
  await expect(page.frameLocator('iframe[title="当前页面预览"]').locator('h1')).toHaveText(
    '分数的日常应用',
  );
  await page.screenshot({
    path: testInfo.outputPath('tool-calling-cross-page.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.frameLocator('iframe[title="当前页面预览"]').locator('h1')).toHaveText(
    '分数案例',
  );
  expect((await (await request.get(path)).json()).content).toEqual(saved.content);
});

test('personal prompt persists, cancels drafts, toggles off and travels with creation', async ({
  page,
}, testInfo) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/html-projects', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 400, json: { message: '测试已记录请求' } });
  });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: /我的 Prompt/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '我的创作 Prompt' });
  const input = page.getByLabel('自定义 Prompt', { exact: true });
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: '教学讲解 ＋' }).click();
  await expect(input).toHaveValue(/初学者/);
  const prompt = '使用暖白底色、深灰文字。以生活中的例子讲清楚概念，每页只讲一个重点。';
  await input.fill(prompt);
  await page.screenshot({ path: testInfo.outputPath('custom-prompt-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '保存偏好', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toContainText('已启用');
  await page.screenshot({ path: testInfo.outputPath('custom-prompt-toolbar.png'), fullPage: true });
  await page.reload();
  await trigger.click();
  await expect(input).toHaveValue(prompt);
  await input.fill('取消的草稿');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await trigger.click();
  await expect(input).toHaveValue(prompt);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByLabel('创作主题', { exact: true }).fill('分数入门');
  const send = page.getByRole('button', { name: '开始规划分镜', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => submitted?.customPrompt).toBe(prompt);
  await trigger.click();
  await page.getByLabel('新作品自动使用我的 Prompt').uncheck();
  await page.getByRole('button', { name: '保存偏好', exact: true }).click();
  await expect(trigger).toContainText('已停用');
  submitted = undefined;
  await send.click();
  await expect.poll(() => submitted?.brief).toBe('分数入门');
  expect(submitted).not.toHaveProperty('customPrompt');
  await page.reload();
  await expect(trigger).toContainText('已停用');
  await trigger.click();
  await expect(input).toHaveValue(prompt);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('custom-prompt-mobile-dark.png'),
    fullPage: true,
  });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '清空内容', exact: true }).click();
  await page.getByRole('button', { name: '保存偏好', exact: true }).click();
  await expect(trigger).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('custom-prompt-toolbar-mobile.png'),
    fullPage: true,
  });
  await trigger.click();
  await expect(input).toBeEmpty();
});

test('restores a running conversation after reload, stops it and resumes the original question', async ({
  page,
  request,
}) => {
  const project = await (
    await request.post('/api/html-projects', {
      data: {
        requestId: crypto.randomUUID(),
        brief: '中断恢复测试',
        modelSelection: { provider: 'demo', model: 'local-sample' },
        sourceHtml: '<html><body><h1>恢复对话</h1></body></html>',
      },
    })
  ).json();
  const path = `/api/html-projects/${project.id}`;
  const requestId = crypto.randomUUID();
  const input = {
    requestId,
    expectedRevision: project.revision,
    sceneId: project.content.scenes[0].id,
    question: '中断后继续解释这一页',
    allowEdits: false,
    modelSelection: project.modelSelection,
  };
  const transcript = {
    id: project.id,
    projectId: project.id,
    messages: [],
    pending: {
      requestId,
      input,
      status: 'running',
      startedAt: new Date().toISOString(),
      error: '',
    },
  };
  await page.route(`**${path}/conversation`, (route) => route.fulfill({ json: transcript }));
  await page.route(`**${path}/conversation/stop`, (route) => {
    transcript.pending.status = 'interrupted';
    transcript.pending.error = '回复已停止，可继续回复';
    return route.fulfill({ json: transcript });
  });
  await page.route(`**${path}/commands`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    transcript.pending!.status = 'interrupted';
    transcript.pending!.error = '回复已停止，可继续回复';
    await route.fulfill({ json: [] });
  });
  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.consultation-question').last()).toHaveText(input.question);
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await expect(page.locator('.reply-failure')).toContainText('回复已停止');
  await page.route(`**${path}/questions`, async (route) => {
    expect(route.request().postDataJSON()).toEqual(input);
    await page.unroute(`**${path}/conversation`);
    await route.continue();
  });
  await page.getByRole('button', { name: '继续回复', exact: true }).click();
  await expect(page.locator('.consultation-answer').last()).toContainText('未调用 AI');
  await expect(page.locator('.page-consultation')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.page-consultation')).toHaveCount(1);
  const saved = await (await request.get(`${path}/conversation`)).json();
  expect(saved.pending).toBeUndefined();
  expect(saved.messages[0].id).toBe(requestId);
});

test('recovers a committed reply when its HTTP response is lost', async ({ page, request }) => {
  const project = await (
    await request.post('/api/html-projects', {
      data: {
        requestId: crypto.randomUUID(),
        brief: '回复丢失测试',
        modelSelection: { provider: 'demo', model: 'local-sample' },
        sourceHtml: '<html><body>测试页面</body></html>',
      },
    })
  ).json();
  const path = `/api/html-projects/${project.id}`;
  await page.goto(`/#project/${project.id}`);
  await page.route(`**${path}/commands`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch();
    await route.abort('connectionreset');
  });
  await page.getByLabel('页面问题或修改要求', { exact: true }).fill('解释这个页面');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.consultation-answer').last()).toContainText('未调用 AI');
  await expect(page.getByLabel('页面问题或修改要求', { exact: true })).toBeEmpty();
  expect((await (await request.get(`${path}/conversation`)).json()).messages).toHaveLength(2);
});

test('page conversation renders task results and Markdown after reload', async ({
  page,
  request,
}, testInfo) => {
  await mockCommandWorker(page);
  const project: HtmlProject = await (
    await request.post('/api/html-projects', {
      data: {
        requestId: crypto.randomUUID(),
        brief: '多步任务界面验证',
        modelSelection: { provider: 'demo', model: 'local-sample' },
        sourceHtml: '<html><body><h1>多步任务</h1></body></html>',
      },
    })
  ).json();
  const path = `/api/html-projects/${project.id}`;
  let transcript: import('@studio/contracts').Conversation = {
    id: project.id,
    projectId: project.id,
    messages: [],
  };
  await page.route(`**${path}/conversation`, (route) => route.fulfill({ json: transcript }));
  await page.route(`**${path}/questions`, async (route) => {
    const input = route.request().postDataJSON();
    expect(input.multiStep).toBeUndefined();
    expect(input.allowEdits).toBe(true);
    expect(input.question).toContain('统一标题表达');
    const task = {
      phase: 'completed' as const,
      steps: [
        {
          sceneId: input.sceneId,
          title: '多步任务',
          instruction:
            '- **title**：统一表达\n- **content**：补充示例\n  - 保留已有内容\n- **example**：补充一个具体示例\n- **preservation**：保留风格\n\n> 保持现有风格',
          status: 'succeeded' as const,
        },
      ],
    };
    transcript = {
      id: project.id,
      projectId: project.id,
      messages: [
        {
          id: input.requestId,
          role: 'user',
          content: input.question,
          sceneId: input.sceneId,
          createdAt: new Date().toISOString(),
        },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            '## 优化结果\n\n已完成**整稿优化**。\n\n```html\n<h1>示例</h1>\n```\n\n| 页面 | 状态 |\n| --- | --- |\n| 首页 | 已更新 |',
          sceneId: input.sceneId,
          createdAt: new Date().toISOString(),
          task,
        },
      ],
    };
    await route.fulfill({
      json: {
        answer: '已完成整稿优化。',
        conversation: transcript,
        sceneId: input.sceneId,
        revision: project.revision,
        modelSelection: project.modelSelection,
      },
    });
  });
  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('button', { name: '多步任务', exact: true })).toHaveCount(0);
  await page
    .getByLabel('页面问题或修改要求', { exact: true })
    .fill('统一标题表达，为核心概念补充一个具体示例。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByLabel('多步任务进度')).toContainText('页面处理完成');
  await page.reload();
  await expect(page.getByLabel('多步任务进度')).toContainText('已检查 1 页');
  await expect(page.locator('.task-instruction')).toBeHidden();
  await page.getByText('查看处理详情', { exact: true }).click();
  const instructions = page.locator('.task-instruction');
  await expect(instructions.locator('strong')).toHaveText(['标题', '内容', '示例', '保留内容']);
  await expect(instructions.locator('ul ul li')).toHaveText('保留已有内容');
  await expect(instructions.locator('blockquote')).toContainText('保持现有风格');
  await expect(page.locator('.consultation-answer h2')).toHaveText('优化结果');
  await expect(page.locator('.consultation-answer pre code')).toContainText('<h1>示例</h1>');
  await expect(page.locator('.consultation-answer table')).toContainText('已更新');
  await page.getByLabel('多步任务进度').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('multi-step-markdown-light.png'),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({
    path: testInfo.outputPath('multi-step-markdown-dark.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '关闭预览侧栏', exact: true }).click();
  await page.getByLabel('多步任务进度').scrollIntoViewIfNeeded();
  await expect(instructions).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('multi-step-markdown-mobile.png'),
    fullPage: true,
  });
  // Existing saved summaries use the compact result too, without a duplicate Markdown report.
  const answer = transcript.messages[1]!;
  const step = answer.task!.steps[0]!;
  answer.task!.steps = Array.from({ length: 10 }, (_, index) => ({
    ...step,
    sceneId: crypto.randomUUID(),
    title: `${index + 1}. 红楼梦：人物、叙事与生活中的启示`,
    status: index === 9 ? 'unchanged' : 'succeeded',
  }));
  answer.content = '**多步任务已完成**\n\n已检查 10 页的字段与 HTML 文档结构。';
  await page.reload();
  await page.getByRole('button', { name: '关闭预览侧栏', exact: true }).click();
  const result = page.getByLabel('多步任务进度');
  await expect(result).toBeVisible();
  await expect(result).toContainText('更新 9 页');
  await expect(result).toContainText('修改已统一保存，可一次撤销。');
  await expect(page.locator('.consultation-answer')).toHaveCount(0);
  await expect(result.locator('ol')).toBeHidden();
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('task-result-mobile.png'), fullPage: true });
  await result.getByText('查看处理详情', { exact: true }).click();
  await expect(result.locator('ol > li')).toHaveCount(10);
  expect(await result.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('task-result-mobile-expanded.png'),
    fullPage: true,
  });
  await result.getByText('查看处理详情', { exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('task-result-light.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('task-result-dark.png'), fullPage: true });
  await result.screenshot({ path: testInfo.outputPath('task-result-card.png') });
  await result.getByText('查看处理详情', { exact: true }).click();
  await expect(result.locator('ol > li')).toHaveCount(10);
  await expect(result.getByText('无需变更', { exact: true })).toBeVisible();
  // No-op tasks must not claim that changes were saved.
  answer.task!.steps.forEach((item) => {
    item.status = 'unchanged';
  });
  await page.reload();
  await expect(result).toContainText('内容无需变更');
  await expect(result).toContainText('页面内容未发生变化。');
  await expect(result).not.toContainText('已保存');
});

test('multi-step progress survives reload and stopping offers an explicit full retry', async ({
  page,
  request,
}, testInfo) => {
  const project: HtmlProject = await (
    await request.post('/api/html-projects', {
      data: {
        requestId: crypto.randomUUID(),
        brief: '多步任务停止验证',
        modelSelection: { provider: 'demo', model: 'local-sample' },
        sourceHtml: '<html><body><h1>多步任务</h1></body></html>',
      },
    })
  ).json();
  const path = `/api/html-projects/${project.id}`;
  const input = {
    requestId: crypto.randomUUID(),
    sceneId: project.content.scenes[0]!.id,
    question: '补充示例并统一标题',
    expectedRevision: project.revision,
    multiStep: true,
    allowEdits: true,
    modelSelection: project.modelSelection,
  };
  const transcript: import('@studio/contracts').Conversation = {
    id: project.id,
    projectId: project.id,
    messages: [],
    pending: {
      requestId: input.requestId,
      input,
      status: 'running',
      startedAt: new Date().toISOString(),
      task: {
        phase: 'executing',
        steps: [
          {
            sceneId: input.sceneId,
            title: '多步任务',
            instruction: input.question,
            status: 'running',
          },
        ],
      },
    },
  };
  await page.route(`**${path}/conversation`, (route) => route.fulfill({ json: transcript }));
  await page.route(`**${path}/conversation/stop`, (route) => {
    transcript.pending!.status = 'interrupted';
    transcript.pending!.error = '任务已停止';
    return route.fulfill({ json: transcript });
  });
  await page.route(`**${path}/commands`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    transcript.pending!.status = 'interrupted';
    transcript.pending!.error = '回复已停止，可继续回复';
    await route.fulfill({ json: [] });
  });
  await page.goto(`/#project/${project.id}`);
  await expect(page.getByLabel('多步任务进度')).toContainText('正在逐页执行');
  await page.reload();
  await expect(page.getByLabel('多步任务进度')).toContainText(input.question);
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await expect(page.getByLabel('多步任务进度')).toContainText('本次修改尚未保存');
  await expect(page.getByRole('button', { name: '重新执行任务', exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('multi-step-interrupted.png'),
    fullPage: true,
  });
});

for (const responseMode of ['option', 'manual', 'delegate'] as const) {
  test(`generation uses default tasks and accepts ${responseMode} clarification`, async ({
    page,
    request,
  }, testInfo) => {
    const project: HtmlProject = await (
      await request.post('/api/html-projects', {
        data: {
          requestId: crypto.randomUUID(),
          brief: '面向小学生解释分数',
          sceneCount: 3,
          modelSelection: { provider: 'demo', model: 'local-sample' },
        },
      })
    ).json();
    const path = `/api/html-projects/${project.id}`;
    await request.post(`${path}/runs`, {
      data: { action: 'plan', requestId: crypto.randomUUID(), expectedRevision: project.revision },
    });
    await page.goto(`/#project/${project.id}`);
    await expect(page.locator('.conversation-scenes li')).toHaveCount(3);
    let attempts = 0;
    await page.route(`**${path}/runs`, async (route) => {
      const input = route.request().postDataJSON();
      expect(input.action).toBe('build');
      if (++attempts > 1) {
        expect(input.instruction).toContain(
          responseMode === 'option' ? '三年级' : responseMode === 'manual' ? '五年级' : '自行判断',
        );
        return route.continue();
      }
      expect(input.instruction).toBe('');
      const current: HtmlProject = await (await request.get(path)).json();
      return route.fulfill({
        json: {
          ...current,
          run: {
            id: crypto.randomUUID(),
            requestId: input.requestId,
            action: 'build',
            status: 'awaiting_input',
            completed: 0,
            total: 3,
            message: '需要确认教学年级',
            modelSelection: current.modelSelection,
            startedAt: new Date().toISOString(),
            task: { phase: 'planning', steps: [] },
            clarification: {
              question: '分苹果的例子面向哪个年级？',
              options: [
                {
                  label: '三年级：认识几分之一',
                  instruction: '面向三年级，用分苹果解释几分之一。',
                },
              ],
            },
          },
        },
      });
    });
    await page.getByRole('button', { name: '生成未完成页面', exact: true }).click();
    await expect(page.getByLabel('生成前确认')).toContainText('分苹果的例子面向哪个年级');
    await expect(page.getByRole('button', { name: '多步任务', exact: true })).toHaveCount(0);
    await page.getByLabel('生成前确认').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`generation-question-${responseMode}.png`),
      fullPage: true,
    });
    if (responseMode === 'manual') {
      await page.getByLabel('页面生成要求', { exact: true }).fill('面向五年级，比较异分母分数');
      await page.getByRole('button', { name: '发送页面生成要求', exact: true }).click();
    } else
      await page
        .getByRole('button', {
          name: responseMode === 'option' ? '三年级：认识几分之一' : '交给 AI 判断',
          exact: true,
        })
        .click();
    await expect(page.getByLabel('多步任务进度')).toContainText('全部步骤已保存', {
      timeout: 20000,
    });
    await expect(page.getByLabel('多步任务进度')).toContainText('3 / 3 步');
    await expect(page.getByLabel('生成前确认')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`default-generation-${responseMode}.png`),
      fullPage: true,
    });
  });
}

test('composer clears immediately and sends appended questions in order without erasing a new draft', async ({
  page,
  request,
}) => {
  await mockCommandWorker(page);
  const created = await request.post('/api/html-projects', {
    data: {
      requestId: crypto.randomUUID(),
      brief: '连续发送测试',
      modelSelection: { provider: 'demo', model: 'local-sample' },
      sourceHtml: '<html><body><h1>连续发送</h1></body></html>',
    },
  });
  const project = await created.json();
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const questions: string[] = [];
  await page.route(`**/api/html-projects/${project.id}/questions`, async (route) => {
    questions.push(route.request().postDataJSON().question);
    if (questions.length === 1) await firstGate;
    await route.continue();
  });
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('switch', { name: '询问模式', exact: true }).click();
  const input = page.getByLabel('当前页问题', { exact: true });
  const send = page.getByRole('button', { name: '发送当前页问题', exact: true });
  await input.fill('第一个问题');
  await send.click();
  await expect(input).toBeEmpty();
  await expect.poll(() => questions.length).toBe(1);
  await expect(input).toBeEnabled();
  await input.fill('第二个问题');
  await send.click();
  await expect(input).toBeEmpty();
  await input.fill('第三个问题');
  await input.press('Control+Enter');
  await expect(input).toBeEmpty();
  await expect(page.getByLabel('待处理消息')).toContainText('第二个问题');
  await expect(page.getByLabel('待处理消息')).toContainText('第三个问题');
  expect(questions).toEqual(['第一个问题']);
  await input.fill('尚未发送的草稿');
  releaseFirst();
  await expect(page.locator('.page-consultation')).toHaveCount(3);
  await expect(page.getByLabel('待处理消息')).toHaveCount(0);
  expect(questions).toEqual(['第一个问题', '第二个问题', '第三个问题']);
  await expect(input).toHaveValue('尚未发送的草稿');
});

test('planning accepts additional requirements and keeps them in the brief in send order', async ({
  page,
  request,
}) => {
  let releasePlan!: () => void;
  const gate = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });
  let runs = 0;
  await page.route('**/api/html-projects/*/runs', async (route) => {
    runs++;
    if (runs === 1) await gate;
    await route.continue();
  });
  await page.goto('/');
  await page.getByLabel('创作主题', { exact: true }).fill('Claude 的发展史');
  await page.getByRole('button', { name: '开始规划分镜' }).click();
  const input = page.getByLabel('创作要求', { exact: true });
  const send = page.getByRole('button', { name: '发送创作要求并重新规划', exact: true });
  await expect(input).toBeEnabled();
  await expect(input).toBeEmpty();
  await input.fill('面向初中生');
  await send.click();
  await expect(input).toBeEmpty();
  await input.fill('增加发展时间线');
  await input.press('Control+Enter');
  await expect(input).toBeEmpty();
  await expect(page.getByLabel('待处理消息')).toContainText('面向初中生');
  expect(runs).toBe(1);
  await input.fill('未发送的补充草稿');
  releasePlan();
  await expect(page.getByLabel('待处理消息')).toHaveCount(0, { timeout: 20000 });
  expect(runs).toBe(1);
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('页面问题或修改要求', { exact: true })).toHaveValue(
    '未发送的补充草稿',
  );
  const id = new URL(page.url()).hash.split('/')[1];
  const saved = await (await request.get(`/api/html-projects/${id}`)).json();
  expect(saved.content.brief).toBe(
    'Claude 的发展史\n\n补充要求：面向初中生\n\n补充要求：增加发展时间线',
  );
});

for (const timing of ['after', 'interrupt'] as const) {
  test(`supplements keep the current task goal with ${timing} delivery`, async ({
    page,
    request,
  }, testInfo) => {
    await mockCommandWorker(page);
    const project = await (
      await request.post('/api/html-projects', {
        data: {
          requestId: crypto.randomUUID(),
          brief: '任务补充测试',
          modelSelection: { provider: 'demo', model: 'local-sample' },
          sourceHtml: '<html><body><h1>任务补充</h1></body></html>',
        },
      })
    ).json();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inputs: Record<string, unknown>[] = [];
    let stops = 0;
    page.on('request', (req) => {
      if (req.url().endsWith('/conversation/stop')) stops++;
    });
    await page.route(`**/api/html-projects/${project.id}/questions`, async (route) => {
      inputs.push(route.request().postDataJSON());
      if (inputs.length === 1) {
        await gate;
        if (timing === 'interrupt') {
          await route.abort().catch(() => {});
          return;
        }
      }
      await route.continue();
    });
    await page.goto(`/#project/${project.id}`);
    await page.getByRole('switch', { name: '询问模式', exact: true }).click();
    const input = page.getByLabel('当前页问题', { exact: true });
    const send = page.getByRole('button', { name: '发送当前页问题', exact: true });
    await input.fill('分析整份作品的教学结构');
    await send.click();
    await expect.poll(() => inputs.length).toBe(1);
    await input.fill('重点关注适合三年级的部分');
    await send.click();
    await expect(input).toBeEmpty();
    await expect(page.getByLabel('待处理消息')).toContainText('重点关注适合三年级的部分');
    if (timing === 'interrupt') {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({
        path: testInfo.outputPath('queued-composer-dark.png'),
        fullPage: true,
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: '关闭预览侧栏', exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      await page.screenshot({
        path: testInfo.outputPath('queued-composer-mobile.png'),
        fullPage: true,
        animations: 'disabled',
      });
      await page.getByRole('button', { name: '引导', exact: true }).click();
    }
    if (timing === 'after') {
      await input.fill('删除这条消息');
      await send.click();
      const removable = page.locator('.agent-queued-message').filter({ hasText: '删除这条消息' });
      await removable.getByRole('button', { name: '删除待追加消息', exact: true }).click();
      await expect(removable).toHaveCount(0);
      await input.fill('移回这条消息');
      await send.click();
      const editable = page.locator('.agent-queued-message').filter({ hasText: '移回这条消息' });
      await input.fill('未发送的草稿');
      await editable.getByRole('button', { name: '更多消息操作', exact: true }).click();
      await page.getByRole('menuitem', { name: '移回输入框', exact: true }).click();
      await expect(input).toHaveValue('未发送的草稿\n移回这条消息');
      await expect(editable).toHaveCount(0);
      expect(inputs).toHaveLength(1);
      expect(stops).toBe(0);
      release();
    }
    await expect.poll(() => inputs.length).toBe(2);
    expect(inputs[1]).toMatchObject({
      question: '重点关注适合三年级的部分',
      allowEdits: false,
      continuation: { action: 'conversation', goal: '分析整份作品的教学结构', timing },
    });
    expect(stops).toBe(timing === 'interrupt' ? 1 : 0);
    release();
    await expect(page.getByLabel('待处理消息')).toHaveCount(0);
    const transcript = await (
      await request.get(`/api/html-projects/${project.id}/conversation`)
    ).json();
    expect(transcript.messages.at(-2).continuation).toEqual(inputs[1]!.continuation);
    expect(
      transcript.messages.filter((message: { role: string }) => message.role === 'user'),
    ).toHaveLength(timing === 'interrupt' ? 1 : 2);
  });
}

test('interrupting generation continues remaining pages with the original goal and supplemental requirement', async ({
  page,
  request,
}, testInfo) => {
  await mockCommandWorker(page);
  let project: HtmlProject = await (
    await request.post('/api/html-projects', {
      data: {
        requestId: crypto.randomUUID(),
        brief: '分数教学',
        modelSelection: { provider: 'demo', model: 'local-sample' },
        sourceHtml: '<html><body><h1>已完成的第一页</h1></body></html>',
      },
    })
  ).json();
  const firstHtml = project.content.scenes[0]!.html;
  project.content.scenes.push({
    ...project.content.scenes[0]!,
    id: crypto.randomUUID(),
    title: '尚未完成的第二页',
    html: '',
  });
  project = await (
    await request.patch(`/api/html-projects/${project.id}`, {
      data: {
        expectedRevision: project.revision,
        operationId: crypto.randomUUID(),
        content: project.content,
      },
    })
  ).json();
  const activeProject: HtmlProject = {
    ...project,
    run: {
      id: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      action: 'build',
      status: 'running',
      instruction: '用分苹果解释分数',
      completed: 1,
      total: 2,
      message: '正在生成第二页',
      modelSelection: project.modelSelection,
      startedAt: new Date().toISOString(),
    },
  };
  let cancelled = false;
  await page.route(`**/api/html-projects/${project.id}`, (route) => {
    if (route.request().method() === 'GET' && !cancelled)
      return route.fulfill({ json: activeProject });
    return route.continue();
  });
  await page.route(`**/api/html-projects/${project.id}/cancel`, (route) => {
    cancelled = true;
    return route.fulfill({
      json: { ...activeProject, run: { ...activeProject.run, status: 'cancelled' } },
    });
  });
  await page.goto(`/#project/${project.id}`);
  await page.getByLabel('页面问题或修改要求', { exact: true }).fill('使用更大的文字');
  const nextRun = page.waitForRequest(
    (req) => req.url().endsWith('/runs') && req.method() === 'POST',
  );
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('append-mode.png'), fullPage: true });
  await page.getByRole('button', { name: '引导', exact: true }).click();
  const input = (await nextRun).postDataJSON();
  expect(cancelled).toBe(true);
  expect(input.action).toBe('build');
  expect(input.instruction).toContain('用分苹果解释分数');
  expect(input.instruction).toContain('使用更大的文字');
  await expect(page.getByLabel('待处理消息')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toHaveCount(0, {
    timeout: 15000,
  });
  const saved = await (await request.get(`/api/html-projects/${project.id}`)).json();
  expect(saved.content.scenes[0].html).toBe(firstHtml);
  expect(saved.content.scenes[1].html).toContain('使用更大的文字');
});

test('server commands finish without a browser owner and a refreshed composer does not duplicate work', async ({
  page,
  request,
}) => {
  const project: HtmlProject = await (
    await request.post('/api/html-projects', {
      data: {
        requestId: crypto.randomUUID(),
        brief: '服务端队列恢复',
        sourceHtml: '<html><body>保存的页面</body></html>',
      },
    })
  ).json();
  const path = `/api/html-projects/${project.id}`;
  const command = {
    id: crypto.randomUUID(),
    projectId: project.id,
    question: '浏览器打开之前解释这一页',
    sceneId: project.content.scenes[0]!.id,
    kind: 'message',
    mode: 'ask',
    append: false,
    timing: 'after',
  };
  expect((await request.post(`${path}/commands`, { data: command })).status()).toBe(202);
  await expect
    .poll(async () => (await (await request.get(`${path}/conversation`)).json()).messages.length)
    .toBe(2);
  await page.goto(`/#project/${project.id}`);
  await expect(page.locator('.consultation-question').first()).toContainText(command.question);
  await page.getByLabel('页面问题或修改要求', { exact: true }).fill('刷新后继续解释');
  const acknowledgement = page.waitForResponse(
    (response) => response.url().endsWith('/commands') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  expect((await acknowledgement).status()).toBe(202);
  await page.reload();
  await expect(page.locator('.page-consultation')).toHaveCount(2);
  await request.post(`${path}/commands`, { data: command });
  expect((await (await request.get(`${path}/conversation`)).json()).messages).toHaveLength(4);
});
