import { randomUUID } from 'node:crypto';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type { HtmlScene } from '@studio/contracts';

type Element = DefaultTreeAdapterTypes.Element;
const children = (node: DefaultTreeAdapterTypes.ParentNode) =>
  node.childNodes.filter((child): child is Element => 'tagName' in child);
const attribute = (node: Element, name: string) =>
  node.attrs.find((attr) => attr.name === name)?.value;

/** Recover native pages from Forge's exported player, including exports predating import support. */
export function expandImportedPresentation(scenes: HtmlScene[]): HtmlScene[] {
  if (scenes.length !== 1 || !scenes[0]!.html.includes('srcdoc')) return scenes;
  const scene = scenes[0]!;
  const document = parse(scene.html); // Parse only; imported scripts are never executed.
  const html = children(document).find((node) => node.tagName === 'html');
  const body = html && children(html).find((node) => node.tagName === 'body');
  if (!body) return scenes;
  const main = children(body).find((node) => node.tagName === 'main');
  const nav = children(body).find((node) => node.tagName === 'nav');
  if (!main || !nav) return scenes;
  const controls = children(nav);
  if (
    !controls.some((node) => node.tagName === 'button' && attribute(node, 'id') === 'prev') ||
    !controls.some((node) => node.tagName === 'span' && attribute(node, 'id') === 'counter') ||
    !controls.some((node) => node.tagName === 'button' && attribute(node, 'id') === 'next')
  )
    return scenes;
  const frames = children(main);
  if (
    !frames.length ||
    frames.length > 12 ||
    frames.some(
      (node) =>
        node.tagName !== 'iframe' ||
        !attribute(node, 'srcdoc') ||
        attribute(node, 'srcdoc')!.length > 250000,
    )
  )
    return scenes;
  return frames.map((frame, index) => ({
    ...scene,
    id: index === 0 ? scene.id : randomUUID(),
    title: attribute(frame, 'title')?.trim().slice(0, 120) || `第 ${index + 1} 页`,
    html: attribute(frame, 'srcdoc')!,
  }));
}
