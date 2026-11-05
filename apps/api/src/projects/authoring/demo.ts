import type { HtmlProject, HtmlScene } from '@studio/contracts';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
export function demoStoryboard(brief: string, count: number) {
  const topic = brief.slice(0, 32);
  const steps = [
    '从一个问题开始',
    '建立核心概念',
    '看见它的工作方式',
    '用一个例子理解',
    '把想法带走',
    '换一个角度',
    '动手试一试',
    '联系实际',
    '常见疑问',
    '深入探索',
    '回顾与总结',
    '下一步行动',
  ];
  return {
    title: topic,
    scenes: Array.from({ length: count }, (_, index) => ({
      title: count === 1 ? topic : `${steps[index]}：${topic.slice(0, 16)}`,
      objective:
        index === 0
          ? '用清晰的问题建立主题与读者的联系。'
          : '围绕这一页的核心信息展开，保持内容具体、易读。',
      content: `${brief}\n\n${steps[index]}。这里是本地演示分镜，请编辑为你希望呈现的实际内容。`,
      layout:
        index % 2 === 0
          ? '左侧主标题与说明，右侧抽象图解，保留充足留白。'
          : '上方标题，下方三张信息卡片，突出阅读顺序。',
    })),
  };
}
export function demoScene(project: HtmlProject, scene: HtmlScene, instruction: string) {
  if (scene.html) {
    const note = `<aside style="position:fixed;bottom:12px;right:12px;max-width:40%;padding:12px;background:#f7f3eb;color:#4a4036;border:1px solid #e87844;border-radius:8px;font:12px/1.7 system-ui;z-index:9999">本地规则演示 · 修改要求：${escape(instruction || '重新生成当前页')}</aside>`;
    return scene.html.replace(/<\/body>/i, `${note}</body>`);
  }
  const index = project.content.scenes.findIndex((item) => item.id === scene.id);
  const dark = project.content.style === 'cinematic';
  const accent = project.content.accent;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *{box-sizing:border-box}body{margin:0;background:${dark ? '#171c22' : '#f7f3eb'};color:${dark ? '#f5f0e8' : '#252d31'};font-family:system-ui,sans-serif;height:100vh;overflow:hidden}.page{height:100%;padding:7vh 7vw;display:grid;grid-template-columns:1.2fr 1fr;gap:5vw;align-items:center}.eyebrow{font-size:clamp(9px,1.1vw,16px);letter-spacing:.15em;color:${accent};text-transform:uppercase}h1{font-size:clamp(20px,4.4vw,72px);line-height:1.15;margin:3vh 0;letter-spacing:-.04em}p{font-size:clamp(11px,1.6vw,24px);line-height:1.8;white-space:pre-line;opacity:.7}.visual{position:relative;aspect-ratio:1;display:grid;place-items:center}.orbit{width:82%;aspect-ratio:1;border:1px solid ${accent}66;border-radius:50%;display:grid;place-items:center;transform:rotate(-20deg)}.core{width:65%;aspect-ratio:1;background:${accent};border-radius:30%;display:grid;place-items:center;transform:rotate(20deg);color:#fff;font-size:clamp(40px,10vw,150px);font-weight:300}.dot{position:absolute;width:18%;aspect-ratio:1;background:${dark ? '#b7c8b3' : '#bbc8b6'};border-radius:50%;right:0;top:10%}.foot{position:absolute;bottom:4vh;left:7vw;right:7vw;display:flex;justify-content:space-between;font-size:clamp(8px,.9vw,13px);opacity:.45}@media(max-aspect-ratio:4/5){.page{grid-template-columns:1fr;gap:0;padding:6vh 8vw}.visual{max-height:35vh}h1{font-size:8vw}p{font-size:3vw}}@media(prefers-reduced-motion:reduce){*{animation:none}}</style></head><body><main class="page"><section><div class="eyebrow">FORGE / ${String(index + 1).padStart(2, '0')}</div><h1>${escape(scene.title)}</h1><p>${escape(instruction ? `修改要求：${instruction}\n${scene.objective}` : scene.objective)}</p></section><div class="visual" aria-label="抽象主题图解"><div class="orbit"><div class="core">${String(index + 1).padStart(2, '0')}</div></div><div class="dot"></div></div></main><footer class="foot"><span>${escape(project.content.title.slice(0, 32))}</span><span>本地演示 · 非 AI 生成</span></footer></body></html>`;
}
