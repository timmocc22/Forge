import { isDeepStrictEqual } from 'node:util';
import { ConflictException } from '@nestjs/common';
import type { HtmlProject } from '@studio/contracts';

/** Merge isolated writers by page, preserving unrelated commits and rejecting stale targets. */
export function mergeProjectDraft(current: HtmlProject, base: HtmlProject, draft: HtmlProject) {
  const fail = () => {
    throw new ConflictException('项目已在其他窗口更新，请重新载入后再修改。当前编辑内容仍保留。');
  };
  if (current.id !== base.id || draft.id !== base.id || current.run?.status === 'running') fail();
  const metadata = (project: HtmlProject) => ({ ...project.content, scenes: undefined });
  if (
    !isDeepStrictEqual(metadata(current), metadata(base)) ||
    !isDeepStrictEqual(metadata(draft), metadata(base))
  )
    fail();
  const ids = (project: HtmlProject) =>
    JSON.stringify(project.content.scenes.map((scene) => scene.id));
  if (ids(current) !== ids(base) || ids(draft) !== ids(base)) fail();
  const changed = new Map(
    draft.content.scenes
      .filter((scene, index) => !isDeepStrictEqual(scene, base.content.scenes[index]))
      .map((scene) => [scene.id, scene]),
  );
  for (const original of base.content.scenes) {
    if (!changed.has(original.id)) continue;
    const latest = current.content.scenes.find((scene) => scene.id === original.id);
    if (!latest || latest.locked || !isDeepStrictEqual(latest, original)) fail();
  }
  return {
    content: {
      ...current.content,
      scenes: current.content.scenes.map((scene) =>
        structuredClone(changed.get(scene.id) ?? scene),
      ),
    },
    revision: current.revision + Math.max(1, draft.revision - base.revision),
  };
}
