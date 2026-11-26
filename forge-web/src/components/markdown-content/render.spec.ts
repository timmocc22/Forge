import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render';

describe('message Markdown', () => {
  it('renders headings, nested lists, emphasis, quotes, code and tables', () => {
    const html = renderMarkdown(
      '## 修改计划\n\n- **标题**：统一表达\n  - 保留原意\n\n> 保留风格\n\n```html\n<div>示例</div>\n```\n\n| 页面 | 状态 |\n| --- | --- |\n| 首页 | 完成 |',
    );
    expect(html).toContain('<h2>修改计划</h2>');
    expect(html.match(/<ul>/g)).toHaveLength(2);
    expect(html).toContain('<strong>标题</strong>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('&lt;div&gt;示例&lt;/div&gt;');
    expect(html).toContain('<table>');
  });
  it('keeps raw HTML, active URL schemes and remote images inert', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n[x](data:text/html,hi)\n\n![image](https://example.com/tracker.png)',
    );
    expect(html).not.toMatch(/<script|<img|href="(?:javascript|data):/i);
    expect(html).toContain('&lt;script&gt;');
    const link = renderMarkdown('[文档](https://example.com/docs)');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  });
  it('separates legacy task clauses without changing their text and preserves Markdown lists', () => {
    expect(renderMarkdown('统一标题； 补充示例；保留风格。', true)).toBe(
      '<p>统一标题；</p>\n<p>补充示例；</p>\n<p>保留风格。</p>\n',
    );
    expect(renderMarkdown('- **标题**：统一；保留原意\n- **内容**：补充示例', true)).toContain(
      '<ul>',
    );
    expect(renderMarkdown('普通回复\n第二行')).toContain('普通回复<br>\n第二行');
  });
  it('localizes only leading task labels in Chinese plans, preserving prose and code', () => {
    const source =
      '- **title**: 统一标题\n- **content:** 梳理内容\n- **example**：补充示例\n- **preservation**: 保留风格\n\n正文中的 **title**: 保持原样\n\n```md\n- **title**: 示例代码\n```';
    const html = renderMarkdown(source, true);
    expect(html).toContain('<strong>标题</strong>');
    expect(html).toContain('<strong>内容：</strong>');
    expect(html).toContain('<strong>示例</strong>');
    expect(html).toContain('<strong>保留内容</strong>');
    expect(html).toContain('正文中的 <strong>title</strong>');
    expect(html).toContain('- **title**: 示例代码');
    expect(renderMarkdown(source)).toContain('<strong>preservation</strong>');
    expect(renderMarkdown('- **title**: Keep the original title', true)).toContain(
      '<strong>title</strong>',
    );
  });
});
