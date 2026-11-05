import MarkdownIt from 'markdown-it';

// Generated messages are untrusted: raw HTML and remote images stay inert.
const markdown = new MarkdownIt({ html: false, breaks: true }).disable('image');
const renderLink = markdown.renderer.rules.link_open;
const taskLabels: Record<string, string> = {
  title: '标题',
  content: '内容',
  example: '示例',
  preservation: '保留内容',
};
markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  tokens[index]!.attrSet('target', '_blank');
  tokens[index]!.attrSet('rel', 'noopener noreferrer');
  return renderLink
    ? renderLink(tokens, index, options, environment, renderer)
    : renderer.renderToken(tokens, index, options);
};

export function renderMarkdown(content: string, legacyTask = false): string {
  // Old task plans were a single paragraph. Keep every character, adding only
  // paragraph boundaries between clauses until new plans supply Markdown lists.
  const source =
    legacyTask && !content.includes('\n') ? content.replace(/([；;])\s*/g, '$1\n\n') : content;
  const tokens = markdown.parse(source, {});
  if (legacyTask && /[\u3400-\u9fff]/u.test(content)) {
    let listDepth = 0;
    for (const token of tokens) {
      if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') listDepth++;
      if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') listDepth--;
      if (!listDepth || token.type !== 'inline' || !token.children) continue;
      const children = token.children;
      const start = children.findIndex((child) => child.type === 'strong_open');
      if (start < 0 || children.slice(0, start).some((child) => child.content.trim())) continue;
      const label = children[start + 1];
      if (label?.type !== 'text' || children[start + 2]?.type !== 'strong_close') continue;
      const match = /^(title|content|example|preservation)([:：]?)$/i.exec(label.content.trim());
      if (!match || (!match[2] && !/^\s*[:：]/.test(children[start + 3]?.content ?? ''))) continue;
      label.content = taskLabels[match[1]!.toLowerCase()]! + (match[2] ? '：' : '');
    }
  }
  return markdown.renderer.render(tokens, markdown.options, {});
}
