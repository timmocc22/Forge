import { ConflictException } from '@nestjs/common';
import type { HtmlProject } from '@studio/contracts';

export function checkProjectRevision(project: HtmlProject, revision: number) {
  if (project.revision !== revision)
    throw new ConflictException('项目已在其他窗口更新，请重新载入后再修改。当前编辑内容仍保留。');
  if (project.run?.status === 'running') throw new ConflictException('请先停止生成，再修改项目');
}
