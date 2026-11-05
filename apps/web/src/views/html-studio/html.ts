import type { HtmlProjectContent } from '@studio/contracts';
import { createPreviewDocument } from '@studio/plugin-sdk';

export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
export const selectableTags = 'h1,h2,h3,h4,p,li,span,strong,button,figcaption,blockquote';
export function previewHtml(html: string, token: string) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const bridge = document.createElement('script');
  bridge.textContent = `(()=>{const token=${JSON.stringify(token)};const tags=${JSON.stringify(selectableTags)};let pick=false;let selected;const errors=[];const send=(type,data)=>parent.postMessage({forge:token,type,...data},'*');window.addEventListener('keydown',e=>{if(e.defaultPrevented||e.target.closest('input,textarea,select,[contenteditable]'))return;if(e.key==='Escape')send('exit',{});if(e.key==='ArrowLeft'||e.key==='ArrowRight')send('navigate',{offset:e.key==='ArrowRight'?1:-1})});window.addEventListener('error',e=>{if(errors.length<8)errors.push({message:'页面脚本运行出错：'+String(e.message).slice(0,140),level:'error'})});document.addEventListener('click',e=>{if(!pick)return;const el=e.target.closest(tags);if(!el)return;e.preventDefault();e.stopImmediatePropagation();if(selected)selected.style.outline='';selected=el;selected.style.outline='2px solid #e87844';send('selection',{index:[...document.querySelectorAll(tags)].indexOf(el),tag:el.tagName.toLowerCase(),text:el.textContent.slice(0,2000)})},true);window.addEventListener('message',e=>{if(e.source!==parent||e.data?.forge!==token)return;if(e.data.type==='pick'){pick=!!e.data.enabled;if(!pick&&selected){selected.style.outline='';selected=undefined}}if(e.data.type==='check'){const issues=[...errors];for(const el of document.querySelectorAll('h1,h2,h3,p,li,figcaption')){if(!el.getClientRects().length)continue;const r=el.getBoundingClientRect();const style=getComputedStyle(el);if(style.visibility==='hidden'||style.display==='none')continue;if(r.left< -2||r.top< -2||r.right>innerWidth+2||r.bottom>innerHeight+2)issues.push({message:'文字超出画面：'+el.textContent.trim().slice(0,45),level:'warning'});if(parseFloat(style.fontSize)<12&&el.textContent.trim())issues.push({message:'字号偏小：'+el.textContent.trim().slice(0,45),level:'warning'});if(issues.length>=20)break;}if(document.documentElement.scrollHeight>innerHeight+4||document.documentElement.scrollWidth>innerWidth+4)issues.push({message:'页面内容超过画布尺寸，请检查滚动或裁切。',level:'warning'});for(const img of document.images)if(img.complete&&img.naturalWidth===0)issues.push({message:'有图片未能加载',level:'error'});send('check',{issues:issues.slice(0,20)})}});send('ready',{})})();`;
  // Install diagnostics before generated scripts run, within the existing opaque-origin sandbox.
  document.head.prepend(bridge);
  return createPreviewDocument(`<!doctype html>${document.documentElement.outerHTML}`);
}
export function replaceSelectedText(html: string, index: number, original: string, text: string) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const element = document.querySelectorAll(selectableTags)[index];
  if (!element || element.textContent !== original || element.children.length)
    throw new Error('该元素包含动态内容或嵌套结构，请通过 AI 修改要求调整。');
  element.textContent = text;
  return `<!doctype html>${document.documentElement.outerHTML}`;
}
export function exportPresentation(content: HtmlProjectContent) {
  const size =
    content.aspect === 'portrait'
      ? [720, 1280]
      : content.aspect === 'square'
        ? [960, 960]
        : [1280, 720];
  const navToken = crypto.randomUUID();
  const frames = content.scenes
    .map((scene, index) => {
      const document = new DOMParser().parseFromString(scene.html, 'text/html');
      const bridge = document.createElement('script');
      bridge.textContent = `window.addEventListener('keydown',e=>{if(e.defaultPrevented||e.target.closest('input,textarea,select,[contenteditable]'))return;if(e.key==='ArrowRight'||e.key==='ArrowLeft')parent.postMessage({forgeNav:${JSON.stringify(navToken)},offset:e.key==='ArrowRight'?1:-1},'*')});`;
      document.head.prepend(bridge);
      return `<iframe title="${escapeHtml(scene.title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" ${index ? 'hidden' : ''} srcdoc="${escapeHtml(createPreviewDocument(`<!doctype html>${document.documentElement.outerHTML}`))}"></iframe>`;
    })
    .join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#17191c;color:#fff;font-family:system-ui;height:100dvh;display:flex;flex-direction:column;overflow:hidden}main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);place-items:center;overflow:hidden}iframe{grid-area:1/1;border:0;background:#fff;width:${size[0]}px;height:${size[1]}px;transform:scale(var(--scale,1));transform-origin:center}iframe[hidden]{display:none}nav{display:flex;gap:16px;align-items:center;justify-content:center;height:52px;flex-shrink:0}button{background:transparent;border:1px solid #666;color:inherit;padding:8px 16px;border-radius:6px;cursor:pointer}button:disabled{opacity:.3}span{font-size:13px}</style></head><body><main>${frames}</main><nav><button id="prev" aria-label="上一页">← 上一页</button><span id="counter" aria-live="polite"></span><button id="next" aria-label="下一页">下一页 →</button></nav><script>(()=>{let index=0;const frames=[...document.querySelectorAll('iframe')],stage=document.querySelector('main');const prev=document.getElementById('prev'),next=document.getElementById('next');function show(value){index=Math.max(0,Math.min(frames.length-1,value));frames.forEach((frame,i)=>frame.hidden=i!==index);document.getElementById('counter').textContent=(index+1)+' / '+frames.length;prev.disabled=index===0;next.disabled=index===frames.length-1}prev.onclick=()=>show(index-1);next.onclick=()=>show(index+1);window.addEventListener('keydown',e=>{if(e.key==='ArrowRight')show(index+1);if(e.key==='ArrowLeft')show(index-1)});window.addEventListener('message',e=>{if(e.source===frames[index].contentWindow&&e.data?.forgeNav===${JSON.stringify(navToken)}&&[1,-1].includes(e.data.offset))show(index+e.data.offset)});new ResizeObserver(()=>{document.documentElement.style.setProperty('--scale',Math.min(stage.clientWidth/${size[0]},stage.clientHeight/${size[1]}))}).observe(stage);show(0)})();</script></body></html>`;
}
